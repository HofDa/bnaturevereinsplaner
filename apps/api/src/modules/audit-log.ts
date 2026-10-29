import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ModuleContext } from './context';
import { schema as s } from '@bnature/db';
import { and, eq, count, asc, desc, ilike, or } from 'drizzle-orm';
import { listQuerySchema } from '@bnature/contracts';
import { escapeLike } from './members';
export function registerAuditLogRoutes({ server, db, access }: ModuleContext) {
  const app = server.withTypeProvider<ZodTypeProvider>();
  const p = '/api/v1';
  app.get(
    `${p}/audit-logs`,
    { schema: { tags: ['Audit'], querystring: listQuerySchema } },
    async (req) => {
      const a = await access(req, 'audit:read'),
        q = req.query;
      const where = and(
        eq(s.auditLogs.organizationId, a.organizationId),
        q.search
          ? or(
              ilike(s.auditLogs.action, `%${escapeLike(q.search)}%`),
              ilike(s.auditLogs.entityType, `%${escapeLike(q.search)}%`),
            )
          : undefined,
      );
      const items = await db
        .select()
        .from(s.auditLogs)
        .where(where)
        .orderBy(
          q.direction === 'asc' ? asc(s.auditLogs.timestamp) : desc(s.auditLogs.timestamp),
          asc(s.auditLogs.id),
        )
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
      const [total] = await db.select({ n: count() }).from(s.auditLogs).where(where);
      return { items, total: total?.n ?? 0, page: q.page, pageSize: q.pageSize };
    },
  );
}
