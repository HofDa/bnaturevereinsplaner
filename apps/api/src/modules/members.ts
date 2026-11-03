import { and, eq, or, ilike, asc, desc, count, sql } from 'drizzle-orm';
import { schema as s, type Database, type Executor } from '@bnature/db';
import { memberInputSchema, type MemberInput, type ListQuery } from '@bnature/contracts';
import { HttpError, type Access } from '../middleware/access';
import { audit } from '../services/audit';
// The latest recorded decision counts, as on the member page.
function consentOf(kind: 'photos' | 'data_processing') {
  return sql<
    'granted' | 'refused' | null
  >`(select case when c.granted then 'granted' else 'refused' end from person_consents c where c.organization_id=${s.persons.organizationId} and c.person_id=${s.persons.id} and c.kind=${kind} order by c.recorded_at desc, c.id desc limit 1)`;
}
const consentFilter = (
  kind: 'photos' | 'data_processing',
  value?: 'granted' | 'refused' | 'missing',
) =>
  !value
    ? undefined
    : value === 'missing'
      ? sql`${consentOf(kind)} is null`
      : sql`${consentOf(kind)} = ${value}`;
const selection = {
  id: s.memberships.id,
  personId: s.persons.id,
  firstName: s.persons.firstName,
  lastName: s.persons.lastName,
  dateOfBirth: s.persons.dateOfBirth,
  fiscalCode: s.persons.fiscalCode,
  email: s.persons.email,
  phone: s.persons.phone,
  street: s.persons.street,
  postalCode: s.persons.postalCode,
  city: s.persons.city,
  country: s.persons.country,
  preferredLanguage: s.persons.preferredLanguage,
  membershipNumber: s.memberships.membershipNumber,
  membershipType: s.memberships.membershipType,
  status: s.memberships.status,
  joinedAt: s.memberships.joinedAt,
  endedAt: s.memberships.endedAt,
  createdAt: s.memberships.createdAt,
  updatedAt: s.memberships.updatedAt,
  photoConsent: consentOf('photos'),
  dataConsent: consentOf('data_processing'),
  customFields: sql<
    Record<string, string | number | boolean>
  >`(select coalesce(jsonb_object_agg(v.field_id, v.value), '{}'::jsonb) from person_field_values v where v.organization_id=${s.persons.organizationId} and v.person_id=${s.persons.id})`,
};
const join = and(
  eq(s.persons.id, s.memberships.personId),
  eq(s.persons.organizationId, s.memberships.organizationId),
);
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');
export function splitMember(input: MemberInput) {
  const { membershipNumber, membershipType, status, joinedAt, endedAt, ...person } = input;
  return { person, membership: { membershipNumber, membershipType, status, joinedAt, endedAt } };
}
export async function getMember(db: Executor, organizationId: string, id: string) {
  const [member] = await db
    .select(selection)
    .from(s.memberships)
    .innerJoin(s.persons, join)
    .where(and(eq(s.memberships.organizationId, organizationId), eq(s.memberships.id, id)));
  if (!member) throw new HttpError(404, 'NOT_FOUND', 'Mitglied nicht gefunden.');
  return member;
}
export async function listMembers(db: Database, organizationId: string, q: ListQuery) {
  const search = `%${escapeLike(q.search)}%`;
  const where = and(
    eq(s.memberships.organizationId, organizationId),
    q.status ? eq(s.memberships.status, q.status) : undefined,
    consentFilter('photos', q.photoConsent),
    consentFilter('data_processing', q.dataConsent),
    q.search
      ? or(
          ilike(sql`${s.persons.firstName} || ' ' || ${s.persons.lastName}`, search),
          ilike(s.persons.email, search),
          ilike(s.memberships.membershipNumber, search),
        )
      : undefined,
  );
  const order = q.direction === 'asc' ? asc : desc;
  const sort =
    q.sort === 'createdAt'
      ? s.memberships.createdAt
      : q.sort === 'joinedAt'
        ? s.memberships.joinedAt
        : s.persons.lastName;
  return db.transaction(
    async (tx) => {
      const items = await tx
        .select(selection)
        .from(s.memberships)
        .innerJoin(s.persons, join)
        .where(where)
        .orderBy(order(sort), asc(s.memberships.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
      const [total] = await tx
        .select({ value: count() })
        .from(s.memberships)
        .innerJoin(s.persons, join)
        .where(where);
      return { items, total: total?.value ?? 0, page: q.page, pageSize: q.pageSize };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
export async function createMember(db: Database, access: Access, input: MemberInput) {
  return db.transaction(async (tx) => {
    const { person, membership } = splitMember(input);
    const [p] = await tx
      .insert(s.persons)
      .values({ ...person, organizationId: access.organizationId })
      .returning();
    if (!p) throw new Error('Person insert failed');
    const [m] = await tx
      .insert(s.memberships)
      .values({ ...membership, personId: p.id, organizationId: access.organizationId })
      .returning();
    if (!m) throw new Error('Membership insert failed');
    await audit(tx, access, 'create', 'membership', m.id, Object.keys(input));
    return getMember(tx, access.organizationId, m.id);
  });
}
export async function updateMember(
  db: Database,
  access: Access,
  id: string,
  patch: Partial<MemberInput>,
) {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: s.memberships.id })
      .from(s.memberships)
      .where(and(eq(s.memberships.organizationId, access.organizationId), eq(s.memberships.id, id)))
      .for('update');
    const current = await getMember(tx, access.organizationId, id);
    const input = memberInputSchema.parse({
      ...Object.fromEntries(
        Object.keys(memberInputSchema.shape).map((k) => [k, current[k as keyof typeof current]]),
      ),
      ...patch,
    });
    const { person, membership } = splitMember(input);
    await tx
      .update(s.persons)
      .set({ ...person, updatedAt: new Date() })
      .where(
        and(
          eq(s.persons.organizationId, access.organizationId),
          eq(s.persons.id, current.personId),
        ),
      );
    await tx
      .update(s.memberships)
      .set({ ...membership, updatedAt: new Date() })
      .where(
        and(eq(s.memberships.organizationId, access.organizationId), eq(s.memberships.id, id)),
      );
    await audit(tx, access, 'update', 'membership', id, Object.keys(patch));
    return getMember(tx, access.organizationId, id);
  });
}
