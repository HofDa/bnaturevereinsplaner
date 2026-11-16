import { and, eq, sql, type SQL } from 'drizzle-orm';
import { schema as s, type Database, type Executor } from '@bnature/db';
import { can, type NotificationSettings, type Unread } from '@bnature/contracts';
import { HttpError, type Access } from '../middleware/access';
import type { Config } from '../plugins/config';
import { audit } from '../services/audit';
import { readSnapshot } from './finance/operations';
import { businessDate } from './finance/service';
import { currentAccess, groupAccess } from './community';
import { communityDigestMail } from './mail-templates';

/** Club-local hour from which digests are queued, so nobody gets mail at midnight. */
export const DIGEST_HOUR = 7;
const MAX_TITLES = 5;
type Text = { de: string; it: string };

/**
 * Channels that count towards unread: the club channel plus active groups the account belongs
 * to through its linked person. Board members may open other groups but are not nagged by them.
 */
type Who = Pick<Access, 'organizationId' | 'userId'>;
async function memberGroups(db: Executor, a: Who) {
  return db
    .select({ id: s.groups.id, name: s.groups.name })
    .from(s.groups)
    .where(
      and(
        eq(s.groups.organizationId, a.organizationId),
        eq(s.groups.active, true),
        sql`exists(select 1 from group_members gm join person_user_links pl on pl.organization_id=gm.organization_id and pl.person_id=gm.person_id where gm.organization_id=${a.organizationId} and gm.group_id=${s.groups.id} and pl.user_id=${a.userId})`,
      ),
    )
    .orderBy(s.groups.name, s.groups.id);
}

export type Activity = Unread & {
  groupNames: Map<string, string>;
  titles: { news: Text[]; polls: Text[] };
};

/**
 * Counts content by others that is newer than the account's read marker for that channel.
 * Without a marker, the moment the account joined the club is the baseline, so new members do
 * not start with the whole history unread. `since` additionally bounds the window (digests).
 */
export async function activity(db: Executor, a: Who, since?: Date): Promise<Activity> {
  const [role] = await db
    .select({ createdAt: s.organizationUserRoles.createdAt })
    .from(s.organizationUserRoles)
    .where(
      and(
        eq(s.organizationUserRoles.organizationId, a.organizationId),
        eq(s.organizationUserRoles.userId, a.userId),
      ),
    );
  if (!role) throw new HttpError(403, 'FORBIDDEN', 'Kein Vereinszugang.');
  const groups = await memberGroups(db, a);
  const floor = since && since > role.createdAt ? since : role.createdAt;
  const inChannels = (column: SQL | unknown) =>
    groups.length
      ? sql`(${column} is null or ${column} in (${sql.join(
          groups.map((g) => sql`${g.id}::uuid`),
          sql`,`,
        )}))`
      : sql`${column} is null`;
  const readAt = (channel: SQL | unknown, group: SQL | unknown) =>
    sql`coalesce((select r.read_at from community_read_markers r where r.organization_id=${a.organizationId} and r.user_id=${a.userId} and r.channel=${channel} and r.group_id is not distinct from ${group}), '-infinity'::timestamptz)`;
  const m = s.communityChatMessages;
  const chatRows = await db
    .select({ groupId: m.groupId, count: sql<number>`count(*)::int` })
    .from(m)
    .where(
      and(
        eq(m.organizationId, a.organizationId),
        inChannels(m.groupId),
        sql`${m.createdBy}<>${a.userId}`,
        sql`${m.removedAt} is null`,
        sql`${m.createdAt}>${floor}`,
        sql`${m.createdAt}>${readAt(sql`'chat'`, m.groupId)}`,
      ),
    )
    .groupBy(m.groupId);
  const p = s.communityPosts;
  const posts = await db
    .select({ kind: p.kind, title: p.titleI18n })
    .from(p)
    .where(
      and(
        eq(p.organizationId, a.organizationId),
        eq(p.state, 'published'),
        inChannels(p.groupId),
        sql`${p.createdBy}<>${a.userId}`,
        sql`${p.publishedAt}>${floor}`,
        sql`${p.publishedAt}>${readAt(p.kind, sql`null::uuid`)}`,
      ),
    )
    .orderBy(sql`${p.publishedAt} desc`, p.id);
  const news = posts.filter((r) => r.kind === 'news');
  const polls = posts.filter((r) => r.kind === 'poll');
  const chat = chatRows
    .map((r) => ({ groupId: r.groupId, count: r.count }))
    .sort((x, y) => (x.groupId === null ? -1 : y.groupId === null ? 1 : 0));
  return {
    news: news.length,
    polls: polls.length,
    chat,
    total: news.length + polls.length + chat.reduce((n, c) => n + c.count, 0),
    groupNames: new Map(groups.map((g) => [g.id, g.name])),
    titles: {
      news: news.slice(0, MAX_TITLES).map((r) => r.title),
      polls: polls.slice(0, MAX_TITLES).map((r) => r.title),
    },
  };
}

