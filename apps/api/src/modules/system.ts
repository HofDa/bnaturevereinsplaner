import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ModuleContext } from './context';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { permissions, can } from '@bnature/contracts';
export function registerSystemRoutes({ server, db, access }: ModuleContext) {
  const app = server.withTypeProvider<ZodTypeProvider>();
  const p = '/api/v1';
  app.get(
    `${p}/health`,
    {
      schema: {
        tags: ['System'],
        security: [],
        response: { 200: z.object({ status: z.literal('ok') }) },
      },
    },
    async () => {
      await db.execute(sql`select 1`);
      return { status: 'ok' as const };
    },
  );
  app.get(`${p}/me`, { schema: { tags: ['Session'] } }, async (req) => {
    const a = await access(req);
    return {
      user: a.user,
      organizations: a.organizations,
      role: a.role,
      activeOrganizationId: a.organizationId,
      timezone: a.organizations.find((org) => org.id === a.organizationId)?.timezone,
      permissions: permissions.filter((p) => can(a.role, p)),
    };
  });
}
