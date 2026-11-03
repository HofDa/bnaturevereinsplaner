import { fromNodeHeaders } from 'better-auth/node';
import { and, eq, asc } from 'drizzle-orm';
import { schema, type Database, type Executor, type Transaction } from '@bnature/db';
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
  organizations: { id: string; name: string; role: Role; timezone?: string }[];
};
export async function currentAccess(
  db: Executor,
  access: Access,
  permission?: Permission,
): Promise<Access> {
  const [row] = await db
    .select({ role: schema.organizationUserRoles.role })
    .from(schema.organizationUserRoles)
    .where(
      and(
        eq(schema.organizationUserRoles.organizationId, access.organizationId),
        eq(schema.organizationUserRoles.userId, access.userId),
      ),
    );
  if (!row || (permission && !can(row.role, permission)))
    throw new HttpError(403, 'FORBIDDEN', 'Keine Berechtigung für diese Aktion.');
  return { ...access, role: row.role };
}
export async function lockAccess(
  tx: Transaction,
  access: Access,
  permission?: Permission,
): Promise<Access> {
  const [organization] = await tx
    .select({ id: schema.organizations.id })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, access.organizationId))
    .for('no key update');
  if (!organization) throw new HttpError(404, 'NOT_FOUND', 'Organisation nicht gefunden.');
  return currentAccess(tx, access, permission);
}
export async function assertResponsibleUser(
  db: Executor,
  access: Access,
  userId: string | null | undefined,
) {
  if (!userId) return;
  const [row] = await db
    .select({ id: schema.organizationUserRoles.userId })
    .from(schema.organizationUserRoles)
    .where(
      and(
        eq(schema.organizationUserRoles.organizationId, access.organizationId),
        eq(schema.organizationUserRoles.userId, userId),
      ),
    );
  if (!row) throw new HttpError(422, 'INVALID_RELATION', 'Verantwortliche Person unbekannt.');
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
        timezone: schema.organizations.timezone,
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
