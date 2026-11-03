import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ModuleContext } from './context';
import { schema as s } from '@bnature/db';
import { and, eq, count, asc, desc, ilike, or } from 'drizzle-orm';
import { z } from 'zod';
import { idParams, listQuerySchema, userProvisionSchema, roleSchema } from '@bnature/contracts';
import { HttpError, lockAccess } from '../middleware/access';
import { createAuth } from '../auth';
import { audit } from '../services/audit';
import { escapeLike } from './members';
export function registerUsersRoutes({ server, db, access, config }: ModuleContext) {
  const app = server.withTypeProvider<ZodTypeProvider>();
  const p = '/api/v1';
  app.get(
    `${p}/users`,
    { schema: { tags: ['Users'], querystring: listQuerySchema } },
    async (req) => {
      const a = await access(req, 'users:manage'),
        q = req.query;
      const where = and(
        eq(s.organizationUserRoles.organizationId, a.organizationId),
        q.search
          ? or(
              ilike(s.user.name, `%${escapeLike(q.search)}%`),
              ilike(s.user.email, `%${escapeLike(q.search)}%`),
            )
          : undefined,
      );
      const items = await db
        .select({
          id: s.user.id,
          name: s.user.name,
          email: s.user.email,
          role: s.organizationUserRoles.role,
        })
        .from(s.organizationUserRoles)
        .innerJoin(s.user, eq(s.user.id, s.organizationUserRoles.userId))
        .where(where)
        .orderBy(q.direction === 'asc' ? asc(s.user.name) : desc(s.user.name), asc(s.user.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
      const [total] = await db
        .select({ n: count() })
        .from(s.organizationUserRoles)
        .innerJoin(s.user, eq(s.user.id, s.organizationUserRoles.userId))
        .where(where);
      return { items, total: total?.n ?? 0, page: q.page, pageSize: q.pageSize };
    },
  );
  app.post(
    `${p}/users`,
    {
      schema: { tags: ['Users'], body: userProvisionSchema },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const a = await access(req, 'users:manage');
      const row = await db.transaction(async (tx) => {
        await lockAccess(tx, a, 'users:manage');
        const [existingUser] = await tx
          .select({ id: s.user.id })
          .from(s.user)
          .where(eq(s.user.email, req.body.email.toLowerCase()));
        if (existingUser)
          throw new HttpError(
            409,
            'CONFLICT',
            'Ein Konto mit dieser E-Mail ist bereits vorhanden.',
          );
        if (req.body.personId) {
          const [person] = await tx
            .select({ id: s.persons.id })
            .from(s.persons)
            .where(
              and(
                eq(s.persons.organizationId, a.organizationId),
                eq(s.persons.id, req.body.personId),
              ),
            );
          if (!person) throw new HttpError(404, 'NOT_FOUND', 'Person nicht gefunden.');
        }
        const provision = createAuth(tx, config, true);
        const created = await provision.api.signUpEmail({
          body: { name: req.body.name, email: req.body.email, password: req.body.password },
        });
        await tx.insert(s.organizationUserRoles).values({
          organizationId: a.organizationId,
          userId: created.user.id,
          role: req.body.role,
        });
        if (req.body.personId)
          await tx.insert(s.personUserLinks).values({
            organizationId: a.organizationId,
            userId: created.user.id,
            personId: req.body.personId,
          });
        await audit(tx, a, 'create', 'user', created.user.id, ['name', 'email', 'role']);
        return {
          id: created.user.id,
          name: created.user.name,
          email: created.user.email,
          role: req.body.role,
        };
      });
      return reply.code(201).send(row);
    },
  );
  app.patch(
    `${p}/users/:id/role`,
    {
      schema: { tags: ['Users'], params: idParams, body: z.object({ role: roleSchema }).strict() },
    },
    async (req) => {
      const a = await access(req, 'users:manage');
      return db.transaction(async (tx) => {
        await lockAccess(tx, a, 'users:manage');
        const [target] = await tx
          .select()
          .from(s.organizationUserRoles)
          .where(
            and(
              eq(s.organizationUserRoles.organizationId, a.organizationId),
              eq(s.organizationUserRoles.userId, req.params.id),
            ),
          );
        if (!target) throw new HttpError(404, 'NOT_FOUND', 'Benutzer nicht gefunden.');
        if (target.role === 'admin' && req.body.role !== 'admin') {
          const [admins] = await tx
            .select({ n: count() })
            .from(s.organizationUserRoles)
            .where(
              and(
                eq(s.organizationUserRoles.organizationId, a.organizationId),
                eq(s.organizationUserRoles.role, 'admin'),
              ),
            );
          if ((admins?.n ?? 0) <= 1)
            throw new HttpError(
              409,
              'LAST_ADMIN',
              'Der letzte Administrator kann nicht herabgestuft werden.',
            );
        }
        await tx
          .update(s.organizationUserRoles)
          .set({ role: req.body.role })
          .where(
            and(
              eq(s.organizationUserRoles.organizationId, a.organizationId),
              eq(s.organizationUserRoles.userId, req.params.id),
            ),
          );
        await audit(tx, a, 'update', 'user', req.params.id, ['role']);
        return { success: true };
      });
    },
  );
}
