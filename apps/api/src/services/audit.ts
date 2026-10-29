import { schema, type Executor } from '@bnature/db';
import type { Access } from '../middleware/access';
export async function audit(
  db: Executor,
  access: Pick<Access, 'organizationId' | 'userId'>,
  action: string,
  entityType: string,
  entityId: string,
  fields: string[],
) {
  await db.insert(schema.auditLogs).values({
    organizationId: access.organizationId,
    actorUserId: access.userId,
    action,
    entityType,
    entityId,
    changeMetadata: { fields },
  });
}
