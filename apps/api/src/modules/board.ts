import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ModuleContext } from './context';
import { schema as s } from '@bnature/db';
import { and, eq, count, asc, desc, ilike, or } from 'drizzle-orm';
import { patchSchema, idParams, listQuerySchema, boardSchema } from '@bnature/contracts';
import { HttpError } from '../middleware/access';
import { audit } from '../services/audit';
import { escapeLike } from './members';
import { pageOf, boardResponse } from './responses';
export function registerBoardRoutes({ server, db, access }: ModuleContext) {
  const app = server.withTypeProvider<ZodTypeProvider>();
  const p = '/api/v1';
  app.get(
    `${p}/board-mandates`,
    {
      schema: {
        tags: ['Board'],
        querystring: listQuerySchema,
        response: { 200: pageOf(boardResponse) },
      },
    },
    async (req) => {
      const a = await access(req, 'board:read'),
        q = req.query;
      const where = and(
        eq(s.boardMandates.organizationId, a.organizationId),
        q.search
          ? or(
              ilike(s.boardMandates.position, `%${escapeLike(q.search)}%`),
              ilike(s.persons.lastName, `%${escapeLike(q.search)}%`),
            )
          : undefined,
      );
      const items = await db
        .select({
          id: s.boardMandates.id,
          personId: s.boardMandates.personId,
          position: s.boardMandates.position,
          startDate: s.boardMandates.startDate,
          endDate: s.boardMandates.endDate,
          firstName: s.persons.firstName,
          lastName: s.persons.lastName,
        })
        .from(s.boardMandates)
        .innerJoin(
          s.persons,
          and(
            eq(s.persons.id, s.boardMandates.personId),
            eq(s.persons.organizationId, s.boardMandates.organizationId),
          ),
        )
        .where(where)
        .orderBy(
          q.direction === 'asc' ? asc(s.boardMandates.startDate) : desc(s.boardMandates.startDate),
          asc(s.boardMandates.id),
        )
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
      const [total] = await db
        .select({ n: count() })
        .from(s.boardMandates)
        .innerJoin(
          s.persons,
          and(
            eq(s.persons.id, s.boardMandates.personId),
            eq(s.persons.organizationId, s.boardMandates.organizationId),
          ),
        )
        .where(where);
      return { items, total: total?.n ?? 0, page: q.page, pageSize: q.pageSize };
    },
  );
  app.post(
    `${p}/board-mandates`,
    { schema: { tags: ['Board'], body: boardSchema } },
    async (req, reply) => {
      const a = await access(req, 'board:write');
      const result = await db.transaction(async (tx) => {
        const [person] = await tx
          .select({ id: s.persons.id })
          .from(s.persons)
          .where(
            and(
              eq(s.persons.id, req.body.personId),
              eq(s.persons.organizationId, a.organizationId),
            ),
          );
        if (!person) throw new HttpError(404, 'NOT_FOUND', 'Person nicht gefunden.');
        const [row] = await tx
          .insert(s.boardMandates)
          .values({ ...req.body, organizationId: a.organizationId })
          .returning();
        await audit(tx, a, 'create', 'board_mandate', row!.id, Object.keys(req.body));
        return row;
      });
      return reply.code(201).send(result);
    },
  );
  app.patch(
    `${p}/board-mandates/:id`,
    { schema: { tags: ['Board'], params: idParams, body: patchSchema(boardSchema) } },
    async (req) => {
      const a = await access(req, 'board:write');
      return db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(s.boardMandates)
          .where(
            and(
              eq(s.boardMandates.id, req.params.id),
              eq(s.boardMandates.organizationId, a.organizationId),
            ),
          )
          .for('update');
        if (!current) throw new HttpError(404, 'NOT_FOUND', 'Amtszeit nicht gefunden.');
        const input = boardSchema.parse({
          personId: current.personId,
          position: current.position,
          startDate: current.startDate,
          endDate: current.endDate,
          ...req.body,
        });
        const [person] = await tx
          .select({ id: s.persons.id })
          .from(s.persons)
          .where(
            and(eq(s.persons.id, input.personId), eq(s.persons.organizationId, a.organizationId)),
          );
        if (!person) throw new HttpError(404, 'NOT_FOUND', 'Person nicht gefunden.');
        const [row] = await tx
          .update(s.boardMandates)
          .set({ ...input, updatedAt: new Date() })
          .where(
            and(
              eq(s.boardMandates.id, current.id),
              eq(s.boardMandates.organizationId, a.organizationId),
            ),
          )
          .returning();
        await audit(tx, a, 'update', 'board_mandate', current.id, Object.keys(req.body));
        return row;
      });
    },
  );
}
