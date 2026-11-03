import { alias } from 'drizzle-orm/pg-core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema as s, type Executor } from '@bnature/db';
import { can, type ChatAttachment, type ChatMember, type ChatMessage } from '@bnature/contracts';
import { HttpError, type Access } from '../middleware/access';

const m = s.communityChatMessages;
const inGroup = (a: Access, groupId: string, userColumn: unknown) =>
  sql`exists(select 1 from group_members gm join person_user_links pl on pl.organization_id=gm.organization_id and pl.person_id=gm.person_id where gm.organization_id=${a.organizationId} and gm.group_id=${groupId} and pl.user_id=${userColumn})`;

/**
 * Accounts that can read a channel, for @mentions: everyone in the club channel; in a group
 * channel the linked group members plus those who moderate (community:manage).
 */
export async function chatMembers(
  db: Executor,
  a: Access,
  groupId: string | null,
): Promise<ChatMember[]> {
  const rows = await db
    .select({ userId: s.user.id, name: s.user.name, role: s.organizationUserRoles.role })
    .from(s.organizationUserRoles)
    .innerJoin(s.user, eq(s.user.id, s.organizationUserRoles.userId))
    .where(
      and(
        eq(s.organizationUserRoles.organizationId, a.organizationId),
        groupId
          ? sql`(${inGroup(a, groupId, s.user.id)} or ${s.organizationUserRoles.role} in ('admin','board'))`
          : undefined,
      ),
    )
    .orderBy(s.user.name, s.user.id);
  return rows
    .filter((r) => can(r.role, 'community:chat'))
    .map(({ userId, name }) => ({ userId, name }));
}

/** Checks reply target, mentions and attachment of a new message against its channel. */
export async function validateChatExtras(
  db: Executor,
  a: Access,
  input: {
    groupId: string | null;
    replyToId: string | null;
    mentionUserIds: string[];
    attachment: { kind: 'event' | 'poll'; id: string } | null;
  },
) {
  if (input.replyToId) {
    const [target] = await db
      .select({ groupId: m.groupId })
      .from(m)
      .where(and(eq(m.organizationId, a.organizationId), eq(m.id, input.replyToId)));
    if (!target || target.groupId !== input.groupId)
      throw new HttpError(404, 'NOT_FOUND', 'Nachricht nicht gefunden.');
  }
  const mentions = [...new Set(input.mentionUserIds)];
  if (mentions.length) {
    const allowed = new Set((await chatMembers(db, a, input.groupId)).map((u) => u.userId));
    if (mentions.some((id) => !allowed.has(id)))
      throw new HttpError(
        422,
        'MENTION_NOT_ALLOWED',
        'Erwähnte Person hat keinen Zugang zu diesem Chat.',
      );
  }
  if (input.attachment?.kind === 'event') {
    const [event] = await db
      .select({ status: s.eventOccurrences.status, visibility: s.eventOccurrences.visibility })
      .from(s.eventOccurrences)
      .where(
        and(
          eq(s.eventOccurrences.organizationId, a.organizationId),
          eq(s.eventOccurrences.id, input.attachment.id),
        ),
      );
    if (!event || event.status !== 'published' || event.visibility === 'internal')
      throw new HttpError(404, 'NOT_FOUND', 'Veranstaltung nicht gefunden.');
  }
  if (input.attachment?.kind === 'poll') {
    const p = s.communityPosts;
    const [post] = await db
      .select({ kind: p.kind, state: p.state, groupId: p.groupId })
      .from(p)
      .where(and(eq(p.organizationId, a.organizationId), eq(p.id, input.attachment.id)));
    // A group poll must not be advertised in the club or another group's channel.
    if (
      !post ||
      post.kind !== 'poll' ||
      post.state !== 'published' ||
      (post.groupId !== null && post.groupId !== input.groupId)
    )
      throw new HttpError(404, 'NOT_FOUND', 'Umfrage nicht gefunden.');
  }
  return mentions;
}

