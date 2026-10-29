import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ModuleContext } from './context';
import { schema as s } from '@bnature/db';
import { and, eq, count, asc, or, gte, isNull, lte } from 'drizzle-orm';
import { listQuerySchema } from '@bnature/contracts';
import { listMembers } from './members';
export function registerDashboardRoutes({ server, db, access }: ModuleContext) {
  const app = server.withTypeProvider<ZodTypeProvider>();
  const p = '/api/v1';
  app.get(`${p}/dashboard`, { schema: { tags: ['Dashboard'] } }, async (req) => {
    const a = await access(req, 'members:read');
    const now = new Date();
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
        .toISOString()
        .slice(0, 10),
      today = now.toISOString().slice(0, 10);
    const statuses = { active: 0, pending: 0, inactive: 0, resigned: 0 };
    const rows = await db
      .select({ status: s.memberships.status, n: count() })
      .from(s.memberships)
      .where(eq(s.memberships.organizationId, a.organizationId))
      .groupBy(s.memberships.status);
    for (const r of rows) statuses[r.status] = r.n;
    const [newMembers] = await db
      .select({ n: count() })
      .from(s.memberships)
      .where(
        and(
          eq(s.memberships.organizationId, a.organizationId),
          gte(s.memberships.joinedAt, since),
          lte(s.memberships.joinedAt, today),
        ),
      );
    const [groups] = await db
      .select({ n: count() })
      .from(s.groups)
      .where(and(eq(s.groups.organizationId, a.organizationId), eq(s.groups.active, true)));
    const recent = await listMembers(
      db,
      a.organizationId,
      listQuerySchema.parse({ sort: 'createdAt', direction: 'desc', pageSize: 5 }),
    );
    const board = await db
      .select({
        id: s.boardMandates.id,
        personId: s.boardMandates.personId,
        firstName: s.persons.firstName,
        lastName: s.persons.lastName,
        position: s.boardMandates.position,
        startDate: s.boardMandates.startDate,
        endDate: s.boardMandates.endDate,
      })
      .from(s.boardMandates)
      .innerJoin(
        s.persons,
        and(
          eq(s.persons.id, s.boardMandates.personId),
          eq(s.persons.organizationId, s.boardMandates.organizationId),
        ),
      )
      .where(
        and(
          eq(s.boardMandates.organizationId, a.organizationId),
          lte(s.boardMandates.startDate, today),
          or(isNull(s.boardMandates.endDate), gte(s.boardMandates.endDate, today)),
        ),
      )
      .orderBy(asc(s.boardMandates.startDate));
    return {
      activeMembers: statuses.active,
      totalMembers: rows.reduce((n, r) => n + r.n, 0),
      newMembers: newMembers?.n ?? 0,
      activeGroups: groups?.n ?? 0,
      statuses,
      recentMembers: recent.items,
      board,
    };
  });
}
