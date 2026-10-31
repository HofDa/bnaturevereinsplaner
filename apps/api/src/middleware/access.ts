import { fromNodeHeaders } from 'better-auth/node';
import { and, eq, asc } from 'drizzle-orm';
import { schema, type Database, type Executor } from '@bnature/db';
import { can, idSchema, type Permission, type Role } from '@bnature/contracts';
import type { FastifyRequest } from 'fastify';
import type { Auth } from '../auth';
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export type Access = {
  organizationId: string;
  userId: string;
  role: Role;
  user: { id: string; name: string; email: string };
  organizations: { id: string; name: string; role: Role }[];
};
// Re-reads the caller's role inside a write transaction so a revoked role takes effect at once.
export async function currentAccess(
  db: Executor,
  a: Access,
  message = 'Keine Berechtigung.',
): Promise<Access> {
  const [row] = await db
    .select({ role: schema.organizationUserRoles.role })
    .from(schema.organizationUserRoles)
    .where(
      and(
        eq(schema.organizationUserRoles.organizationId, a.organizationId),
        eq(schema.organizationUserRoles.userId, a.userId),
      ),
    );
  if (!row) throw new HttpError(403, 'FORBIDDEN', message);
  return { ...a, role: row.role };
}
export function accessControl(db: Database, auth: Auth) {
  return async (request: FastifyRequest, permission?: Permission): Promise<Access> => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) throw new HttpError(401, 'UNAUTHENTICATED', 'Bitte zuerst anmelden.');
    const organizations = await db
      .select({
        id: schema.organizations.id,
        name: schema.organizations.name,
        role: schema.organizationUserRoles.role,
      })
      .from(schema.organizationUserRoles)
      .innerJoin(
        schema.organizations,
        eq(schema.organizationUserRoles.organizationId, schema.organizations.id),
      )
      .where(eq(schema.organizationUserRoles.userId, session.user.id))
      .orderBy(asc(schema.organizationUserRoles.createdAt), asc(schema.organizations.id));
    const requested = request.headers['x-organization-id'];
    if (
      requested !== undefined &&
      (typeof requested !== 'string' || !idSchema.safeParse(requested).success)
    )
      throw new HttpError(400, 'INVALID_ORGANIZATION', 'Ungültiger Organisationskontext.');
    const org = requested ? organizations.find((o) => o.id === requested) : organizations[0];
    if (!org) throw new HttpError(403, 'FORBIDDEN', 'Kein Zugriff auf diese Organisation.');
    if (permission && !can(org.role, permission))
      throw new HttpError(403, 'FORBIDDEN', 'Diese Aktion ist für Ihre Rolle nicht freigegeben.');
    return {
      organizationId: org.id,
      userId: session.user.id,
      role: org.role,
      user: { id: session.user.id, name: session.user.name, email: session.user.email },
      organizations,
    };
  };
}
export const tenant = <T extends { organizationId: typeof schema.persons.organizationId }>(
  table: T,
  organizationId: string,
) => eq(table.organizationId, organizationId);
export const tenantId = (table: typeof schema.persons, organizationId: string, id: string) =>
  and(tenant(table, organizationId), eq(table.id, id));
