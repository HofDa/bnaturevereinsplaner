import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { schema as s, type Database, type Executor } from '@bnature/db';
import {
  idParams,
  ageOn,
  MAX_MEMBER_FIELDS,
  memberFieldInputSchema,
  memberFieldPatchSchema,
  memberFieldSchema,
  memberFieldValuesInputSchema,
  consentInputSchema,
  guardianInputSchema,
  guardianPatchSchema,
  guardianSchema,
  memberExtrasSchema,
  type MemberExtras,
  type MemberField,
} from '@bnature/contracts';
import { HttpError, type Access } from '../middleware/access';
import { audit } from '../services/audit';
import type { ModuleContext } from './context';
import { businessDate } from './finance/service';

const f = s.memberFieldDefinitions;
const v = s.personFieldValues;
const c = s.personConsents;
const g = s.personGuardians;

const field = (row: typeof f.$inferSelect): MemberField => ({
  id: row.id,
  labelI18n: row.labelI18n,
  type: row.type,
  options: row.options,
  position: row.position,
  active: row.active,
});

/** The person behind a membership ID, scoped to the organization. */
async function personOf(db: Executor, org: string, membershipId: string) {
  const [row] = await db
    .select({
      personId: s.memberships.personId,
      dateOfBirth: s.persons.dateOfBirth,
      newsletterOptOut: s.persons.newsletterOptOut,
    })
    .from(s.memberships)
    .innerJoin(
      s.persons,
      and(
        eq(s.persons.organizationId, s.memberships.organizationId),
        eq(s.persons.id, s.memberships.personId),
      ),
    )
    .where(and(eq(s.memberships.organizationId, org), eq(s.memberships.id, membershipId)));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Mitglied nicht gefunden.');
  return row;
}

/** Validates one value against its field type; `null` or '' clears the value. */
function normalize(def: typeof f.$inferSelect, value: string | number | boolean | null) {
  if (value === null || value === '') return null;
  const invalid = () =>
    new HttpError(422, 'MEMBER_FIELD_INVALID', 'Ungültiger Wert für ein Zusatzfeld.');
  switch (def.type) {
    case 'text':
      if (typeof value !== 'string') throw invalid();
      return value.trim().slice(0, 500) || null;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid();
      return value;
    case 'boolean':
      if (typeof value !== 'boolean') throw invalid();
      return value;
    case 'date':
      if (typeof value !== 'string' || !z.iso.date().safeParse(value).success) throw invalid();
      return value;
    case 'select':
      if (typeof value !== 'string' || !def.options.includes(value)) throw invalid();
      return value;
  }
}

