import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { schema as s, type Database, type Transaction } from '@bnature/db';
import { can, type Permission } from '@bnature/contracts';
import { HttpError, type Access } from '../middleware/access';
import { canonicalJson } from './finance/operations';
export const eventHash = (input: unknown) =>
  createHash('sha256').update(canonicalJson(input)).digest('hex');
export async function eventWrite<T extends Record<string, unknown>>(
  db: Database,
  a: Access,
  key: string,
  operation: string,
  input: unknown,
  permission: Permission,
  work: (tx: Transaction, current: Access) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: s.organizations.id })
      .from(s.organizations)
      .where(eq(s.organizations.id, a.organizationId))
      .for('no key update');
    const [role] = await tx
      .select()
      .from(s.organizationUserRoles)
      .where(
        and(
          eq(s.organizationUserRoles.organizationId, a.organizationId),
          eq(s.organizationUserRoles.userId, a.userId),
        ),
      );
    if (!role || !can(role.role, permission))
      throw new HttpError(403, 'FORBIDDEN', 'Keine Berechtigung.');
    const current = { ...a, role: role.role },
      hash = eventHash({ operation, input, actor: a.userId });
    const [previous] = await tx
      .select()
      .from(s.eventOperations)
      .where(
        and(
          eq(s.eventOperations.organizationId, a.organizationId),
          eq(s.eventOperations.operationId, key),
        ),
      );
    if (previous) {
      if (previous.requestHash !== hash)
        throw new HttpError(409, 'IDEMPOTENCY_MISMATCH', 'Schlüssel bereits verwendet.');
      return { data: previous.response as T, replayed: true };
    }
    const data = await work(tx, current);
    await tx.insert(s.eventOperations).values({
      organizationId: a.organizationId,
      operationId: key,
      actorUserId: a.userId,
      requestHash: hash,
      response: data,
    });
    return { data, replayed: false };
  });
}
