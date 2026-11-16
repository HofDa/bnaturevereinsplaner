import { and, eq, ne, sql, asc, inArray } from 'drizzle-orm';
import { schema as s, type Database } from '@bnature/db';
import {
  can,
  type Permission,
  type PushPayload,
  type PushSubscriptionInput,
} from '@bnature/contracts';
import { HttpError, currentAccess, type Access } from '../middleware/access';
import { audit } from '../services/audit';
import type { PushSender } from '../services/push';

const ps = s.pushSubscriptions;
/** Devices per account and club; the oldest is dropped when a further one registers. */
const MAX_DEVICES = 10;
const DAY = 86_400;
type Language = 'de' | 'it';

/** Registers this browser for the current account and club. Idempotent per endpoint. */
export async function savePushSubscription(
  db: Database,
  access: Access,
  enabled: boolean,
  input: PushSubscriptionInput,
) {
  if (!enabled)
    throw new HttpError(
      409,
      'PUSH_DISABLED',
      'Push-Benachrichtigungen sind auf diesem Server nicht eingerichtet.',
    );
  await db.transaction(async (tx) => {
    const a = await currentAccess(tx, access);
    const [existing] = await tx
      .select({ id: ps.id, userId: ps.userId })
      .from(ps)
      .where(and(eq(ps.organizationId, a.organizationId), eq(ps.endpoint, input.endpoint)))
      .for('update');
    const keys = { p256dh: input.keys.p256dh, auth: input.keys.auth };
    if (existing) {
      // The same browser, possibly after another account signed in on it: it follows the
      // account that is signed in now.
      await tx
        .update(ps)
        .set({ userId: a.userId, ...keys, updatedAt: new Date() })
        .where(eq(ps.id, existing.id));
      if (existing.userId === a.userId) return;
      await audit(tx, a, 'create', 'push_subscription', existing.id, ['device']);
      return;
    }
    const [row] = await tx
      .insert(ps)
      .values({
        organizationId: a.organizationId,
        userId: a.userId,
        endpoint: input.endpoint,
        ...keys,
      })
      .returning({ id: ps.id });
    await audit(tx, a, 'create', 'push_subscription', row!.id, ['device']);
    const devices = await tx
      .select({ id: ps.id })
      .from(ps)
      .where(and(eq(ps.organizationId, a.organizationId), eq(ps.userId, a.userId)))
      .orderBy(asc(ps.updatedAt), asc(ps.id));
    const surplus = devices.slice(0, Math.max(0, devices.length - MAX_DEVICES)).map((d) => d.id);
    if (surplus.length) await tx.delete(ps).where(inArray(ps.id, surplus));
  });
}

/**
 * Forgets this browser for the signed-in account in every club it belongs to: switching
 * notifications off (or signing out) applies to the device, not to one club.
 */
export async function removePushSubscription(db: Database, access: Access, endpoint: string) {
  await db.transaction(async (tx) => {
    const a = await currentAccess(tx, access);
    const removed = await tx
      .delete(ps)
      .where(and(eq(ps.userId, a.userId), eq(ps.endpoint, endpoint)))
      .returning({ id: ps.id, organizationId: ps.organizationId });
    for (const row of removed)
      await audit(
        tx,
        { organizationId: row.organizationId, userId: a.userId },
        'delete',
        'push_subscription',
        row.id,
        ['device'],
      );
  });
}

type Recipient = {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  language: Language;
};
/**
 * Devices of accounts that would see the item as unread: everyone with the permission for the
 * club channel, linked members of an active group for a group channel. Never the author.
 */
async function recipients(
  db: Database,
  organizationId: string,
  groupId: string | null,
  permission: Permission,
  authorId: string,
): Promise<Recipient[]> {
  const rows = await db
    .select({
      id: ps.id,
      userId: ps.userId,
      endpoint: ps.endpoint,
      p256dh: ps.p256dh,
      auth: ps.auth,
      role: s.organizationUserRoles.role,
      language: sql<Language>`coalesce((select p.preferred_language from person_user_links pl join persons p on p.organization_id=pl.organization_id and p.id=pl.person_id where pl.organization_id=${ps.organizationId} and pl.user_id=${ps.userId} limit 1), ${s.organizations.locale})`,
    })
    .from(ps)
    .innerJoin(
      s.organizationUserRoles,
      and(
        eq(s.organizationUserRoles.organizationId, ps.organizationId),
        eq(s.organizationUserRoles.userId, ps.userId),
      ),
    )
    .innerJoin(s.organizations, eq(s.organizations.id, ps.organizationId))
    .where(
      and(
        eq(ps.organizationId, organizationId),
        ne(ps.userId, authorId),
        groupId
          ? sql`exists(select 1 from groups g join group_members gm on gm.organization_id=g.organization_id and gm.group_id=g.id join person_user_links pl on pl.organization_id=gm.organization_id and pl.person_id=gm.person_id where g.organization_id=${organizationId} and g.id=${groupId} and g.active=true and pl.user_id=${ps.userId})`
          : undefined,
      ),
    );
  return rows.filter((row) => can(row.role, permission));
}