export async function memberExtras(
  db: Database,
  access: Access,
  membershipId: string,
): Promise<MemberExtras> {
  return db.transaction(
    async (tx) => {
      const org = access.organizationId;
      const person = await personOf(tx, org, membershipId);
      const today = await businessDate(tx, org);
      const definitions = await tx
        .select()
        .from(f)
        .where(eq(f.organizationId, org))
        .orderBy(asc(f.position), asc(f.createdAt), asc(f.id));
      const values = new Map(
        (
          await tx
            .select()
            .from(v)
            .where(and(eq(v.organizationId, org), eq(v.personId, person.personId)))
        ).map((row) => [row.fieldId, row.value]),
      );
      const history = await tx
        .select({ consent: c, recordedBy: s.user.name })
        .from(c)
        .innerJoin(s.user, eq(s.user.id, c.recordedBy))
        .where(and(eq(c.organizationId, org), eq(c.personId, person.personId)))
        .orderBy(desc(c.recordedAt), desc(c.id));
      const consentHistory = history.map(({ consent, recordedBy }) => ({
        id: consent.id,
        kind: consent.kind,
        granted: consent.granted,
        decidedOn: consent.decidedOn,
        givenBy: consent.givenBy,
        note: consent.note,
        recordedBy,
        recordedAt: consent.recordedAt.toISOString(),
      }));
      const guardians = await tx
        .select()
        .from(g)
        .where(and(eq(g.organizationId, org), eq(g.personId, person.personId)))
        .orderBy(asc(g.createdAt), asc(g.id));
      return {
        isMinor: !!person.dateOfBirth && ageOn(person.dateOfBirth, today) < 18,
        newsletterOptOut: person.newsletterOptOut,
        // Inactive fields stay visible only where a value was stored before.
        fields: definitions
          .filter((d) => d.active || values.has(d.id))
          .map((d) => ({ field: field(d), value: values.get(d.id) ?? null })),
        consents: {
          data_processing: consentHistory.find((x) => x.kind === 'data_processing') ?? null,
          photos: consentHistory.find((x) => x.kind === 'photos') ?? null,
        },
        consentHistory,
        guardians: guardians.map((row) => guardianSchema.parse(row)),
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

export function registerMemberExtrasRoutes({ server, db, access }: ModuleContext) {
  const app = server.withTypeProvider<ZodTypeProvider>();
  const p = '/api/v1';
  const tags = ['Members'];
  const ok = z.object({ id: z.uuid() });
  const guardianParams = z.object({ id: z.uuid(), guardianId: z.uuid() });

  app.get(
    `${p}/member-fields`,
    { schema: { tags, response: { 200: z.object({ items: z.array(memberFieldSchema) }) } } },
    async (req) => {
      const a = await access(req, 'members:read');
      const rows = await db
        .select()
        .from(f)
        .where(eq(f.organizationId, a.organizationId))
        .orderBy(asc(f.position), asc(f.createdAt), asc(f.id));
      return { items: rows.map(field) };
    },
  );
  app.post(
    `${p}/member-fields`,
    { schema: { tags, body: memberFieldInputSchema, response: { 201: memberFieldSchema } } },
    async (req, reply) => {
      const a = await access(req, 'organization:write');
      const row = await db.transaction(async (tx) => {
        await tx
          .select({ id: s.organizations.id })
          .from(s.organizations)
          .where(eq(s.organizations.id, a.organizationId))
          .for('no key update');
        const [existing] = await tx
          .select({ n: count() })
          .from(f)
          .where(eq(f.organizationId, a.organizationId));
        if ((existing?.n ?? 0) >= MAX_MEMBER_FIELDS)
          throw new HttpError(
            409,
            'LIMIT_REACHED',
            `Höchstens ${MAX_MEMBER_FIELDS} Zusatzfelder je Verein.`,
          );
        const [created] = await tx
          .insert(f)
          .values({ ...req.body, organizationId: a.organizationId, position: existing?.n ?? 0 })
          .returning();
        await audit(tx, a, 'create', 'member_field_definition', created!.id, Object.keys(req.body));
        return created!;
      });
      return reply.code(201).send(field(row));
    },
  );
  app.patch(
    `${p}/member-fields/:id`,
    {
      schema: {
        tags,
        params: idParams,
        body: memberFieldPatchSchema,
        response: { 200: memberFieldSchema },
      },
    },
    async (req) => {
      const a = await access(req, 'organization:write');
      return db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(f)
          .where(and(eq(f.organizationId, a.organizationId), eq(f.id, req.params.id)))
          .for('update');
        if (!current) throw new HttpError(404, 'NOT_FOUND', 'Zusatzfeld nicht gefunden.');
        const options = req.body.options ?? current.options;
        // Re-validate type/options together; the type itself is immutable.
        memberFieldInputSchema.parse({
          labelI18n: req.body.labelI18n ?? current.labelI18n,
          type: current.type,
          options,
        });
        const [row] = await tx
          .update(f)
          .set({ ...req.body, options, updatedAt: new Date() })
          .where(and(eq(f.organizationId, a.organizationId), eq(f.id, current.id)))
          .returning();
        await audit(tx, a, 'update', 'member_field_definition', current.id, Object.keys(req.body));
        return field(row!);
      });
    },
  );

  app.get(
    `${p}/members/:id/extras`,
    { schema: { tags, params: idParams, response: { 200: memberExtrasSchema } } },
    async (req) => memberExtras(db, await access(req, 'members:read'), req.params.id),
  );
  app.put(
    `${p}/members/:id/fields`,
    {
      schema: {
        tags,
        params: idParams,
        body: memberFieldValuesInputSchema,
        response: { 200: memberExtrasSchema },
      },
    },
    async (req) => {
      const a = await access(req, 'members:write');
      await db.transaction(async (tx) => {
        const person = await personOf(tx, a.organizationId, req.params.id);
        const ids = Object.keys(req.body.values);
        if (!ids.length) return;
        const definitions = await tx
          .select()
          .from(f)
          .where(and(eq(f.organizationId, a.organizationId), inArray(f.id, ids)));
        if (definitions.length !== ids.length)
          throw new HttpError(404, 'NOT_FOUND', 'Zusatzfeld nicht gefunden.');
        for (const def of definitions) {
          const value = normalize(def, req.body.values[def.id] ?? null);
          const key = and(eq(v.personId, person.personId), eq(v.fieldId, def.id));
          if (value === null) await tx.delete(v).where(key);
          else
            await tx
              .insert(v)
              .values({
                organizationId: a.organizationId,
                personId: person.personId,
                fieldId: def.id,
                value,
                updatedBy: a.userId,
              })
              .onConflictDoUpdate({
                target: [v.personId, v.fieldId],
                set: { value, updatedBy: a.userId, updatedAt: new Date() },
              });
        }
        await audit(tx, a, 'update', 'membership_fields', req.params.id, ids);
      });
      return memberExtras(db, a, req.params.id);
    },
  );
  app.post(
    `${p}/members/:id/consents`,
    { schema: { tags, params: idParams, body: consentInputSchema, response: { 201: ok } } },
    async (req, reply) => {
      const a = await access(req, 'members:write');
      const id = await db.transaction(async (tx) => {
        const person = await personOf(tx, a.organizationId, req.params.id);
        if (req.body.decidedOn > (await businessDate(tx, a.organizationId)))
          throw new HttpError(422, 'CONSENT_FUTURE_DATE', 'Das Datum liegt in der Zukunft.');
        const [row] = await tx
          .insert(c)
          .values({
            ...req.body,
            organizationId: a.organizationId,
            personId: person.personId,
            recordedBy: a.userId,
          })
          .returning({ id: c.id });
        await audit(tx, a, 'create', 'person_consent', row!.id, ['kind', 'granted', 'decidedOn']);
        return row!.id;
      });
      return reply.code(201).send({ id });
    },
  );
  app.post(
    `${p}/members/:id/guardians`,
    {
      schema: {
        tags,
        params: idParams,
        body: guardianInputSchema,
        response: { 201: guardianSchema },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'members:write');
      const row = await db.transaction(async (tx) => {
        const person = await personOf(tx, a.organizationId, req.params.id);
        const [existing] = await tx
          .select({ n: count() })
          .from(g)
          .where(and(eq(g.organizationId, a.organizationId), eq(g.personId, person.personId)));
        if ((existing?.n ?? 0) >= 5)
          throw new HttpError(409, 'LIMIT_REACHED', 'Höchstens fünf Erziehungsberechtigte.');
        const [created] = await tx
          .insert(g)
          .values({ ...req.body, organizationId: a.organizationId, personId: person.personId })
          .returning();
        await audit(tx, a, 'create', 'person_guardian', created!.id, Object.keys(req.body));
        return created!;
      });
      return reply.code(201).send(guardianSchema.parse(row));
    },
  );
  app.patch(
    `${p}/members/:id/guardians/:guardianId`,
    {
      schema: {
        tags,
        params: guardianParams,
        body: guardianPatchSchema,
        response: { 200: guardianSchema },
      },
    },
    async (req) => {
      const a = await access(req, 'members:write');
      return db.transaction(async (tx) => {
        const person = await personOf(tx, a.organizationId, req.params.id);
        const [row] = await tx
          .update(g)
          .set({ ...req.body, updatedAt: new Date() })
          .where(
            and(
              eq(g.organizationId, a.organizationId),
              eq(g.personId, person.personId),
              eq(g.id, req.params.guardianId),
            ),
          )
          .returning();
        if (!row) throw new HttpError(404, 'NOT_FOUND', 'Eintrag nicht gefunden.');
        await audit(tx, a, 'update', 'person_guardian', row.id, Object.keys(req.body));
        return guardianSchema.parse(row);
      });
    },
  );
  app.delete(
    `${p}/members/:id/guardians/:guardianId`,
    { schema: { tags, params: guardianParams } },
    async (req, reply) => {
      const a = await access(req, 'members:write');
      await db.transaction(async (tx) => {
        const person = await personOf(tx, a.organizationId, req.params.id);
        const [row] = await tx
          .delete(g)
          .where(
            and(
              eq(g.organizationId, a.organizationId),
              eq(g.personId, person.personId),
              eq(g.id, req.params.guardianId),
            ),
          )
          .returning({ id: g.id });
        if (!row) throw new HttpError(404, 'NOT_FOUND', 'Eintrag nicht gefunden.');
        await audit(tx, a, 'delete', 'person_guardian', row.id, []);
      });
      return reply.code(204).send();
    },
  );
}