type Row = typeof m.$inferSelect;
/** Reply previews, own mentions and per-viewer attachment cards for a page of messages. */
export async function decorateMessages(
  db: Executor,
  a: Access,
  rows: Row[],
): Promise<Map<string, Pick<ChatMessage, 'replyTo' | 'mentionsMe' | 'attachment'>>> {
  const result = new Map<string, Pick<ChatMessage, 'replyTo' | 'mentionsMe' | 'attachment'>>();
  if (!rows.length) return result;
  const ids = rows.map((r) => r.id);
  const replyIds = [...new Set(rows.flatMap((r) => (r.replyToId ? [r.replyToId] : [])))];
  const target = alias(m, 'reply_target');
  const replies = replyIds.length
    ? await db
        .select({
          id: target.id,
          body: target.body,
          removedAt: target.removedAt,
          authorName: s.user.name,
        })
        .from(target)
        .innerJoin(s.user, eq(s.user.id, target.createdBy))
        .where(and(eq(target.organizationId, a.organizationId), inArray(target.id, replyIds)))
    : [];
  const mine = new Set(
    (
      await db
        .select({ messageId: s.communityChatMentions.messageId })
        .from(s.communityChatMentions)
        .where(
          and(
            eq(s.communityChatMentions.organizationId, a.organizationId),
            eq(s.communityChatMentions.userId, a.userId),
            inArray(s.communityChatMentions.messageId, ids),
          ),
        )
    ).map((x) => x.messageId),
  );
  const eventIds = rows.flatMap((r) =>
    r.attachmentKind === 'event' && r.attachmentId ? [r.attachmentId] : [],
  );
  const pollIds = rows.flatMap((r) =>
    r.attachmentKind === 'poll' && r.attachmentId ? [r.attachmentId] : [],
  );
  const events = new Map<string, ChatAttachment>();
  if (eventIds.length && can(a.role, 'events:read')) {
    const e = s.eventOccurrences;
    for (const row of await db
      .select()
      .from(e)
      .where(
        and(
          eq(e.organizationId, a.organizationId),
          inArray(e.id, eventIds),
          sql`${e.status} in ('published','completed','cancelled')`,
          sql`${e.visibility}<>'internal'`,
        ),
      ))
      events.set(row.id, {
        kind: 'event',
        id: row.id,
        available: true,
        title: row.titleI18n,
        startAt: row.startAt.toISOString(),
        location: row.location ?? '',
        closed: row.status !== 'published' || row.startAt.getTime() < Date.now(),
      });
  }
  const polls = new Map<string, ChatAttachment>();
  if (pollIds.length) {
    const p = s.communityPosts;
    const manager = can(a.role, 'community:manage');
    for (const row of await db
      .select()
      .from(p)
      .where(
        and(
          eq(p.organizationId, a.organizationId),
          inArray(p.id, pollIds),
          sql`${p.state} in ('published','archived')`,
          manager
            ? undefined
            : sql`(${p.groupId} is null or exists(select 1 from groups g join group_members gm on gm.organization_id=g.organization_id and gm.group_id=g.id join person_user_links pl on pl.organization_id=gm.organization_id and pl.person_id=gm.person_id where g.organization_id=${a.organizationId} and g.id=${p.groupId} and g.active=true and pl.user_id=${a.userId}))`,
        ),
      ))
      polls.set(row.id, {
        kind: 'poll',
        id: row.id,
        available: true,
        title: row.titleI18n,
        startAt: null,
        location: null,
        closed:
          row.state === 'archived' ||
          !!row.closedAt ||
          (!!row.closesAt && row.closesAt.getTime() <= Date.now()),
      });
  }
  for (const row of rows) {
    const reply = row.replyToId ? replies.find((x) => x.id === row.replyToId) : undefined;
    const attachment =
      row.attachmentKind && row.attachmentId
        ? ((row.attachmentKind === 'event' ? events : polls).get(row.attachmentId) ?? {
            kind: row.attachmentKind,
            id: row.attachmentId,
            available: false,
            title: null,
            startAt: null,
            location: null,
            closed: true,
          })
        : null;
    result.set(row.id, {
      replyTo: reply
        ? {
            id: reply.id,
            authorName: reply.authorName,
            excerpt: reply.removedAt ? '' : reply.body.slice(0, 140),
            removed: !!reply.removedAt,
          }
        : null,
      mentionsMe: mine.has(row.id),
      attachment: row.removedAt ? null : attachment,
    });
  }
  return result;
}
