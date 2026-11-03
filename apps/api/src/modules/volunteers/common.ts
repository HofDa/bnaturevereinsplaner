import { businessDate } from '../../services/business-date';
import { and, eq, inArray, sql, asc } from 'drizzle-orm';
import { schema as s, type Executor, type Transaction } from '@bnature/db';
import {
  assessCoverage,
  can,
  registerDataIssues,
  type InsuranceType,
  type Permission,
  type RegisterIdentity,
  type RegisterSection,
} from '@bnature/contracts';
import { HttpError, type Access } from '../../middleware/access';

export const ve = s.volunteerEngagements;

export function requirePermission(a: Access, permission: Permission) {
  if (!can(a.role, permission))
    throw new HttpError(403, 'FORBIDDEN', 'Diese Aktion ist für Ihre Rolle nicht freigegeben.');
}
export async function engagementRow(db: Executor, a: Access, id: string, lock = false) {
  const query = db
    .select()
    .from(ve)
    .where(and(eq(ve.organizationId, a.organizationId), eq(ve.id, id)));
  const [row] = lock ? await query.for('update') : await query;
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Freiwilligeneinsatz nicht gefunden.');
  return row;
}
const identityOf = (p: typeof s.persons.$inferSelect): RegisterIdentity => ({
  firstName: p.firstName,
  lastName: p.lastName,
  fiscalCode: p.fiscalCode,
  dateOfBirth: p.dateOfBirth,
  birthPlace: p.birthPlace,
  street: p.street,
  postalCode: p.postalCode,
  city: p.city,
  country: p.country,
  domicile: p.domicile,
});
export async function personIdentity(
  db: Executor,
  organizationId: string,
  personId: string,
): Promise<RegisterIdentity> {
  const [p] = await db
    .select()
    .from(s.persons)
    .where(and(eq(s.persons.organizationId, organizationId), eq(s.persons.id, personId)));
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'Person nicht gefunden.');
  return identityOf(p);
}
// Batch variant for lists, keyed by person id.
export async function personIdentities(db: Executor, organizationId: string, personIds: string[]) {
  const rows = personIds.length
    ? await db
        .select()
        .from(s.persons)
        .where(and(eq(s.persons.organizationId, organizationId), inArray(s.persons.id, personIds)))
    : [];
  return new Map(rows.map((p) => [p.id, identityOf(p)]));
}
export const sectionFor = (type: 'regular' | 'occasional'): RegisterSection =>
  type === 'regular' ? 'main' : 'occasional';
