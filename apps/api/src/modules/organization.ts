import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ModuleContext } from './context';
import { schema as s } from '@bnature/db';
import { eq } from 'drizzle-orm';
import { patchSchema, idParams, organizationSchema } from '@bnature/contracts';
import { HttpError } from '../middleware/access';
import { audit } from '../services/audit';
import { orgResponse } from './responses';
export function registerOrganizationRoutes({ server, db, access }: ModuleContext) {
  const app = server.withTypeProvider<ZodTypeProvider>();
  const p = '/api/v1';
  app.get(
    `${p}/organizations/:id`,
    { schema: { tags: ['Organization'], params: idParams, response: { 200: orgResponse } } },
    async (req) => {
      const a = await access(req, 'organization:read');
      if (req.params.id !== a.organizationId)
        throw new HttpError(404, 'NOT_FOUND', 'Organisation nicht gefunden.');
      const [org] = await db
        .select()
        .from(s.organizations)
        .where(eq(s.organizations.id, a.organizationId));
      return org!;
    },
  );
  app.patch(
    `${p}/organizations/:id`,
    {
      schema: {
        tags: ['Organization'],
        params: idParams,
        body: patchSchema(organizationSchema),
        response: { 200: orgResponse },
      },
    },
    async (req) => {
      const a = await access(req, 'organization:write');
      if (req.params.id !== a.organizationId)
        throw new HttpError(404, 'NOT_FOUND', 'Organisation nicht gefunden.');
      return db.transaction(async (tx) => {
        const [org] = await tx
          .update(s.organizations)
          .set({ ...req.body, updatedAt: new Date() })
          .where(eq(s.organizations.id, a.organizationId))
          .returning();
        await audit(tx, a, 'update', 'organization', a.organizationId, Object.keys(req.body));
        return org!;
      });
    },
  );
}
