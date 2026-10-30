import { and, eq, sql, asc, desc, count, ilike, or, getTableColumns, inArray } from 'drizzle-orm';
import { schema as s, type Database, type Executor } from '@bnature/db';
import {
  can,
  volunteerSummarySchema,
  volunteerDetailSchema,
  type EngagementInput,
  type VolunteerQuery,
  type engagementPatchSchema,
  type engagementEndSchema,
} from '@bnature/contracts';
import type { z } from 'zod';
import { HttpError, type Access } from '../../middleware/access';
import { audit } from '../../services/audit';
import { financialOperation, readSnapshot } from '../finance/operations';
import { escapeLike } from '../members';
import { wire } from '../responses';
import {
  ve,
  engagementRow,
  personIdentity,
  personIdentities,
  registerEntriesFor,
  registerSettings,
  registerState,
  coverageFor,
  engagementHistory,
  identityIssues,
  today,
} from './common';

const summaryColumns = {
  ...getTableColumns(ve),
  firstName: s.persons.firstName,
  lastName: s.persons.lastName,
  isMember: sql<boolean>`exists(select 1 from memberships m where m.organization_id=${ve.organizationId} and m.person_id=${ve.personId} and m.status in ('active','pending'))`,
  plannedAssignments: sql<number>`(select count(*)::int from volunteer_assignments va where va.organization_id=${ve.organizationId} and va.engagement_id=${ve.id} and va.status='planned')`,
  confirmedMinutes: sql<number>`(select coalesce(sum(t.minutes),0)::int from volunteer_time_entries t where t.organization_id=${ve.organizationId} and t.engagement_id=${ve.id} and t.status='confirmed')`,
};
function baseQuery(db: Executor) {
  return db
    .select(summaryColumns)
    .from(ve)
    .innerJoin(
      s.persons,
      and(eq(s.persons.organizationId, ve.organizationId), eq(s.persons.id, ve.personId)),
    );
}
type SummaryRow = Awaited<ReturnType<ReturnType<typeof baseQuery>['where']>>[number];
async function summarize(db: Executor, a: Access, rows: SummaryRow[]) {
  const settings = await registerSettings(db, a.organizationId),
    entries = await registerEntriesFor(
      db,
      a.organizationId,
      rows.map((r) => r.id),
    ),
    coverage = await coverageFor(db, a.organizationId, rows);
  const identities = await personIdentities(
    db,
    a.organizationId,
    rows.map((r) => r.personId),
  );
  return rows.map((row) =>
    volunteerSummarySchema.parse({
      ...wire(row),
      registerState: registerState(
        row,
        entries,
        identities.get(row.personId)!,
        settings.occasionalSection,
      ),
      coverageStatus: coverage.get(row.id)!.status,
    }),
  );
}
export async function listVolunteers(db: Database, a: Access, q: VolunteerQuery) {
  return readSnapshot(db, async (tx) => {
    const where = and(
      eq(ve.organizationId, a.organizationId),
      q.volunteerType ? eq(ve.volunteerType, q.volunteerType) : undefined,
      q.status ? eq(ve.status, q.status) : undefined,
      q.search
        ? or(
            ilike(s.persons.lastName, `%${escapeLike(q.search)}%`),
            ilike(s.persons.firstName, `%${escapeLike(q.search)}%`),
            ilike(ve.activity, `%${escapeLike(q.search)}%`),
          )
        : undefined,
    );
    const order = [
      asc(s.persons.lastName),
      asc(s.persons.firstName),
      desc(ve.startedOn),
      asc(ve.id),
    ];
    // The coverage filter is derived data, so it is applied after the indicative assessment.
    if (q.coverage) {
      const all = await summarize(
        tx,
        a,
        await baseQuery(tx)
          .where(where)
          .orderBy(...order)
          .limit(5000),
      );
      const filtered = all.filter((item) => item.coverageStatus === q.coverage);
      return {
        items: filtered.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
        total: filtered.length,
        page: q.page,
        pageSize: q.pageSize,
      };
    }
    const rows = await baseQuery(tx)
      .where(where)
      .orderBy(...order)
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const [total] = await tx
      .select({ n: count() })
      .from(ve)
      .innerJoin(
        s.persons,
        and(eq(s.persons.organizationId, ve.organizationId), eq(s.persons.id, ve.personId)),
      )
      .where(where);
    return {
      items: await summarize(tx, a, rows),
      total: total?.n ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  });
}
export async function getVolunteer(db: Executor, a: Access, id: string) {
  return readSnapshot(db, async (tx) => {
    const [row] = await baseQuery(tx).where(
      and(eq(ve.organizationId, a.organizationId), eq(ve.id, id)),
    );
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Freiwilligeneinsatz nicht gefunden.');
    const [summary] = await summarize(tx, a, [row]);
    const identity = await personIdentity(tx, a.organizationId, row.personId);
    const sensitive = can(a.role, 'volunteers:write') || can(a.role, 'register:read');
    const history = await tx
      .select({
        id: s.volunteerEngagementHistory.id,
        version: s.volunteerEngagementHistory.version,
        action: s.volunteerEngagementHistory.action,
        changes: s.volunteerEngagementHistory.changes,
        actorName: s.user.name,
        createdAt: s.volunteerEngagementHistory.createdAt,
      })
      .from(s.volunteerEngagementHistory)
      .leftJoin(s.user, eq(s.user.id, s.volunteerEngagementHistory.actorUserId))
      .where(
        and(
          eq(s.volunteerEngagementHistory.organizationId, a.organizationId),
          eq(s.volunteerEngagementHistory.engagementId, id),
        ),
      )
      .orderBy(asc(s.volunteerEngagementHistory.version));
    const assignments = await tx
      .select({
        eventOccurrenceId: s.eventOccurrences.id,
        titleI18n: s.eventOccurrences.titleI18n,
        startAt: s.eventOccurrences.startAt,
        status: s.volunteerAssignments.status,
      })
      .from(s.volunteerAssignments)
      .innerJoin(
        s.eventOccurrences,
        and(
          eq(s.eventOccurrences.organizationId, s.volunteerAssignments.organizationId),
          eq(s.eventOccurrences.id, s.volunteerAssignments.eventOccurrenceId),
        ),
      )
      .where(
        and(
          eq(s.volunteerAssignments.organizationId, a.organizationId),
          eq(s.volunteerAssignments.engagementId, id),
        ),
      );
    const registrations = await tx
      .select({
        eventOccurrenceId: s.eventOccurrences.id,
        titleI18n: s.eventOccurrences.titleI18n,
        startAt: s.eventOccurrences.startAt,
        status: s.eventRegistrations.status,
      })
      .from(s.eventRegistrations)
      .innerJoin(
        s.eventOccurrences,
        and(
          eq(s.eventOccurrences.organizationId, s.eventRegistrations.organizationId),
          eq(s.eventOccurrences.id, s.eventRegistrations.eventOccurrenceId),
        ),
      )
      .where(
        and(
          eq(s.eventRegistrations.organizationId, a.organizationId),
          eq(s.eventRegistrations.personId, row.personId),
          sql`${s.eventOccurrences.startAt}>=${row.startedOn}::date`,
        ),
      );
    const coverage = (await coverageFor(tx, a.organizationId, [row])).get(row.id)!;
    const events = [
      ...assignments.map((x) => ({ ...wire(x), relation: 'assignment' as const })),
      ...registrations.map((x) => ({ ...wire(x), relation: 'registration' as const })),
    ].sort((x, y) => y.startAt.localeCompare(x.startAt));
    const { firstName: _f, lastName: _l, ...registerData } = identity;
    void _f;
    void _l;
    return volunteerDetailSchema.parse({
      ...summary,
      notes: row.notes,
      registerData: sensitive ? registerData : null,
      registerIssues: identityIssues(identity),
      history: history.map((h) => wire(h)),
      events,
      coverage,
    });
  });
}
// Stored idempotency responses hold only the id; personal data is always read fresh.
const withDetail =
  (db: Database, a: Access) => async (result: { data: { id: string }; replayed: boolean }) => ({
    data: await getVolunteer(db, a, result.data.id),
    replayed: result.replayed,
  });
const registerFields = [
  'fiscalCode',
  'dateOfBirth',
  'birthPlace',
  'street',
  'postalCode',
  'city',
  'country',
  'domicile',
] as const;
async function writeRegisterData(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  a: Access,
  personId: string,
  data: EngagementInput['registerData'],
) {
  if (!data) return;
  await tx
    .update(s.persons)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(s.persons.organizationId, a.organizationId), eq(s.persons.id, personId)));
  // Personal values are never copied into audit metadata.
  await audit(tx, a, 'update', 'person', personId, Object.keys(data));
}
export function createEngagement(db: Database, a: Access, key: string, input: EngagementInput) {
  return financialOperation(
    db,
    a,
    key,
    'volunteers:create',
    input,
    'volunteers:write',
    async (tx) => {
      let personId = input.personId;
      if (input.person) {
        const [person] = await tx
          .insert(s.persons)
          .values({ ...input.person, organizationId: a.organizationId })
          .returning({ id: s.persons.id });
        personId = person!.id;
        await audit(tx, a, 'create', 'person', personId, Object.keys(input.person));
      } else {
        const [person] = await tx
          .select({ id: s.persons.id })
          .from(s.persons)
          .where(and(eq(s.persons.organizationId, a.organizationId), eq(s.persons.id, personId!)));
        if (!person) throw new HttpError(404, 'NOT_FOUND', 'Person nicht gefunden.');
      }
      const [open] = await tx
        .select({ id: ve.id })
        .from(ve)
        .where(
          and(
            eq(ve.organizationId, a.organizationId),
            eq(ve.personId, personId!),
            sql`${ve.endedOn} is null`,
          ),
        );
      if (open)
        throw new HttpError(
          409,
          'VOLUNTEER_EXISTS',
          'Für diese Person besteht bereits ein laufender Einsatz.',
        );
      const [previous] = await tx
        .select({ endedOn: ve.endedOn })
        .from(ve)
        .where(and(eq(ve.organizationId, a.organizationId), eq(ve.personId, personId!)))
        .orderBy(desc(ve.endedOn))
        .limit(1);
      if (previous?.endedOn && previous.endedOn >= input.startedOn)
        throw new HttpError(
          409,
          'VOLUNTEER_PERIOD_OVERLAP',
          'Der neue Einsatz muss nach dem Ende des vorherigen beginnen.',
        );
      await writeRegisterData(tx, a, personId!, input.registerData);
      const [row] = await tx
        .insert(ve)
        .values({
          organizationId: a.organizationId,
          personId: personId!,
          volunteerType: input.volunteerType,
          startedOn: input.startedOn,
          focusAreas: input.focusAreas,
          activity: input.activity,
          notes: input.notes,
          createdBy: a.userId,
        })
        .returning();
      await engagementHistory(tx, a, row!.id, 1, 'create', {
        volunteerType: input.volunteerType,
        startedOn: input.startedOn,
        status: 'active',
        focusAreas: input.focusAreas,
        activity: input.activity,
        registerDataChanged: !!input.registerData,
      });
      await audit(tx, a, 'create', 'volunteer_engagement', row!.id, [
        'volunteerType',
        'startedOn',
        'focusAreas',
        'activity',
      ]);
      return { id: row!.id };
    },
  ).then(withDetail(db, a));
}
export function updateEngagement(
  db: Database,
  a: Access,
  key: string,
  id: string,
  input: z.infer<typeof engagementPatchSchema>,
) {
  return financialOperation(
    db,
    a,
    key,
    `volunteers:update:${id}`,
    input,
    'volunteers:write',
    async (tx) => {
      const current = await engagementRow(tx, a, id, true);
      if (current.version !== input.version)
        throw new HttpError(409, 'STALE_VERSION', 'Der Eintrag wurde zwischenzeitlich geändert.');
      if (current.status === 'ended')
        throw new HttpError(409, 'VOLUNTEER_ENDED', 'Beendete Einsätze sind abgeschlossen.');
      const { version, registerData, ...patch } = input;
      await writeRegisterData(tx, a, current.personId, registerData);
      await tx
        .update(ve)
        .set({ ...patch, version: version + 1, updatedAt: new Date() })
        .where(and(eq(ve.organizationId, a.organizationId), eq(ve.id, id)));
      await engagementHistory(
        tx,
        a,
        id,
        version + 1,
        patch.status && patch.status !== current.status ? 'status' : 'update',
        {
          ...patch,
          ...(registerData
            ? { registerDataChanged: registerFields.filter((f) => f in registerData) }
            : {}),
        },
      );
      await audit(
        tx,
        a,
        'update',
        'volunteer_engagement',
        id,
        Object.keys(input).filter((k) => k !== 'version'),
      );
      return { id };
    },
  ).then(withDetail(db, a));
}
export function endEngagement(
  db: Database,
  a: Access,
  key: string,
  id: string,
  input: z.infer<typeof engagementEndSchema>,
) {
  return financialOperation(
    db,
    a,
    key,
    `volunteers:end:${id}`,
    input,
    'volunteers:write',
    async (tx) => {
      const current = await engagementRow(tx, a, id, true);
      if (current.version !== input.version)
        throw new HttpError(409, 'STALE_VERSION', 'Der Eintrag wurde zwischenzeitlich geändert.');
      if (current.status === 'ended')
        throw new HttpError(409, 'VOLUNTEER_ENDED', 'Beendete Einsätze sind abgeschlossen.');
      if (input.endedOn < current.startedOn)
        throw new HttpError(422, 'VALIDATION_ERROR', 'Das Ende liegt vor dem Beginn.');
      const [planned] = await tx
        .select({ n: count() })
        .from(s.volunteerAssignments)
        .where(
          and(
            eq(s.volunteerAssignments.organizationId, a.organizationId),
            eq(s.volunteerAssignments.engagementId, id),
            eq(s.volunteerAssignments.status, 'planned'),
            sql`${s.volunteerAssignments.plannedStart}>=(${input.endedOn}::date + 1)`,
          ),
        );
      if (planned!.n > 0)
        throw new HttpError(
          409,
          'VOLUNTEER_HAS_PLANNED',
          'Nach dem Austritt sind noch Einsätze geplant.',
        );
      await tx
        .update(ve)
        .set({
          status: 'ended',
          endedOn: input.endedOn,
          endReason: input.reason,
          version: input.version + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(ve.organizationId, a.organizationId), eq(ve.id, id)));
      await engagementHistory(tx, a, id, input.version + 1, 'end', {
        status: 'ended',
        endedOn: input.endedOn,
        reason: input.reason,
      });
      await audit(tx, a, 'end', 'volunteer_engagement', id, ['status', 'endedOn', 'endReason']);
      return { id };
    },
  ).then(withDetail(db, a));
}
// Dashboard figures across volunteers, insurance, register and compliance.
export async function volunteerOverview(db: Database, a: Access) {
  return readSnapshot(db, async (tx) => {
    const now = today();
    const engagements = await tx
      .select()
      .from(ve)
      .where(and(eq(ve.organizationId, a.organizationId), eq(ve.status, 'active')));
    const coverage = await coverageFor(tx, a.organizationId, engagements, now);
    const settings = await registerSettings(tx, a.organizationId);
    const [planned] = await tx
      .select({ n: count() })
      .from(s.volunteerAssignments)
      .where(
        and(
          eq(s.volunteerAssignments.organizationId, a.organizationId),
          eq(s.volunteerAssignments.status, 'planned'),
          sql`${s.volunteerAssignments.plannedStart}>=now()`,
        ),
      );
    const [hours] = await tx
      .select({
        confirmed: sql<number>`coalesce(sum(minutes) filter (where status='confirmed'),0)::int`,
        pending: sql<number>`coalesce(sum(minutes) filter (where status in ('draft','submitted')),0)::int`,
      })
      .from(s.volunteerTimeEntries)
      .where(
        and(
          eq(s.volunteerTimeEntries.organizationId, a.organizationId),
          sql`extract(year from ${s.volunteerTimeEntries.actualStart})=extract(year from now())`,
        ),
      );
    const [expiring] = await tx
      .select({ n: count() })
      .from(s.insurancePolicies)
      .where(
        and(
          eq(s.insurancePolicies.organizationId, a.organizationId),
          eq(s.insurancePolicies.status, 'active'),
          sql`${s.insurancePolicies.endsOn} between ${now}::date and ${now}::date + ${settings.expiryWarningDays}::int`,
        ),
      );
    const [snapshot] = await tx
      .select({
        snapshotNumber: s.volunteerRegisterSnapshots.snapshotNumber,
        cutoffDate: s.volunteerRegisterSnapshots.cutoffDate,
        status: s.volunteerRegisterSnapshots.status,
      })
      .from(s.volunteerRegisterSnapshots)
      .where(eq(s.volunteerRegisterSnapshots.organizationId, a.organizationId))
      .orderBy(desc(s.volunteerRegisterSnapshots.snapshotNumber))
      .limit(1);
    const [legal] = await tx
      .select({ n: count() })
      .from(s.complianceDeadlines)
      .where(
        and(
          eq(s.complianceDeadlines.organizationId, a.organizationId),
          eq(s.complianceDeadlines.kind, 'legal'),
          inArray(s.complianceDeadlines.status, ['open', 'in_progress']),
        ),
      );
    const unclear = [...coverage.values()].filter(
      (c) => c.status === 'unclear' || c.status === 'none',
    ).length;
    return {
      activeRegular: engagements.filter((e) => e.volunteerType === 'regular').length,
      activeOccasional: engagements.filter((e) => e.volunteerType === 'occasional').length,
      plannedAssignments: planned!.n,
      confirmedMinutesThisYear: hours!.confirmed,
      pendingMinutesThisYear: hours!.pending,
      unclearCoverage: can(a.role, 'insurance:read') ? unclear : null,
      expiringPolicies: can(a.role, 'insurance:read') ? expiring!.n : null,
      lastSnapshot: can(a.role, 'register:read') && snapshot ? wire(snapshot) : null,
      snapshotDue:
        can(a.role, 'register:read') &&
        (!snapshot ||
          Date.parse(now) - Date.parse(snapshot.cutoffDate) >
            settings.signatureIntervalDays * 86400000),
      openLegalDeadlines: can(a.role, 'compliance:read') ? legal!.n : null,
    };
  });
}
