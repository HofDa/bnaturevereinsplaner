import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ModuleContext } from './context';
import { schema as s } from '@bnature/db';
import { and, eq } from 'drizzle-orm';
import { patchSchema, personSchema } from '@bnature/contracts';
import { HttpError } from '../middleware/access';
import { audit } from '../services/audit';
export function registerProfileRoutes({ server, db, access }: ModuleContext) {
  const app = server.withTypeProvider<ZodTypeProvider>();
  const p = '/api/v1';
  app.get(`${p}/profile`, { schema: { tags: ['Profile'] } }, async (req) => {
    const a = await access(req);
    const [person] = await db
      .select({ person: s.persons })
      .from(s.personUserLinks)
      .innerJoin(
        s.persons,
        and(
          eq(s.persons.id, s.personUserLinks.personId),
          eq(s.persons.organizationId, s.personUserLinks.organizationId),
        ),
      )
      .where(
        and(
          eq(s.personUserLinks.organizationId, a.organizationId),
          eq(s.personUserLinks.userId, a.userId),
        ),
      );
    return { user: a.user, person: person?.person ?? null };
  });
  app.patch(
    `${p}/profile`,
    {
      schema: {
        tags: ['Profile'],
        body: patchSchema(
          personSchema.pick({
            phone: true,
            street: true,
            postalCode: true,
            city: true,
            country: true,
            preferredLanguage: true,
          }),
        ),
      },
    },
    async (req) => {
      const a = await access(req);
      return db.transaction(async (tx) => {
        const [link] = await tx
          .select()
          .from(s.personUserLinks)
          .where(
            and(
              eq(s.personUserLinks.organizationId, a.organizationId),
              eq(s.personUserLinks.userId, a.userId),
            ),
          );
        if (!link) throw new HttpError(404, 'NOT_FOUND', 'Keine verknüpfte Person.');
        const [row] = await tx
          .update(s.persons)
          .set({ ...req.body, updatedAt: new Date() })
          .where(
            and(eq(s.persons.id, link.personId), eq(s.persons.organizationId, a.organizationId)),
          )
          .returning();
        await audit(tx, a, 'update', 'person', link.personId, Object.keys(req.body));
        return row;
      });
    },
  );
}
