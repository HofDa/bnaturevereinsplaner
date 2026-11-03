import { and, asc, eq, inArray, isNull, sql, desc } from 'drizzle-orm';
import { schema as s, type Database, type Executor } from '@bnature/db';
import {
  can,
  chatReactionEmojis,
  type ChatReaction,
  type ChatReactionEmoji,
} from '@bnature/contracts';
import { HttpError, type Access } from '../middleware/access';
import { audit } from '../services/audit';
import { financialOperation, readSnapshot } from './finance/operations';
import { currentAccess, groupAccess } from './community';
const m = s.communityChatMessages;
const r = s.communityChatReactions;
const channel = (a: Access, groupId: string | null) =>
  and(eq(m.organizationId, a.organizationId), groupId ? eq(m.groupId, groupId) : isNull(m.groupId));
export function listCommunityChat(
  db: Database,
  access: Access,
  groupId: string | null,
  before?: string,
) {
  return readSnapshot(db, async (tx) => {
    const a = await currentAccess(tx, access);
    if (groupId) await groupAccess(tx, a, groupId);
    const [cursor] = before
      ? await tx
          .select()
          .from(m)
          .where(and(channel(a, groupId), eq(m.id, before)))
      : [];
    if (before && !cursor) throw new HttpError(404, 'NOT_FOUND', 'Nachricht nicht gefunden.');
    const rows = await tx
      .select({ message: m, authorName: s.user.name })
      .from(m)
      .innerJoin(s.user, eq(s.user.id, m.createdBy))
      .where(
        and(
          channel(a, groupId),
          cursor
            ? sql`(${m.createdAt},${m.id})<(${cursor.createdAt},${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(m.createdAt), desc(m.id))
      .limit(51);
    const selected = rows.slice(0, 50);
    const reactions = await reactionsFor(
      tx,
      a,
      selected.map(({ message }) => message.id),
    );
    return {
      items: selected.reverse().map(({ message: r, authorName }) => ({
        id: r.id,
        authorName,
        body: r.body,
        version: r.version,
        createdAt: r.createdAt.toISOString(),
        removedAt: r.removedAt?.toISOString() ?? null,
        isOwn: r.createdBy === a.userId,
        canRemove: !r.removedAt && (r.createdBy === a.userId || can(a.role, 'community:manage')),
        reactions: r.removedAt ? [] : (reactions.get(r.id) ?? []),
      })),
      nextBefore: rows.length > 50 ? selected[0]!.message.id : null,
    };
  });
}
async function reactionsFor(tx: Executor, a: Access, ids: string[]) {
  const byMessage = new Map<string, ChatReaction[]>();
  if (!ids.length) return byMessage;
  const rows = await tx
    .select({ messageId: r.messageId, emoji: r.emoji, userId: r.userId, name: s.user.name })
    .from(r)
    .innerJoin(s.user, eq(s.user.id, r.userId))
    .where(and(eq(r.organizationId, a.organizationId), inArray(r.messageId, ids)))
    .orderBy(asc(r.createdAt), asc(r.userId));
  for (const row of rows) {
    const list = byMessage.get(row.messageId) ?? [];
    let entry = list.find((e) => e.emoji === row.emoji);
    if (!entry) {
      entry = { emoji: row.emoji as ChatReactionEmoji, count: 0, mine: false, names: [] };
      list.push(entry);
    }
    entry.count++;
    entry.names.push(row.name);
    if (row.userId === a.userId) entry.mine = true;
    byMessage.set(row.messageId, list);
  }
  for (const list of byMessage.values())
    list.sort((x, y) => chatReactionEmojis.indexOf(x.emoji) - chatReactionEmojis.indexOf(y.emoji));
  return byMessage;
}
export function sendCommunityChat(
  db: Database,
  access: Access,
  key: string,
  input: { groupId: string | null; body: string },
) {
  return financialOperation(
    db,
    access,
    key,
    'community:chat:send',
    input,
    'community:chat',
    async (tx) => {
      const a = await currentAccess(tx, access);
      if (input.groupId) {
        await tx
          .select()
          .from(s.groups)
          .where(and(eq(s.groups.organizationId, a.organizationId), eq(s.groups.id, input.groupId)))
          .for('share');
        await groupAccess(tx, a, input.groupId);
      }
      const [row] = await tx
        .insert(m)
        .values({
          organizationId: a.organizationId,
          groupId: input.groupId,
          body: input.body,
          createdBy: a.userId,
        })
        .returning();
      await audit(tx, a, 'send', 'community_chat_message', row!.id, ['message']);
      return { id: row!.id };
    },
  );
}
export function removeCommunityChat(
  db: Database,
  access: Access,
  key: string,
  id: string,
  version: number,
) {
  return financialOperation(
    db,
    access,
    key,
    `community:chat:remove:${id}`,
    { version },
    'community:chat',
    async (tx) => {
      const a = await currentAccess(tx, access);
      const [row] = await tx
        .select()
        .from(m)
        .where(and(eq(m.organizationId, a.organizationId), eq(m.id, id)))
        .for('update');
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Nachricht nicht gefunden.');
      if (row.groupId) await groupAccess(tx, a, row.groupId);
      if (row.createdBy !== a.userId && !can(a.role, 'community:manage'))
        throw new HttpError(403, 'FORBIDDEN', 'Nur eigene Nachrichten können entfernt werden.');
      if (row.version !== version || row.removedAt)
        throw new HttpError(409, 'CONFLICT', 'Die Nachricht wurde bereits geändert.');
      await tx
        .update(m)
        .set({ body: '', removedAt: new Date(), removedBy: a.userId, version: row.version + 1 })
        .where(and(eq(m.organizationId, a.organizationId), eq(m.id, id)));
      await tx.delete(r).where(and(eq(r.organizationId, a.organizationId), eq(r.messageId, id)));
      await audit(tx, a, 'remove', 'community_chat_message', id, ['body']);
      return { id };
    },
  );
}
/** Sets (not toggles) one reaction, so a retried request cannot flip the state back. */
export function reactCommunityChat(
  db: Database,
  access: Access,
  key: string,
  id: string,
  input: { emoji: ChatReactionEmoji; active: boolean },
) {
  return financialOperation(
    db,
    access,
    key,
    `community:chat:react:${id}`,
    input,
    'community:chat',
    async (tx) => {
      const a = await currentAccess(tx, access);
      const [row] = await tx
        .select()
        .from(m)
        .where(and(eq(m.organizationId, a.organizationId), eq(m.id, id)))
        .for('share');
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Nachricht nicht gefunden.');
      if (row.groupId) await groupAccess(tx, a, row.groupId);
      if (row.removedAt)
        throw new HttpError(409, 'CONFLICT', 'Die Nachricht wurde bereits entfernt.');
      const own = and(
        eq(r.organizationId, a.organizationId),
        eq(r.messageId, id),
        eq(r.userId, a.userId),
        eq(r.emoji, input.emoji),
      );
      if (input.active)
        await tx
          .insert(r)
          .values({
            organizationId: a.organizationId,
            messageId: id,
            userId: a.userId,
            emoji: input.emoji,
          })
          .onConflictDoNothing();
      else await tx.delete(r).where(own);
      return { id };
    },
  );
}