export function communityUnread(db: Database, access: Access): Promise<Unread> {
  return readSnapshot(db, async (tx) => {
    const { news, polls, chat, total } = await activity(tx, await currentAccess(tx, access));
    return { news, polls, chat, total };
  });
}

/**
 * Moves a read marker forward to `until`, never backwards and never past the server clock.
 * Naturally idempotent, so no Idempotency-Key is required.
 */
export async function markCommunityRead(
  db: Database,
  access: Access,
  input: { channel: 'news' | 'poll' | 'chat'; groupId: string | null; until: string },
) {
  await db.transaction(async (tx) => {
    const a = await currentAccess(tx, access);
    if (input.groupId) await groupAccess(tx, a, input.groupId);
    const r = s.communityReadMarkers;
    await tx
      .insert(r)
      .values({
        organizationId: a.organizationId,
        userId: a.userId,
        channel: input.channel,
        groupId: input.groupId,
        // Clients only see millisecond timestamps while PostgreSQL stores microseconds:
        // round up within that millisecond so the item itself counts as read.
        readAt: sql`least(${input.until}::timestamptz + interval '999 microseconds', now())`,
      })
      .onConflictDoUpdate({
        target: [r.organizationId, r.userId, r.channel, r.groupId],
        set: { readAt: sql`greatest(${r.readAt}, excluded.read_at)` },
      });
  });
}

export function getNotificationSettings(
  db: Database,
  access: Access,
  config: Config,
): Promise<NotificationSettings> {
  return readSnapshot(db, async (tx) => {
    const a = await currentAccess(tx, access);
    const [row] = await tx
      .select({ digest: s.communityNotificationSettings.digest, email: s.user.email })
      .from(s.user)
      .leftJoin(
        s.communityNotificationSettings,
        and(
          eq(s.communityNotificationSettings.organizationId, a.organizationId),
          eq(s.communityNotificationSettings.userId, s.user.id),
        ),
      )
      .where(eq(s.user.id, a.userId));
    return {
      digest: row?.digest ?? 'off',
      email: row?.email ?? '',
      emailEnabled: config.EMAIL_MODE !== 'disabled',
      pushPublicKey: (config.VAPID_PRIVATE_KEY && config.VAPID_PUBLIC_KEY) || null,
    };
  });
}

export async function updateNotificationSettings(
  db: Database,
  access: Access,
  config: Config,
  digest: 'off' | 'daily' | 'weekly',
) {
  await db.transaction(async (tx) => {
    const a = await currentAccess(tx, access);
    const n = s.communityNotificationSettings;
    const [current] = await tx
      .select()
      .from(n)
      .where(and(eq(n.organizationId, a.organizationId), eq(n.userId, a.userId)))
      .for('update');
    if (current?.digest === digest) return;
    // Switching on (or between modes) starts a fresh window: no backlog of old content,
    // and the first digest follows one full period later.
    const fresh = {
      lastDigestAt: new Date(),
      lastDigestOn: await businessDate(tx, a.organizationId),
    };
    if (current)
      await tx
        .update(n)
        .set({ digest, updatedAt: new Date(), ...(digest === 'off' ? {} : fresh) })
        .where(and(eq(n.organizationId, a.organizationId), eq(n.userId, a.userId)));
    else
      await tx
        .insert(n)
        .values({ organizationId: a.organizationId, userId: a.userId, digest, ...fresh });
    await audit(tx, a, 'update', 'community_notification_settings', a.userId, ['digest']);
  });
  return getNotificationSettings(db, access, config);
}

function localHour(timezone: string, now: Date) {
  return Number(
    new Intl.DateTimeFormat('en', { timeZone: timezone, hour: 'numeric', hourCycle: 'h23' })
      .formatToParts(now)
      .find((part) => part.type === 'hour')!.value,
  );
}
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Due when the club-local day changed (daily) or a week passed (weekly), after DIGEST_HOUR. */
export function digestDue(
  mode: 'off' | 'daily' | 'weekly',
  lastDigestOn: string | null,
  today: string,
  hour: number,
) {
  if (mode === 'off' || hour < DIGEST_HOUR) return false;
  if (!lastDigestOn) return true;
  return daysBetween(lastDigestOn, today) >= (mode === 'daily' ? 1 : 7);
}