async function deliver(
  db: Database,
  send: PushSender,
  targets: Recipient[],
  payload: (recipient: Recipient) => PushPayload,
  ttlSeconds: number,
) {
  const gone: string[] = [];
  let failed = 0;
  for (let i = 0; i < targets.length; i += 20)
    await Promise.all(
      targets.slice(i, i + 20).map(async (target) => {
        try {
          if ((await send(target, payload(target), ttlSeconds)) === 'gone') gone.push(target.id);
        } catch {
          // One unreachable push service must not keep the others from being notified.
          failed++;
        }
      }),
    );
  if (gone.length) await db.delete(ps).where(inArray(ps.id, gone));
  return { sent: targets.length - gone.length - failed, gone: gone.length, failed };
}

const postLabel = {
  news: { de: 'Neuigkeit', it: 'Novità' },
  poll: { de: 'Neue Umfrage', it: 'Nuovo sondaggio' },
} as const;

/** Tells the audience of a freshly published news item or poll, except the publisher. */
export async function notifyPostPublished(
  db: Database,
  send: PushSender,
  actor: Pick<Access, 'organizationId' | 'userId'>,
  postId: string,
) {
  const p = s.communityPosts;
  const [post] = await db
    .select({
      kind: p.kind,
      title: p.titleI18n,
      groupId: p.groupId,
      organization: s.organizations.name,
    })
    .from(p)
    .innerJoin(s.organizations, eq(s.organizations.id, p.organizationId))
    .where(
      and(eq(p.organizationId, actor.organizationId), eq(p.id, postId), eq(p.state, 'published')),
    );
  if (!post) return { sent: 0, gone: 0, failed: 0 };
  const targets = await recipients(
    db,
    actor.organizationId,
    post.groupId,
    'community:read',
    actor.userId,
  );
  return deliver(
    db,
    send,
    targets,
    ({ language }) => ({
      title: post.title[language],
      body: `${postLabel[post.kind][language]} · ${post.organization}`,
      url: `/community/${postId}`,
      tag: `post:${postId}`,
    }),
    DAY,
  );
}

const chatText = {
  message: {
    de: (name: string) => `Neue Nachricht von ${name}`,
    it: (name: string) => `Nuovo messaggio di ${name}`,
  },
  mention: {
    de: (name: string) => `${name} hat dich erwähnt`,
    it: (name: string) => `${name} ti ha menzionato`,
  },
  club: { de: 'Vereinschat', it: 'Chat dell’associazione' },
} as const;

/**
 * Tells the other members of a chat channel about a new message. The message text stays out
 * of the notification: it would otherwise show on lock screens.
 */
export async function notifyChatMessage(
  db: Database,
  send: PushSender,
  actor: Pick<Access, 'organizationId' | 'userId'>,
  messageId: string,
) {
  const m = s.communityChatMessages;
  const [message] = await db
    .select({
      groupId: m.groupId,
      author: s.user.name,
      group: s.groups.name,
      organization: s.organizations.name,
    })
    .from(m)
    .innerJoin(s.user, eq(s.user.id, m.createdBy))
    .innerJoin(s.organizations, eq(s.organizations.id, m.organizationId))
    .leftJoin(
      s.groups,
      and(eq(s.groups.organizationId, m.organizationId), eq(s.groups.id, m.groupId)),
    )
    .where(
      and(
        eq(m.organizationId, actor.organizationId),
        eq(m.id, messageId),
        sql`${m.removedAt} is null`,
      ),
    );
  if (!message) return { sent: 0, gone: 0, failed: 0 };
  const mentioned = new Set(
    (
      await db
        .select({ userId: s.communityChatMentions.userId })
        .from(s.communityChatMentions)
        .where(eq(s.communityChatMentions.messageId, messageId))
    ).map((row) => row.userId),
  );
  const targets = await recipients(
    db,
    actor.organizationId,
    message.groupId,
    'community:chat',
    actor.userId,
  );
  const channel = message.groupId ?? 'club';
  return deliver(
    db,
    send,
    targets,
    ({ language, userId }) => ({
      title: `${message.group ?? chatText.club[language]} · ${message.organization}`,
      body: chatText[mentioned.has(userId) ? 'mention' : 'message'][language](message.author),
      url: `/community?kind=chat${message.groupId ? `&groupId=${message.groupId}` : ''}`,
      // One notification per channel: a burst of messages replaces instead of piling up.
      tag: `chat:${actor.organizationId}:${channel}`,
    }),
    DAY / 6,
  );
}
