import { and, desc, eq, inArray } from 'drizzle-orm';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { schema as s, type Executor } from '@bnature/db';
import {
  idParams,
  newsletterInputSchema,
  newsletterSchema,
  newsletterUpdateSchema,
  type NewsletterInput,
} from '@bnature/contracts';
import { HttpError, type Access } from '../middleware/access';
import { audit } from '../services/audit';
import type { ModuleContext } from './context';
import { ownPerson } from './events';

const n = s.mailNewsletters;
const view = (row: typeof n.$inferSelect) =>
  newsletterSchema.parse({
    id: row.id,
    subjectI18n: row.subjectI18n,
    bodyI18n: row.bodyI18n,
    groupIds: row.groupIds,
    status: row.status,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
  });

async function checkGroups(db: Executor, a: Access, input: NewsletterInput) {
  const ids = [...new Set(input.groupIds)];
  if (!ids.length) return ids;
  const found = await db
    .select({ id: s.groups.id })
    .from(s.groups)
    .where(
      and(
        eq(s.groups.organizationId, a.organizationId),
        inArray(s.groups.id, ids),
        eq(s.groups.active, true),
      ),
    );
  if (found.length !== ids.length) throw new HttpError(404, 'NOT_FOUND', 'Gruppe nicht gefunden.');
  return ids;
}

async function draft(db: Executor, a: Access, id: string) {
  const [row] = await db
    .select()
    .from(n)
    .where(and(eq(n.organizationId, a.organizationId), eq(n.id, id)))
    .for('update');
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Newsletter nicht gefunden.');
  if (row.status !== 'draft')
    throw new HttpError(
      409,
      'NEWSLETTER_NOT_DRAFT',
      'Dieser Newsletter wurde bereits versendet oder zurückgezogen.',
    );
  return row;
}

const optOutSchema = z.object({ optOut: z.boolean() }).strict();

