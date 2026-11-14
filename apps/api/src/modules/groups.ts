import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ModuleContext } from './context';
import { schema as s } from '@bnature/db';
import { and, eq, count, asc, desc, ilike, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  patchSchema,
  idParams,
  idSchema,
  listQuerySchema,
  groupSchema,
  can,
} from '@bnature/contracts';
import { HttpError, lockAccess } from '../middleware/access';
import { audit } from '../services/audit';
import { ownPerson } from './events';
import { escapeLike } from './members';
import { pageOf, groupResponse } from './responses';
export function registerGroupsRoutes({ server, db, access }: ModuleContext) {
  const app = server.withTypeProvider<ZodTypeProvider>();
  const p = '/api/v1';
  app.get(
    `${p}/groups`,
    {
      schema: {
        tags: ['Groups'],
        querystring: listQuerySchema,
        response: { 200: pageOf(groupResponse) },
      },
    },
    async (req) => {
      const a = await access(req, 'groups:read'),
        q = req.query,
        personId = await ownPerson(db, a);
      const where = and(
        eq(s.groups.organizationId, a.organizationId),
        q.search ? ilike(s.groups.name, `%${escapeLike(q.search)}%`) : undefined,
        q.active ? eq(s.groups.active, q.active === 'true') : undefined,
      );
      const items = await db
        .select({
          id: s.groups.id,
          name: s.groups.name,
          description: s.groups.description,
          active: s.groups.active,
          memberCount: sql<number>`cast((select count(*) from group_members gm where gm.group_id = groups.id and gm.organization_id = groups.organization_id) as int)`,
          isMember: personId
            ? sql<boolean>`exists(select 1 from group_members gm where gm.group_id = groups.id and gm.organization_id = groups.organization_id and gm.person_id = ${personId})`
            : sql<boolean>`false`,
        })
        .from(s.groups)
        .where(where)
        .orderBy(
          q.direction === 'asc'
            ? asc(q.sort === 'createdAt' ? s.groups.createdAt : s.groups.name)
            : desc(q.sort === 'createdAt' ? s.groups.createdAt : s.groups.name),
          asc(s.groups.id),
        )
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
      const [total] = await db.select({ n: count() }).from(s.groups).where(where);
      return { items, total: total?.n ?? 0, page: q.page, pageSize: q.pageSize };
    },
  );
  app.post(
    `${p}/groups`,
    { schema: { tags: ['Groups'], body: groupSchema, response: { 201: groupResponse } } },
    async (req, reply) => {
      const a = await access(req, 'groups:write');
      const row = await db.transaction(async (tx) => {
        await lockAccess(tx, a, 'groups:write');
        const [g] = await tx
          .insert(s.groups)
          .values({ ...req.body, organizationId: a.organizationId })
          .returning();
        await audit(tx, a, 'create', 'group', g!.id, Object.keys(req.body));
        return { ...g!, memberCount: 0 };
      });
      return reply.code(201).send(row);
    },
  );
  app.get(`${p}/groups/:id`, { schema: { tags: ['Groups'], params: idParams } }, async (req) => {
    const a = await access(req, 'groups:read');
    const [g] = await db
      .select()
      .from(s.groups)
      .where(and(eq(s.groups.id, req.params.id), eq(s.groups.organizationId, a.organizationId)));
    if (!g) throw new HttpError(404, 'NOT_FOUND', 'Gruppe nicht gefunden.');
    const [total] = await db
      .select({ n: count() })
      .from(s.groupMembers)
      .where(
        and(eq(s.groupMembers.groupId, g.id), eq(s.groupMembers.organizationId, a.organizationId)),
      );
    const members = can(a.role, 'members:read')
      ? await db
          .select({
            personId: s.persons.id,
            firstName: s.persons.firstName,
            lastName: s.persons.lastName,
          })
          .from(s.groupMembers)
          .innerJoin(
            s.persons,
            and(
              eq(s.persons.id, s.groupMembers.personId),
              eq(s.persons.organizationId, s.groupMembers.organizationId),
            ),
          )
          .where(
            and(
              eq(s.groupMembers.groupId, g.id),
              eq(s.groupMembers.organizationId, a.organizationId),
            ),
          )
          .orderBy(asc(s.persons.lastName))
      : [];
    const personId = await ownPerson(db, a);
    const [ownMembership] = personId
      ? await db
          .select({ id: s.groupMembers.id })
          .from(s.groupMembers)
          .where(
            and(
              eq(s.groupMembers.organizationId, a.organizationId),
              eq(s.groupMembers.groupId, g.id),
              eq(s.groupMembers.personId, personId),
            ),
          )
          .limit(1)
      : [];
    return { ...g, memberCount: total?.n ?? 0, isMember: Boolean(ownMembership), members };
  });
  app.patch(
    `${p}/groups/:id`,
    { schema: { tags: ['Groups'], params: idParams, body: patchSchema(groupSchema) } },
    async (req) => {
      const a = await access(req, 'groups:write');
      return db.transaction(async (tx) => {
        await lockAccess(tx, a, 'groups:write');
        const [g] = await tx
          .update(s.groups)
          .set({ ...req.body, updatedAt: new Date() })
          .where(and(eq(s.groups.id, req.params.id), eq(s.groups.organizationId, a.organizationId)))
          .returning();
        if (!g) throw new HttpError(404, 'NOT_FOUND', 'Gruppe nicht gefunden.');
        await audit(tx, a, 'update', 'group', g.id, Object.keys(req.body));
        return g;
      });
    },
  );
  app.put(
    `${p}/groups/:id/members`,
    {
      schema: {
        tags: ['Groups'],
        params: idParams,
        body: z.object({ personIds: z.array(idSchema).max(500) }).strict(),
      },
    },
    async (req) => {
      const a = await access(req, 'groups:write');
      return db.transaction(async (tx) => {
        const current = await lockAccess(tx, a, 'groups:write');
        if (!can(current.role, 'members:read'))
          throw new HttpError(403, 'FORBIDDEN', 'Personenzuordnungen erfordern Mitgliederzugriff.');
        const [g] = await tx
          .select()
          .from(s.groups)
          .where(and(eq(s.groups.id, req.params.id), eq(s.groups.organizationId, a.organizationId)))
          .for('update');
        if (!g) throw new HttpError(404, 'NOT_FOUND', 'Gruppe nicht gefunden.');
        const ids = [...new Set(req.body.personIds)];
        for (const id of ids) {
          const [person] = await tx
            .select({ id: s.persons.id })
            .from(s.persons)
            .where(and(eq(s.persons.id, id), eq(s.persons.organizationId, a.organizationId)));
          if (!person) throw new HttpError(404, 'NOT_FOUND', 'Person nicht gefunden.');
        }
        await tx
          .delete(s.groupMembers)
          .where(
            and(
              eq(s.groupMembers.groupId, g.id),
              eq(s.groupMembers.organizationId, a.organizationId),
            ),
          );
        if (ids.length)
          await tx.insert(s.groupMembers).values(
            ids.map((personId) => ({
              organizationId: a.organizationId,
              groupId: g.id,
              personId,
            })),
          );
        await audit(tx, a, 'update', 'group', g.id, ['members']);
        return { success: true };
      });
    },
  );
}
