import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { schema as s, type Database, type Transaction, type Executor } from '@bnature/db';
import { type Permission } from '@bnature/contracts';
import { HttpError, lockAccess, type Access } from '../../middleware/access';

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export async function financialOperation<T extends Record<string, unknown>>(
  db: Database,
  access: Access,
  key: string,
  operation: string,
  input: unknown,
  permission: Permission,
  work: (tx: Transaction) => Promise<T>,
): Promise<{ data: T; replayed: boolean }> {
  const hash = createHash('sha256').update(canonicalJson({ operation, input })).digest('hex');
  return db.transaction(async (tx) => {
    await lockAccess(tx, access, permission);
    const [previous] = await tx
      .select()
      .from(s.financeOperations)
      .where(
        and(
          eq(s.financeOperations.organizationId, access.organizationId),
          eq(s.financeOperations.idempotencyKey, key),
        ),
      );
    if (previous) {
      if (previous.requestHash !== hash || previous.operation !== operation)
        throw new HttpError(
          409,
          'IDEMPOTENCY_MISMATCH',
          'Der Operationsschlüssel wurde bereits für andere Daten verwendet.',
        );
      return { data: previous.response as T, replayed: true };
    }
    const data = await work(tx);
    await tx.insert(s.financeOperations).values({
      organizationId: access.organizationId,
      idempotencyKey: key,
      operation,
      requestHash: hash,
      actorUserId: access.userId,
      response: data,
    });
    return { data, replayed: false };
  });
}

// Reuse an enclosing snapshot when composing reports/exports.
export function readSnapshot<T>(db: Executor, work: (tx: Transaction) => Promise<T>): Promise<T> {
  if ('rollback' in db) return work(db);
  return db.transaction(work, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
