import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { schema as s, type Database, type Transaction } from '@bnature/db';
import { type Permission } from '@bnature/contracts';
import { HttpError, lockAccess, type Access } from '../middleware/access';
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
    const current = await lockAccess(tx, a, permission);
    const hash = eventHash({ operation, input, actor: a.userId });
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