/** Queues due digests into the regular mail outbox. Empty digests are skipped silently. */
export async function enqueueCommunityDigests(db: Database, config: Config, now = new Date()) {
  if (config.EMAIL_MODE === 'disabled') return;
  const n = s.communityNotificationSettings;
  // Cheap pre-filter in club-local time so idle ticks touch no rows; the locked check below
  // stays authoritative. `now` is passed in so tests can simulate a morning.
  const local = sql`(${now.toISOString()}::timestamptz at time zone ${s.organizations.timezone})`;
  const candidates = await db
    .select({ organizationId: n.organizationId, userId: n.userId })
    .from(n)
    .innerJoin(s.organizations, eq(s.organizations.id, n.organizationId))
    .where(
      sql`${n.digest}<>'off' and extract(hour from ${local})>=${DIGEST_HOUR} and (${n.lastDigestOn} is null or ${n.lastDigestOn} <= ${local}::date - case when ${n.digest}='weekly' then 7 else 1 end)`,
    );
  for (const candidate of candidates) {
    await db.transaction(async (tx) => {
      const [org] = await tx
        .select()
        .from(s.organizations)
        .where(eq(s.organizations.id, candidate.organizationId))
        .for('no key update');
      if (!org) return;
      const [setting] = await tx
        .select()
        .from(n)
        .where(and(eq(n.organizationId, candidate.organizationId), eq(n.userId, candidate.userId)))
        .for('update');
      const today = await businessDate(tx, org.id, now);
      if (
        !setting ||
        !digestDue(setting.digest, setting.lastDigestOn, today, localHour(org.timezone, now))
      )
        return;
      const [account] = await tx
        .select({ role: s.organizationUserRoles.role, email: s.user.email, name: s.user.name })
        .from(s.organizationUserRoles)
        .innerJoin(s.user, eq(s.user.id, s.organizationUserRoles.userId))
        .where(
          and(
            eq(s.organizationUserRoles.organizationId, org.id),
            eq(s.organizationUserRoles.userId, setting.userId),
          ),
        );
      const advance = () =>
        tx
          .update(n)
          .set({ lastDigestOn: today, lastDigestAt: now })
          .where(and(eq(n.organizationId, org.id), eq(n.userId, setting.userId)));
      if (!account || !can(account.role, 'community:read') || !account.email.includes('@')) {
        await advance();
        return;
      }
      const a = { organizationId: org.id, userId: setting.userId };
      const found = await activity(tx, a, setting.lastDigestAt);
      if (found.total > 0) {
        const [link] = await tx
          .select({ language: s.persons.preferredLanguage })
          .from(s.personUserLinks)
          .innerJoin(
            s.persons,
            and(
              eq(s.persons.organizationId, s.personUserLinks.organizationId),
              eq(s.persons.id, s.personUserLinks.personId),
            ),
          )
          .where(
            and(
              eq(s.personUserLinks.organizationId, org.id),
              eq(s.personUserLinks.userId, setting.userId),
            ),
          );
        const language = link?.language ?? org.locale;
        const mail = communityDigestMail({
          language,
          organization: org.name,
          name: account.name,
          appUrl: config.APP_URL,
          news: found.titles.news.map((t) => t[language]),
          newsCount: found.news,
          polls: found.titles.polls.map((t) => t[language]),
          pollCount: found.polls,
          chat: found.chat.map((c) => ({
            name: c.groupId ? (found.groupNames.get(c.groupId) ?? '') : null,
            count: c.count,
          })),
        });
        await tx
          .insert(s.mailMessages)
          .values({
            organizationId: org.id,
            kind: 'community_digest',
            userId: setting.userId,
            actorUserId: setting.userId,
            recipient: account.email,
            language,
            subject: mail.subject,
            body: mail.text,
            dedupeKey: `digest:${setting.userId}:${today}`,
          })
          .onConflictDoNothing();
        await audit(tx, a, 'queue', 'community_digest', setting.userId, ['kind']);
      }
      await advance();
    });
  }
}

/** Worker check right before SMTP handoff: still opted in, still a member, same address. */
export async function revalidateDigest(db: Executor, row: typeof s.mailMessages.$inferSelect) {
  if (!row.userId) return false;
  const [current] = await db
    .select({
      role: s.organizationUserRoles.role,
      email: s.user.email,
      digest: s.communityNotificationSettings.digest,
    })
    .from(s.organizationUserRoles)
    .innerJoin(s.user, eq(s.user.id, s.organizationUserRoles.userId))
    .innerJoin(
      s.communityNotificationSettings,
      and(
        eq(s.communityNotificationSettings.organizationId, s.organizationUserRoles.organizationId),
        eq(s.communityNotificationSettings.userId, s.organizationUserRoles.userId),
      ),
    )
    .where(
      and(
        eq(s.organizationUserRoles.organizationId, row.organizationId),
        eq(s.organizationUserRoles.userId, row.userId),
      ),
    );
  return (
    !!current &&
    current.digest !== 'off' &&
    can(current.role, 'community:read') &&
    current.email === row.recipient
  );
}