export function registerNewsletterRoutes({ server, db, access }: ModuleContext) {
  const app = server.withTypeProvider<ZodTypeProvider>();
  const p = '/api/v1';
  const tags = ['Mail'];

  app.get(
    `${p}/mail/newsletters`,
    { schema: { tags, response: { 200: z.object({ items: z.array(newsletterSchema) }) } } },
    async (req) => {
      const a = await access(req, 'mail:invite');
      const rows = await db
        .select()
        .from(n)
        .where(and(eq(n.organizationId, a.organizationId), inArray(n.status, ['draft', 'sent'])))
        .orderBy(desc(n.createdAt))
        .limit(50);
      return { items: rows.map(view) };
    },
  );
  app.post(
    `${p}/mail/newsletters`,
    { schema: { tags, body: newsletterInputSchema, response: { 201: newsletterSchema } } },
    async (req, reply) => {
      const a = await access(req, 'mail:invite');
      const row = await db.transaction(async (tx) => {
        const groupIds = await checkGroups(tx, a, req.body);
        const [created] = await tx
          .insert(n)
          .values({ ...req.body, groupIds, organizationId: a.organizationId, createdBy: a.userId })
          .returning();
        await audit(tx, a, 'create', 'mail_newsletter', created!.id, [
          'subjectI18n',
          'bodyI18n',
          'groupIds',
        ]);
        return created!;
      });
      return reply.code(201).send(view(row));
    },
  );
  app.put(
    `${p}/mail/newsletters/:id`,
    {
      schema: {
        tags,
        params: idParams,
        body: newsletterUpdateSchema,
        response: { 200: newsletterSchema },
      },
    },
    async (req) => {
      const a = await access(req, 'mail:invite');
      return db.transaction(async (tx) => {
        const current = await draft(tx, a, req.params.id);
        if (current.version !== req.body.version)
          throw new HttpError(409, 'CONFLICT', 'Der Entwurf wurde inzwischen geändert.');
        const { version, ...input } = req.body;
        const groupIds = await checkGroups(tx, a, input);
        const [row] = await tx
          .update(n)
          .set({ ...input, groupIds, version: version + 1, updatedAt: new Date() })
          .where(and(eq(n.organizationId, a.organizationId), eq(n.id, current.id)))
          .returning();
        await audit(tx, a, 'update', 'mail_newsletter', current.id, [
          'subjectI18n',
          'bodyI18n',
          'groupIds',
        ]);
        return view(row!);
      });
    },
  );
  app.post(
    `${p}/mail/newsletters/:id/withdraw`,
    { schema: { tags, params: idParams, response: { 200: newsletterSchema } } },
    async (req) => {
      const a = await access(req, 'mail:invite');
      return db.transaction(async (tx) => {
        const current = await draft(tx, a, req.params.id);
        const [row] = await tx
          .update(n)
          .set({ status: 'withdrawn', version: current.version + 1, updatedAt: new Date() })
          .where(and(eq(n.organizationId, a.organizationId), eq(n.id, current.id)))
          .returning();
        await audit(tx, a, 'withdraw', 'mail_newsletter', current.id, ['status']);
        return view(row!);
      });
    },
  );

  // Own subscription (profile); accounts without a linked person have none.
  app.get(
    `${p}/profile/newsletter`,
    { schema: { tags, response: { 200: z.object({ linked: z.boolean(), optOut: z.boolean() }) } } },
    async (req) => {
      const a = await access(req, 'organization:read');
      const personId = await ownPerson(db, a);
      if (!personId) return { linked: false, optOut: false };
      const [person] = await db
        .select({ optOut: s.persons.newsletterOptOut })
        .from(s.persons)
        .where(and(eq(s.persons.organizationId, a.organizationId), eq(s.persons.id, personId)));
      return { linked: true, optOut: person?.optOut ?? false };
    },
  );
  app.put(
    `${p}/profile/newsletter`,
    {
      schema: {
        tags,
        body: optOutSchema,
        response: { 200: z.object({ linked: z.boolean(), optOut: z.boolean() }) },
      },
    },
    async (req) => {
      const a = await access(req, 'organization:read');
      return db.transaction(async (tx) => {
        const personId = await ownPerson(tx, a);
        if (!personId)
          throw new HttpError(
            409,
            'PROFILE_UNLINKED',
            'Ihr Konto ist mit keiner Person verknüpft.',
          );
        await tx
          .update(s.persons)
          .set({ newsletterOptOut: req.body.optOut, updatedAt: new Date() })
          .where(and(eq(s.persons.organizationId, a.organizationId), eq(s.persons.id, personId)));
        await audit(tx, a, 'update', 'person', personId, ['newsletterOptOut']);
        return { linked: true, optOut: req.body.optOut };
      });
    },
  );
  // Recorded by the club, e.g. after an unsubscribe request by e-mail or phone.
  app.put(
    `${p}/members/:id/newsletter`,
    {
      schema: {
        tags,
        params: idParams,
        body: optOutSchema,
        response: { 200: z.object({ optOut: z.boolean() }) },
      },
    },
    async (req) => {
      const a = await access(req, 'members:write');
      return db.transaction(async (tx) => {
        const [member] = await tx
          .select({ personId: s.memberships.personId })
          .from(s.memberships)
          .where(
            and(
              eq(s.memberships.organizationId, a.organizationId),
              eq(s.memberships.id, req.params.id),
            ),
          );
        if (!member) throw new HttpError(404, 'NOT_FOUND', 'Mitglied nicht gefunden.');
        await tx
          .update(s.persons)
          .set({ newsletterOptOut: req.body.optOut, updatedAt: new Date() })
          .where(
            and(eq(s.persons.organizationId, a.organizationId), eq(s.persons.id, member.personId)),
          );
        await audit(tx, a, 'update', 'person', member.personId, ['newsletterOptOut']);
        return { optOut: req.body.optOut };
      });
    },
  );
}
