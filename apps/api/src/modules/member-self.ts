import { and, asc, count, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { schema as s, type Executor } from '@bnature/db';
import {
  can,
  eventQuerySchema,
  idParams,
  memberDashboardSchema,
  ownFeesSchema,
  ownMembershipDetailSchema,
  pdfQuerySchema,
  type OwnFeeAssessment,
  type OwnFeePayment,
} from '@bnature/contracts';
import { HttpError, type Access } from '../middleware/access';
import { activity } from './community-notify';
import { listEvents, ownPerson } from './events';
import { readSnapshot } from './finance/operations';
import { paymentPdf } from './finance/pdf';
import { assessmentState, businessDate } from './finance/service';
import { sendPdf } from './http';
import type { ModuleContext } from './context';

async function loadOrganizationSummary(tx: Executor, organizationId: string) {
  const [org] = await tx
    .select({
      id: s.organizations.id,
      name: s.organizations.name,
      organizationType: s.organizations.organizationType,
    })
    .from(s.organizations)
    .where(eq(s.organizations.id, organizationId));
  if (!org) throw new HttpError(404, 'NOT_FOUND', 'Organisation nicht gefunden.');
  return org;
}

async function loadOwnMembership(tx: Executor, org: string, personId: string) {
  const [membership] = await tx
    .select({
      id: s.memberships.id,
      membershipNumber: s.memberships.membershipNumber,
      membershipType: s.memberships.membershipType,
      status: s.memberships.status,
      joinedAt: s.memberships.joinedAt,
      endedAt: s.memberships.endedAt,
    })
    .from(s.memberships)
    .where(and(eq(s.memberships.organizationId, org), eq(s.memberships.personId, personId)))
    .limit(1);
  return membership ?? null;
}

async function loadOwnAssessments(
  tx: Executor,
  org: string,
  membershipId: string,
  today: string,
): Promise<OwnFeeAssessment[]> {
  const paidSql = sql<number>`coalesce((
    select sum(pa.amount_cents)
    from payment_allocations pa
    join payments p on p.id = pa.payment_id and p.organization_id = pa.organization_id
    left join payment_reversals pr on pr.payment_id = p.id and pr.organization_id = p.organization_id
    where pa.organization_id = membership_fee_assessments.organization_id
      and pa.assessment_id = membership_fee_assessments.id
      and pr.id is null
  ), 0)::int`;

  const rows = await tx
    .select({
      id: s.membershipFeeAssessments.id,
      fiscalYear: s.membershipFeeAssessments.fiscalYear,
      dueDate: s.membershipFeeAssessments.dueDate,
      planName: s.membershipFeeAssessments.planName,
      interval: s.membershipFeeAssessments.interval,
      amountCents: s.membershipFeeAssessments.amountCents,
      exempt: s.membershipFeeAssessments.exempt,
      paidCents: paidSql,
    })
    .from(s.membershipFeeAssessments)
    .where(
      and(
        eq(s.membershipFeeAssessments.organizationId, org),
        eq(s.membershipFeeAssessments.membershipId, membershipId),
      ),
    )
    .orderBy(
      desc(s.membershipFeeAssessments.fiscalYear),
      desc(s.membershipFeeAssessments.dueDate),
      asc(s.membershipFeeAssessments.id),
    );

  return rows.map((row) => ({
    ...row,
    ...assessmentState(row, today),
    currency: 'EUR' as const,
  }));
}

function summarizeFees(assessments: OwnFeeAssessment[]) {
  let openCount = 0;
  let overdueCount = 0;
  let openCents = 0;
  for (const item of assessments) {
    if (item.openCents > 0) {
      openCount += 1;
      openCents += item.openCents;
      if (item.overdue) overdueCount += 1;
    }
  }
  return { openCount, overdueCount, openCents };
}

async function loadOwnPayments(
  tx: Executor,
  org: string,
  membershipId: string,
): Promise<OwnFeePayment[]> {
  const rows = await tx
    .select({
      paymentId: s.payments.id,
      receiptNumber: s.payments.receiptNumber,
      paidOn: s.payments.paidOn,
      method: s.payments.method,
      reference: s.payments.reference,
      amountCents: s.payments.amountCents,
      reversedId: s.paymentReversals.id,
      hasForeignAllocation: sql<boolean>`exists(
        select 1
        from payment_allocations pa2
        join membership_fee_assessments a2
          on a2.id = pa2.assessment_id and a2.organization_id = pa2.organization_id
        where pa2.organization_id = payments.organization_id
          and pa2.payment_id = payments.id
          and a2.membership_id <> ${membershipId}
      )`,
      assessmentId: s.paymentAllocations.assessmentId,
      planName: s.membershipFeeAssessments.planName,
      fiscalYear: s.membershipFeeAssessments.fiscalYear,
      allocatedCents: s.paymentAllocations.amountCents,
    })
    .from(s.paymentAllocations)
    .innerJoin(
      s.membershipFeeAssessments,
      and(
        eq(s.membershipFeeAssessments.organizationId, s.paymentAllocations.organizationId),
        eq(s.membershipFeeAssessments.id, s.paymentAllocations.assessmentId),
      ),
    )
    .innerJoin(
      s.payments,
      and(
        eq(s.payments.organizationId, s.paymentAllocations.organizationId),
        eq(s.payments.id, s.paymentAllocations.paymentId),
      ),
    )
    .leftJoin(
      s.paymentReversals,
      and(
        eq(s.paymentReversals.organizationId, s.payments.organizationId),
        eq(s.paymentReversals.paymentId, s.payments.id),
      ),
    )
    .where(
      and(
        eq(s.paymentAllocations.organizationId, org),
        eq(s.membershipFeeAssessments.membershipId, membershipId),
      ),
    )
    .orderBy(desc(s.payments.paidOn), desc(s.payments.receiptNumber), asc(s.payments.id));

  const byPayment = new Map<string, OwnFeePayment>();
  for (const row of rows) {
    let entry = byPayment.get(row.paymentId);
    if (!entry) {
      entry = {
        id: row.paymentId,
        receiptNumber: row.receiptNumber,
        paidOn: row.paidOn,
        method: row.method,
        reference: row.reference,
        amountCents: row.amountCents,
        currency: 'EUR',
        status: row.reversedId ? 'reversed' : 'posted',
        receiptAvailable: !row.hasForeignAllocation,
        allocations: [],
      };
      byPayment.set(row.paymentId, entry);
    }
    entry.allocations.push({
      assessmentId: row.assessmentId,
      planName: row.planName,
      fiscalYear: row.fiscalYear,
      amountCents: row.allocatedCents,
    });
  }
  return [...byPayment.values()];
}

async function accessibleGroupIds(tx: Executor, a: Access, personId: string | undefined) {
  const rows = await tx
    .select({ id: s.groups.id })
    .from(s.groups)
    .where(
      can(a.role, 'community:manage')
        ? and(eq(s.groups.organizationId, a.organizationId), eq(s.groups.active, true))
        : personId
          ? and(
              eq(s.groups.organizationId, a.organizationId),
              eq(s.groups.active, true),
              sql`exists(select 1 from group_members gm where gm.organization_id = groups.organization_id and gm.group_id = groups.id and gm.person_id = ${personId})`,
            )
          : sql`false`,
    );
  return rows.map((row) => row.id);
}

export function registerMemberSelfRoutes({ server, db, access }: ModuleContext) {
  const app = server.withTypeProvider<ZodTypeProvider>();
  const p = '/api/v1';

  app.get(
    `${p}/dashboard/member`,
    {
      schema: {
        tags: ['Dashboard'],
        response: { 200: memberDashboardSchema },
      },
    },
    async (req) => {
      const a = await access(req);
      return readSnapshot(db, async (tx) => {
        const org = a.organizationId;
        const now = new Date();
        const organization = await loadOrganizationSummary(tx, org);
        const personId = await ownPerson(tx, a);
        const today = await businessDate(tx, org);

        let personName: string | null = null;
        let membership: {
          id: string;
          membershipNumber: string;
          membershipType: 'ordinary' | 'supporting' | 'honorary';
          status: 'active' | 'pending' | 'inactive' | 'resigned';
          joinedAt: string;
        } | null = null;
        let fees = { openCount: 0, overdueCount: 0, openCents: 0 };
        let myGroupCount = 0;
        let activeLoanCount = 0;
        let overdueLoanCount = 0;
        let nextAssignment: {
          id: string;
          task: string;
          plannedStart: string;
          plannedEnd: string;
          eventTitle: { de: string; it: string } | null;
        } | null = null;

        if (personId) {
          const [personRow] = await tx
            .select({ firstName: s.persons.firstName, lastName: s.persons.lastName })
            .from(s.persons)
            .where(and(eq(s.persons.organizationId, org), eq(s.persons.id, personId)));
          if (personRow) personName = `${personRow.firstName} ${personRow.lastName}`;

          const ownMember = await loadOwnMembership(tx, org, personId);
          if (ownMember) {
            membership = {
              id: ownMember.id,
              membershipNumber: ownMember.membershipNumber,
              membershipType: ownMember.membershipType,
              status: ownMember.status,
              joinedAt: ownMember.joinedAt,
            };
            fees = summarizeFees(await loadOwnAssessments(tx, org, ownMember.id, today));
          }

          const [groupCountRow] = await tx
            .select({ n: count() })
            .from(s.groupMembers)
            .innerJoin(
              s.groups,
              and(
                eq(s.groups.organizationId, s.groupMembers.organizationId),
                eq(s.groups.id, s.groupMembers.groupId),
                eq(s.groups.active, true),
              ),
            )
            .where(
              and(eq(s.groupMembers.organizationId, org), eq(s.groupMembers.personId, personId)),
            );
          const [loanCountRow] = await tx
            .select({ n: count() })
            .from(s.inventoryLoans)
            .where(
              and(
                eq(s.inventoryLoans.organizationId, org),
                eq(s.inventoryLoans.personId, personId),
                isNull(s.inventoryLoans.returnedOn),
              ),
            );
          const [overdueLoanRow] = await tx
            .select({ n: count() })
            .from(s.inventoryLoans)
            .where(
              and(
                eq(s.inventoryLoans.organizationId, org),
                eq(s.inventoryLoans.personId, personId),
                isNull(s.inventoryLoans.returnedOn),
                lt(s.inventoryLoans.dueOn, today),
              ),
            );
          const [assignmentRow] = await tx
            .select({
              id: s.volunteerAssignments.id,
              task: s.volunteerAssignments.task,
              plannedStart: s.volunteerAssignments.plannedStart,
              plannedEnd: s.volunteerAssignments.plannedEnd,
              eventTitle: s.eventOccurrences.titleI18n,
            })
            .from(s.volunteerAssignments)
            .innerJoin(
              s.volunteerEngagements,
              and(
                eq(s.volunteerEngagements.organizationId, s.volunteerAssignments.organizationId),
                eq(s.volunteerEngagements.id, s.volunteerAssignments.engagementId),
              ),
            )
            .leftJoin(
              s.eventOccurrences,
              and(
                eq(s.eventOccurrences.organizationId, s.volunteerAssignments.organizationId),
                eq(s.eventOccurrences.id, s.volunteerAssignments.eventOccurrenceId),
              ),
            )
            .where(
              and(
                eq(s.volunteerAssignments.organizationId, org),
                eq(s.volunteerEngagements.personId, personId),
                eq(s.volunteerAssignments.status, 'planned'),
                gt(s.volunteerAssignments.plannedEnd, now),
              ),
            )
            .orderBy(asc(s.volunteerAssignments.plannedStart), asc(s.volunteerAssignments.id))
            .limit(1);

          myGroupCount = groupCountRow?.n ?? 0;
          activeLoanCount = loanCountRow?.n ?? 0;
          overdueLoanCount = overdueLoanRow?.n ?? 0;
          if (assignmentRow) {
            nextAssignment = {
              id: assignmentRow.id,
              task: assignmentRow.task,
              plannedStart: assignmentRow.plannedStart.toISOString(),
              plannedEnd: assignmentRow.plannedEnd.toISOString(),
              eventTitle: assignmentRow.eventTitle ?? null,
            };
          }
        }

        let community = {
          unreadNews: 0,
          unreadPolls: 0,
          unreadChat: 0,
          openUnansweredPolls: 0,
          openUnansweredSchedules: 0,
        };

        if (can(a.role, 'community:read')) {
          const act = await activity(tx, a);
          const groupIds = await accessibleGroupIds(tx, a, personId);
          const postScope =
            groupIds.length > 0
              ? or(isNull(s.communityPosts.groupId), inArray(s.communityPosts.groupId, groupIds))
              : isNull(s.communityPosts.groupId);
          const schedScope =
            groupIds.length > 0
              ? or(
                  isNull(s.communitySchedules.groupId),
                  inArray(s.communitySchedules.groupId, groupIds),
                )
              : isNull(s.communitySchedules.groupId);

          const [pollRow] = await tx
            .select({ n: count() })
            .from(s.communityPosts)
            .where(
              and(
                eq(s.communityPosts.organizationId, org),
                eq(s.communityPosts.kind, 'poll'),
                eq(s.communityPosts.state, 'published'),
                isNull(s.communityPosts.closedAt),
                or(isNull(s.communityPosts.closesAt), gt(s.communityPosts.closesAt, now)),
                postScope,
                sql`not exists(select 1 from community_votes v where v.organization_id = community_posts.organization_id and v.post_id = community_posts.id and v.user_id = ${a.userId})`,
              ),
            );
          const [schedRow] = await tx
            .select({ n: count() })
            .from(s.communitySchedules)
            .where(
              and(
                eq(s.communitySchedules.organizationId, org),
                eq(s.communitySchedules.state, 'open'),
                or(isNull(s.communitySchedules.closesAt), gt(s.communitySchedules.closesAt, now)),
                schedScope,
                sql`not exists(select 1 from community_schedule_answers csa where csa.organization_id = community_schedules.organization_id and csa.schedule_id = community_schedules.id and csa.user_id = ${a.userId})`,
              ),
            );

          community = {
            unreadNews: act.news,
            unreadPolls: act.polls,
            unreadChat: act.chat.reduce((sum, ch) => sum + ch.count, 0),
            openUnansweredPolls: pollRow?.n ?? 0,
            openUnansweredSchedules: schedRow?.n ?? 0,
          };
        }

        const upcomingEvents = can(a.role, 'events:read')
          ? (
              await listEvents(
                tx,
                a,
                eventQuerySchema.parse({
                  from: now.toISOString(),
                  status: 'published',
                  page: 1,
                  pageSize: 5,
                }),
              )
            ).items.map((ev) => ({
              id: ev.id,
              titleI18n: ev.titleI18n,
              categoryNameI18n: ev.categoryNameI18n,
              startAt: ev.startAt,
              endAt: ev.endAt,
              timezone: ev.timezone,
              location: ev.location,
              myRegistrationStatus:
                ev.myRegistrationStatus === 'registered' || ev.myRegistrationStatus === 'waitlisted'
                  ? ev.myRegistrationStatus
                  : null,
            }))
          : [];

        return memberDashboardSchema.parse({
          organization,
          linked: Boolean(personId),
          personName,
          membership,
          fees,
          community,
          upcomingEvents,
          myGroupCount,
          activeLoanCount,
          overdueLoanCount,
          nextAssignment,
        });
      });
    },
  );

  app.get(
    `${p}/profile/membership`,
    {
      schema: {
        tags: ['Profile'],
        response: { 200: ownMembershipDetailSchema },
      },
    },
    async (req) => {
      const a = await access(req);
      return readSnapshot(db, async (tx) => {
        const org = a.organizationId;
        const organization = await loadOrganizationSummary(tx, org);
        const personId = await ownPerson(tx, a);
        if (!personId) {
          return ownMembershipDetailSchema.parse({
            organization,
            linked: false,
            person: null,
            membership: null,
            groups: [],
            consents: { data_processing: null, photos: null },
            extraFields: [],
          });
        }

        const [personRow] = await tx
          .select({
            id: s.persons.id,
            firstName: s.persons.firstName,
            lastName: s.persons.lastName,
            email: s.persons.email,
            preferredLanguage: s.persons.preferredLanguage,
          })
          .from(s.persons)
          .where(and(eq(s.persons.organizationId, org), eq(s.persons.id, personId)));
        const membership = await loadOwnMembership(tx, org, personId);
        const groups = await tx
          .select({
            id: s.groups.id,
            name: s.groups.name,
            description: s.groups.description,
            active: s.groups.active,
          })
          .from(s.groupMembers)
          .innerJoin(
            s.groups,
            and(
              eq(s.groups.organizationId, s.groupMembers.organizationId),
              eq(s.groups.id, s.groupMembers.groupId),
              eq(s.groups.active, true),
            ),
          )
          .where(and(eq(s.groupMembers.organizationId, org), eq(s.groupMembers.personId, personId)))
          .orderBy(asc(s.groups.name), asc(s.groups.id));
        const consentsRows = await tx
          .select({
            kind: s.personConsents.kind,
            granted: s.personConsents.granted,
            decidedOn: s.personConsents.decidedOn,
          })
          .from(s.personConsents)
          .where(
            and(eq(s.personConsents.organizationId, org), eq(s.personConsents.personId, personId)),
          )
          .orderBy(desc(s.personConsents.recordedAt), desc(s.personConsents.id));
        const extraRows = await tx
          .select({
            id: s.memberFieldDefinitions.id,
            labelI18n: s.memberFieldDefinitions.labelI18n,
            type: s.memberFieldDefinitions.type,
            value: s.personFieldValues.value,
          })
          .from(s.personFieldValues)
          .innerJoin(
            s.memberFieldDefinitions,
            and(
              eq(s.memberFieldDefinitions.organizationId, s.personFieldValues.organizationId),
              eq(s.memberFieldDefinitions.id, s.personFieldValues.fieldId),
            ),
          )
          .where(
            and(
              eq(s.personFieldValues.organizationId, org),
              eq(s.personFieldValues.personId, personId),
            ),
          )
          .orderBy(
            asc(s.memberFieldDefinitions.position),
            asc(s.memberFieldDefinitions.createdAt),
            asc(s.memberFieldDefinitions.id),
          );

        const latestData = consentsRows.find((r) => r.kind === 'data_processing') ?? null;
        const latestPhotos = consentsRows.find((r) => r.kind === 'photos') ?? null;

        return ownMembershipDetailSchema.parse({
          organization,
          linked: true,
          person: personRow ?? null,
          membership,
          groups,
          consents: {
            data_processing: latestData
              ? { granted: latestData.granted, decidedOn: latestData.decidedOn }
              : null,
            photos: latestPhotos
              ? { granted: latestPhotos.granted, decidedOn: latestPhotos.decidedOn }
              : null,
          },
          extraFields: extraRows,
        });
      });
    },
  );

  app.get(
    `${p}/profile/fees`,
    {
      schema: {
        tags: ['Profile'],
        response: { 200: ownFeesSchema },
      },
    },
    async (req) => {
      const a = await access(req);
      return readSnapshot(db, async (tx) => {
        const org = a.organizationId;
        const personId = await ownPerson(tx, a);
        const today = await businessDate(tx, org);
        if (!personId) {
          return ownFeesSchema.parse({
            linked: false,
            hasMembership: false,
            openCount: 0,
            overdueCount: 0,
            openCents: 0,
            assessments: [],
            payments: [],
          });
        }
        const membership = await loadOwnMembership(tx, org, personId);
        if (!membership) {
          return ownFeesSchema.parse({
            linked: true,
            hasMembership: false,
            openCount: 0,
            overdueCount: 0,
            openCents: 0,
            assessments: [],
            payments: [],
          });
        }
        const assessments = await loadOwnAssessments(tx, org, membership.id, today);
        const payments = await loadOwnPayments(tx, org, membership.id);
        return ownFeesSchema.parse({
          linked: true,
          hasMembership: true,
          ...summarizeFees(assessments),
          assessments,
          payments,
        });
      });
    },
  );

  app.get(
    `${p}/profile/fees/payments/:id/receipt`,
    {
      schema: {
        tags: ['Profile'],
        params: idParams,
        querystring: pdfQuerySchema,
        produces: ['application/pdf'],
        response: { 200: z.string().meta({ format: 'binary' }) },
      },
    },
    async (req, reply) => {
      const a = await access(req);
      const { org, receiptNumber } = await readSnapshot(db, async (tx) => {
        const personId = await ownPerson(tx, a);
        if (!personId) throw new HttpError(403, 'FORBIDDEN', 'Keine Mitgliedschaft verknüpft.');
        const membership = await loadOwnMembership(tx, a.organizationId, personId);
        if (!membership) throw new HttpError(403, 'FORBIDDEN', 'Keine Mitgliedschaft verknüpft.');
        const [payment] = await tx
          .select({ id: s.payments.id, receiptNumber: s.payments.receiptNumber })
          .from(s.payments)
          .where(
            and(eq(s.payments.organizationId, a.organizationId), eq(s.payments.id, req.params.id)),
          );
        if (!payment) throw new HttpError(404, 'NOT_FOUND', 'Zahlung nicht gefunden.');
        const allocs = await tx
          .select({ membershipId: s.membershipFeeAssessments.membershipId })
          .from(s.paymentAllocations)
          .innerJoin(
            s.membershipFeeAssessments,
            and(
              eq(s.membershipFeeAssessments.organizationId, s.paymentAllocations.organizationId),
              eq(s.membershipFeeAssessments.id, s.paymentAllocations.assessmentId),
            ),
          )
          .where(
            and(
              eq(s.paymentAllocations.organizationId, a.organizationId),
              eq(s.paymentAllocations.paymentId, payment.id),
            ),
          );
        if (
          allocs.length === 0 ||
          !allocs.some((r) => r.membershipId === membership.id) ||
          allocs.some((r) => r.membershipId !== membership.id)
        ) {
          throw new HttpError(403, 'FORBIDDEN', 'Keine Berechtigung für diesen Beleg.');
        }
        return { org: a.organizationId, receiptNumber: payment.receiptNumber };
      });
      return sendPdf(
        reply,
        await paymentPdf(db, org, req.params.id, req.query.language),
        `receipt-${receiptNumber}.pdf`,
      );
    },
  );
}