export async function registerSettings(db: Executor, organizationId: string) {
  const [row] = await db
    .select()
    .from(s.volunteerRegisterSettings)
    .where(eq(s.volunteerRegisterSettings.organizationId, organizationId));
  return {
    occasionalSection: row?.occasionalSection ?? true,
    signatureIntervalDays: row?.signatureIntervalDays ?? 365,
    signatureProcedure: row?.signatureProcedure ?? '',
    insuranceRetentionYears: row?.insuranceRetentionYears ?? 10,
    registerRetentionYears: row?.registerRetentionYears ?? 10,
    expiryWarningDays: row?.expiryWarningDays ?? 60,
    legalApprovalReference: row?.legalApprovalReference ?? '',
    legalApprovedOn: row?.legalApprovedOn ?? null,
    version: row?.version ?? 0,
  };
}
export async function registerEntriesFor(db: Executor, organizationId: string, ids: string[]) {
  if (!ids.length) return [];
  return db
    .select()
    .from(s.volunteerRegisterEntries)
    .where(
      and(
        eq(s.volunteerRegisterEntries.organizationId, organizationId),
        inArray(s.volunteerRegisterEntries.engagementId, ids),
      ),
    )
    .orderBy(asc(s.volunteerRegisterEntries.section), asc(s.volunteerRegisterEntries.entryNumber));
}
type EngagementLike = typeof ve.$inferSelect;
type EntryLike = typeof s.volunteerRegisterEntries.$inferSelect;
// Compares the last registered data with the current person record and engagement dates.
export function registeredData(identity: RegisterIdentity, engagement: EngagementLike) {
  return {
    ...identity,
    startedOn: engagement.startedOn,
    endedOn: engagement.endedOn,
  };
}
export function registerState(
  engagement: EngagementLike,
  entries: EntryLike[],
  identity: RegisterIdentity | null,
  occasionalSection: boolean,
) {
  const own = entries.filter((e) => e.engagementId === engagement.id);
  if (engagement.volunteerType === 'occasional' && !occasionalSection && !own.length)
    return 'closed' as const;
  const admission = own.find((e) => e.entryType === 'admission');
  if (!admission) return 'pending_admission' as const;
  const exit = own.find((e) => e.entryType === 'exit');
  if (engagement.endedOn && !exit) return 'pending_exit' as const;
  if (identity) {
    const last = own.at(-1)!;
    const current = registeredData(identity, engagement);
    const recorded = last.data as Record<string, unknown>;
    if (
      Object.entries(current).some(
        ([key, value]) => key !== 'endedOn' && (recorded[key] ?? null) !== (value ?? null),
      )
    )
      return 'pending_correction' as const;
  }
  return exit ? ('closed' as const) : ('registered' as const);
}
export function identityIssues(identity: RegisterIdentity) {
  return registerDataIssues(identity);
}
// Loads everything the indicative coverage assessment needs for a set of engagements.
export async function coverageFor(
  db: Executor,
  organizationId: string,
  engagements: EngagementLike[],
  date?: string,
) {
  date ??= await businessDate(db, organizationId);
  const result = new Map<string, ReturnType<typeof assessCoverage>>();
  if (!engagements.length) return result;
  const assess = await coverageAssessor(
    db,
    organizationId,
    engagements.map((e) => e.id),
  );
  for (const engagement of engagements) result.set(engagement.id, assess(engagement, date));
  return result;
}
// Loads coverage data for many engagements at once; the result assesses any of them on any date.
export async function coverageAssessor(db: Executor, organizationId: string, ids: string[]) {
  const rows = await db
    .select({
      engagementId: s.insuranceCoverages.engagementId,
      coveredFrom: s.insuranceCoverages.coveredFrom,
      coveredTo: s.insuranceCoverages.coveredTo,
      policyId: s.insurancePolicies.id,
      status: s.insurancePolicies.status,
      startsOn: s.insurancePolicies.startsOn,
      endsOn: s.insurancePolicies.endsOn,
      coverageTypes: s.insurancePolicies.coverageTypes,
      hasDocument: sql<boolean>`exists(select 1 from documents d where d.organization_id=${s.insurancePolicies.organizationId} and d.insurance_policy_id=${s.insurancePolicies.id})`,
      notified: sql<boolean>`exists(select 1 from insurer_notification_items i join insurer_notifications n on n.organization_id=i.organization_id and n.id=i.notification_id where i.organization_id=${s.insuranceCoverages.organizationId} and i.engagement_id=${s.insuranceCoverages.engagementId} and n.policy_id=${s.insurancePolicies.id})`,
    })
    .from(s.insuranceCoverages)
    .innerJoin(
      s.insurancePolicies,
      and(
        eq(s.insurancePolicies.organizationId, s.insuranceCoverages.organizationId),
        eq(s.insurancePolicies.id, s.insuranceCoverages.policyId),
      ),
    )
    .where(
      and(
        eq(s.insuranceCoverages.organizationId, organizationId),
        inArray(s.insuranceCoverages.engagementId, ids),
      ),
    );
  const admissions = await db
    .select({
      engagementId: s.volunteerRegisterEntries.engagementId,
      effectiveDate: sql<string>`min(${s.volunteerRegisterEntries.effectiveDate})`,
    })
    .from(s.volunteerRegisterEntries)
    .where(
      and(
        eq(s.volunteerRegisterEntries.organizationId, organizationId),
        inArray(s.volunteerRegisterEntries.engagementId, ids),
        eq(s.volunteerRegisterEntries.entryType, 'admission'),
      ),
    )
    .groupBy(s.volunteerRegisterEntries.engagementId);
  return (engagement: EngagementLike, date: string) =>
    assessCoverage({
      date,
      engagement,
      registeredOn: admissions.find((x) => x.engagementId === engagement.id)?.effectiveDate ?? null,
      coverages: rows
        .filter((r) => r.engagementId === engagement.id)
        .map((r) => ({
          coveredFrom: r.coveredFrom,
          coveredTo: r.coveredTo,
          notified: r.notified,
          policy: {
            status: r.status,
            startsOn: r.startsOn,
            endsOn: r.endsOn,
            coverageTypes: r.coverageTypes as InsuranceType[],
            hasDocument: r.hasDocument,
          },
        })),
    });
}
export async function engagementHistory(
  tx: Transaction,
  a: Access,
  engagementId: string,
  version: number,
  action: string,
  changes: Record<string, unknown>,
) {
  await tx.insert(s.volunteerEngagementHistory).values({
    organizationId: a.organizationId,
    engagementId,
    version,
    action,
    changes,
    actorUserId: a.userId,
  });
}
// Re-read inside write transactions; project leads only act on events they manage.
export { currentAccess as currentRole } from '../../middleware/access';
