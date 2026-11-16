import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect, vi } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, sql } from 'drizzle-orm';
import { createDatabase, schema as s } from '../../packages/db/src';
import { createApp } from '../../apps/api/src/app';
import { createAuth } from '../../apps/api/src/auth';
import { bootstrap } from '../../apps/api/src/services/bootstrap';
import { readConfig } from '../../apps/api/src/plugins/config';
import type { CommunityPost, PushPayload, Unread } from '../../packages/contracts/src';
import type { PushSender, PushTarget } from '../../apps/api/src/services/push';
import {
  enqueueCommunityDigests,
  revalidateDigest,
  digestDue,
} from '../../apps/api/src/modules/community-notify';
const config = { ...readConfig(), EMAIL_MODE: 'disabled' as const };
if (config.NODE_ENV !== 'test' || new URL(config.DATABASE_URL).pathname !== '/bnature_test')
  throw new Error('Dedicated test database required');
const { db, pool } = createDatabase(config.DATABASE_URL);
let app: Awaited<ReturnType<typeof createApp>>;
let org = '',
  foreignOrg = '',
  groupId = '';
const users: Record<string, { id: string; cookie: string }> = {};
const password = 'Community-test-only-password-2026!';
const headers = (role = 'admin', key?: string, organization = org) => ({
  cookie: users[role]!.cookie,
  origin: config.APP_URL,
  'x-organization-id': organization,
  ...(key ? { 'idempotency-key': key } : {}),
});
const get = (path: string, role = 'admin') =>
  app.inject({ url: `/api/v1${path}`, headers: headers(role) });
const write = (
  method: 'POST' | 'PATCH' | 'PUT',
  path: string,
  payload: unknown,
  role = 'admin',
  key: string = crypto.randomUUID(),
) =>
  app.inject({
    method,
    url: `/api/v1${path}`,
    headers: headers(role, key),
    payload: payload as Record<string, unknown>,
  });
async function ok<T>(res: Awaited<ReturnType<typeof get>>, status = 200): Promise<T> {
  expect(res.statusCode, res.body).toBe(status);
  return res.json<T>();
}
const news = (patch: Record<string, unknown> = {}) => ({
  kind: 'news',
  titleI18n: { de: 'Neuigkeiten aus dem Verein', it: 'Novità associative' },
  bodyI18n: { de: 'Gemeinsam aktiv. <script>kein HTML</script>', it: 'Attivi insieme.' },
  ...patch,
});
const poll = (patch: Record<string, unknown> = {}) => ({
  kind: 'poll',
  titleI18n: { de: 'Wann treffen wir uns?', it: 'Quando ci incontriamo?' },
  bodyI18n: { de: 'Ein Termin für alle.', it: 'Una data per tutti.' },
  options: [
    { de: 'Samstag', it: 'Sabato' },
    { de: 'Sonntag', it: 'Domenica' },
  ],
  ...patch,
});
async function create(input: unknown, role = 'admin', key?: string) {
  const r = await ok<{ id: string }>(
    await write('POST', '/community/posts', input, role, key),
    201,
  );
  return ok<CommunityPost>(await get(`/community/posts/${r.id}`, role));
}
async function action(post: CommunityPost, act: 'publish' | 'close' | 'archive', role = 'admin') {
  await ok(
    await write('POST', `/community/posts/${post.id}/${act}`, { version: post.version }, role),
  );
  return ok<CommunityPost>(await get(`/community/posts/${post.id}`, role));
}
async function vote(post: CommunityPost, index = 0, role = 'member', key?: string) {
  return write(
    'PUT',
    `/community/posts/${post.id}/vote`,
    { version: post.version, optionId: post.options[index]!.id },
    role,
    key,
  );
}
beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/db/migrations' });
  await db.execute(sql`truncate table organizations, users cascade`);
  const root = await bootstrap(db, config, {
    name: 'Community Admin',
    email: 'community-admin@example.test',
    password,
    organizationName: 'Community',
    slug: 'community-root',
  });
  const foreign = await bootstrap(db, config, {
    name: 'Foreign',
    email: 'community-foreign@example.test',
    password,
    organizationName: 'Foreign',
    slug: 'community-foreign',
  });
  foreignOrg = foreign.organizationId;
  users.admin = { id: root.userId, cookie: '' };
  users.foreign = { id: foreign.userId, cookie: '' };
  const provision = createAuth(db, config, true);
  for (const role of ['member', 'other', 'board', 'treasurer', 'lead']) {
    const result = await provision.api.signUpEmail({
      body: { name: role, email: `community-${role}@example.test`, password },
    });
    users[role] = { id: result.user.id, cookie: '' };
  }
  app = await createApp(db, config);
  await app.ready();
  for (const [role, user] of Object.entries(users)) {
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: config.APP_URL },
      payload: { email: `community-${role}@example.test`, password },
    });
    expect(r.statusCode, r.body).toBe(200);
    const cookies = r.headers['set-cookie'];
    user.cookie = (Array.isArray(cookies) ? cookies : [cookies])
      .filter(Boolean)
      .map((c) => c!.split(';')[0])
      .join('; ');
  }
  await app.close();
});
beforeEach(async () => {
  const [organization] = await db
    .insert(s.organizations)
    .values({ name: 'b*nature Community-Test', slug: `community-${crypto.randomUUID()}` })
    .returning();
  org = organization!.id;
  for (const [key, role] of [
    ['admin', 'admin'],
    ['member', 'member'],
    ['other', 'member'],
    ['board', 'board'],
    ['treasurer', 'treasurer'],
    ['lead', 'project_lead'],
  ] as const)
    await db
      .insert(s.organizationUserRoles)
      .values({ organizationId: org, userId: users[key]!.id, role });
  const [group] = await db
    .insert(s.groups)
    .values({ organizationId: org, name: 'Waldgruppe' })
    .returning();
  groupId = group!.id;
  const [person] = await db
    .insert(s.persons)
    .values({ organizationId: org, firstName: 'Lena', lastName: 'Community' })
    .returning();
  await db
    .insert(s.personUserLinks)
    .values({ organizationId: org, personId: person!.id, userId: users.member!.id });
  await db.insert(s.groupMembers).values({ organizationId: org, groupId, personId: person!.id });
  app = await createApp(db, config);
  await app.ready();
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await pool.end();
});
describe('news and polls', () => {
  it('stores chat messages once per operation and isolates group conversations', async () => {
    const key = crypto.randomUUID();
    const replies = await Promise.all([
      write('POST', '/community/chat', { body: 'Hallo Verein!', groupId: null }, 'member', key),
      write('POST', '/community/chat', { body: 'Hallo Verein!', groupId: null }, 'member', key),
    ]);
    replies.forEach((r) => expect(r.statusCode, r.body).toBe(201));
    expect(replies[0]!.json().id).toBe(replies[1]!.json().id);
    await ok(
      await write('POST', '/community/chat', { body: 'Hallo Verein!', groupId: null }, 'member'),
      201,
    );
    const club = await ok<{ items: { body: string; isOwn: boolean }[] }>(
      await get('/community/chat', 'member'),
    );
    expect(club.items).toHaveLength(2);
    expect(club.items.every((m) => m.isOwn)).toBe(true);
    await ok(
      await write('POST', '/community/chat', { body: 'Nur die Waldgruppe.', groupId }, 'member'),
      201,
    );
    expect((await get(`/community/chat?groupId=${groupId}`, 'other')).statusCode).toBe(404);
    expect(
      (await write('POST', '/community/chat', { body: 'Nicht erlaubt', groupId }, 'other'))
        .statusCode,
    ).toBe(404);
    const foreign = await app.inject({
      url: '/api/v1/community/chat',
      headers: headers('foreign', undefined, foreignOrg),
    });
    expect(foreign.json().items).toHaveLength(0);
  });
  it('lets authors and moderators remove messages while preserving an empty tombstone', async () => {
    const created = await ok<{ id: string }>(
      await write('POST', '/community/chat', { body: 'Dieser Text wird entfernt.' }, 'member'),
      201,
    );
    expect(
      (await write('POST', `/community/chat/${created.id}/remove`, { version: 1 }, 'other'))
        .statusCode,
    ).toBe(403);
    await ok(await write('POST', `/community/chat/${created.id}/remove`, { version: 1 }, 'board'));
    const page = await ok<{
      items: { body: string; removedAt: string | null; canRemove: boolean }[];
    }>(await get('/community/chat', 'member'));
    expect(page.items[0]!.body).toBe('');
    expect(page.items[0]!.removedAt).not.toBeNull();
    expect(page.items[0]!.canRemove).toBe(false);
    expect(
      (await write('POST', `/community/chat/${created.id}/remove`, { version: 1 }, 'member'))
        .statusCode,
    ).toBe(409);
    const [stored] = await db
      .select()
      .from(s.communityChatMessages)
      .where(eq(s.communityChatMessages.id, created.id));
    expect(stored!.body).toBe('');
    const own = await ok<{ id: string }>(
      await write('POST', '/community/chat', { body: 'Eigene Nachricht' }, 'member'),
      201,
    );
    await ok(await write('POST', `/community/chat/${own.id}/remove`, { version: 1 }, 'member'));
  });
  it('stores one reaction per account and emoji, scoped to the channel and the live message', async () => {
    const msg = await ok<{ id: string }>(
      await write('POST', '/community/chat', { body: 'Wer kommt mit? 🌲' }, 'member'),
      201,
    );
    const react = (emoji: string, active: boolean, role = 'member', key?: string) =>
      write('PUT', `/community/chat/${msg.id}/reactions`, { emoji, active }, role, key);
    const key = crypto.randomUUID();
    const replies = await Promise.all([
      react('👍', true, 'member', key),
      react('👍', true, 'member', key),
    ]);
    replies.forEach((r) => expect(r.statusCode, r.body).toBe(200));
    await ok(await react('👍', true));
    await ok(await react('👍', true, 'board'));
    await ok(await react('🎉', true, 'board'));
    type Listed = {
      items: {
        id: string;
        reactions: { emoji: string; count: number; mine: boolean; names: string[] }[];
      }[];
    };
    const reactionsOf = async (role: string) =>
      (await ok<Listed>(await get('/community/chat', role))).items.find((m) => m.id === msg.id)!
        .reactions;
    expect(await reactionsOf('member')).toEqual([
      { emoji: '👍', count: 2, mine: true, names: expect.any(Array) },
      { emoji: '🎉', count: 1, mine: false, names: expect.any(Array) },
    ]);
    expect((await reactionsOf('board'))[1]!.mine).toBe(true);
    await ok(await react('👍', false));
    await ok(await react('👍', false));
    expect(await reactionsOf('member')).toMatchObject([
      { emoji: '👍', count: 1, mine: false },
      { emoji: '🎉', count: 1 },
    ]);
    expect((await react('🍕', true)).statusCode).toBe(422);
    await expect(
      db.insert(s.communityChatReactions).values({
        organizationId: org,
        messageId: msg.id,
        userId: users.member!.id,
        emoji: '🍕',
      }),
    ).rejects.toThrow();
    const group = await ok<{ id: string }>(
      await write('POST', '/community/chat', { body: 'Nur Gruppe', groupId }, 'member'),
      201,
    );
    expect(
      (
        await write(
          'PUT',
          `/community/chat/${group.id}/reactions`,
          { emoji: '👍', active: true },
          'other',
        )
      ).statusCode,
    ).toBe(404);
    const foreign = await app.inject({
      method: 'PUT',
      url: `/api/v1/community/chat/${msg.id}/reactions`,
      headers: headers('foreign', crypto.randomUUID(), foreignOrg),
      payload: { emoji: '👍', active: true },
    });
    expect(foreign.statusCode).toBe(404);
    await ok(await write('POST', `/community/chat/${msg.id}/remove`, { version: 1 }, 'member'));
    expect(await reactionsOf('member')).toEqual([]);
    expect(
      await db
        .select()
        .from(s.communityChatReactions)
        .where(eq(s.communityChatReactions.messageId, msg.id)),
    ).toHaveLength(0);
    expect((await react('👍', true)).statusCode).toBe(409);
    await expect(
      db.insert(s.communityChatReactions).values({
        organizationId: org,
        messageId: msg.id,
        userId: users.member!.id,
        emoji: '👍',
      }),
    ).rejects.toThrow();
  });
  it('paginates chat history without duplicates and rejects cursors from another channel', async () => {
    await db.insert(s.communityChatMessages).values(
      Array.from({ length: 55 }, (_, i) => ({
        organizationId: org,
        groupId: null,
        createdBy: users.member!.id,
        body: `Nachricht ${i}`,
        createdAt: new Date('2026-01-01T10:00:00Z'),
      })),
    );
    const recent = await ok<{ items: { id: string }[]; nextBefore: string | null }>(
      await get('/community/chat', 'member'),
    );
    expect(recent.items).toHaveLength(50);
    expect(recent.nextBefore).not.toBeNull();
    const older = await ok<{ items: { id: string }[]; nextBefore: string | null }>(
      await get(`/community/chat?before=${recent.nextBefore}`, 'member'),
    );
    expect(older.items).toHaveLength(5);
    expect(older.nextBefore).toBeNull();
    expect(new Set([...older.items, ...recent.items].map((m) => m.id)).size).toBe(55);
    expect(
      (await get(`/community/chat?groupId=${groupId}&before=${recent.items[0]!.id}`, 'member'))
        .statusCode,
    ).toBe(404);
    expect((await write('POST', '/community/chat', { body: '   ' }, 'member')).statusCode).toBe(
      422,
    );
  });
  it('keeps drafts private and publishes bilingual club news for authenticated accounts', async () => {
    const post = await create(news());
    expect((await get(`/community/posts/${post.id}`, 'member')).statusCode).toBe(404);
    expect((await get('/community/posts?state=draft', 'member')).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/v1/community/posts' })).statusCode).toBe(401);
    const published = await action(post, 'publish', 'board');
    expect(published.version).toBe(2);
    const member = await ok<CommunityPost>(await get(`/community/posts/${post.id}`, 'member'));
    expect(member.bodyI18n.it).toBe('Attivi insieme.');
    expect(member.authorName).toBe('Community Admin');
    expect((await ok<{ total: number }>(await get('/community/posts', 'member'))).total).toBe(1);
    expect((await write('POST', '/community/posts', news(), 'member')).statusCode).toBe(403);
    expect((await write('POST', '/community/posts', news(), 'treasurer')).statusCode).toBe(403);
    expect((await write('POST', '/community/posts', news(), 'lead')).statusCode).toBe(403);
  });
  it('isolates group content and audiences and removes access after a group assignment is revoked', async () => {
    const post = await action(await create(news({ groupId })), 'publish');
    expect((await get(`/community/posts/${post.id}`, 'member')).statusCode).toBe(200);
    expect((await get(`/community/posts/${post.id}`, 'other')).statusCode).toBe(404);
    expect((await ok<{ total: number }>(await get('/community/posts', 'other'))).total).toBe(0);
    expect(
      (await ok<{ groups: unknown[] }>(await get('/community/audiences', 'other'))).groups,
    ).toHaveLength(0);
    expect((await get(`/community/posts?groupId=${groupId}`, 'other')).statusCode).toBe(404);
    await db
      .delete(s.groupMembers)
      .where(and(eq(s.groupMembers.organizationId, org), eq(s.groupMembers.groupId, groupId)));
    expect((await get(`/community/posts/${post.id}`, 'member')).statusCode).toBe(404);
  });
  it('rejects foreign organization ids and foreign group references without leaking content', async () => {
    const post = await create(news());
    const foreign = await app.inject({
      url: `/api/v1/community/posts/${post.id}`,
      headers: headers('foreign', undefined, foreignOrg),
    });
    expect(foreign.statusCode).toBe(404);
    const [group] = await db
      .insert(s.groups)
      .values({ organizationId: foreignOrg, name: 'Foreign' })
      .returning();
    expect((await write('POST', '/community/posts', news({ groupId: group!.id }))).statusCode).toBe(
      404,
    );
    const [raw] = await db.select().from(s.communityPosts).where(eq(s.communityPosts.id, post.id));
    await expect(
      db
        .insert(s.communityPosts)
        .values({ ...raw!, id: crypto.randomUUID(), organizationId: foreignOrg, groupId }),
    ).rejects.toThrow();
  });
  it('handles retries once and refuses stale edits and published audience changes', async () => {
    const key = crypto.randomUUID();
    const input = news();
    const responses = await Promise.all([
      write('POST', '/community/posts', input, 'admin', key),
      write('POST', '/community/posts', input, 'admin', key),
    ]);
    responses.forEach((r) => expect(r.statusCode, r.body).toBe(201));
    expect(responses[0]!.json().id).toBe(responses[1]!.json().id);
    const post = await ok<CommunityPost>(await get(`/community/posts/${responses[0]!.json().id}`));
    const published = await action(post, 'publish');
    expect(
      (
        await write('PATCH', `/community/posts/${post.id}`, {
          version: post.version,
          content: news(),
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await write('PATCH', `/community/posts/${post.id}`, {
          version: published.version,
          content: news({ groupId }),
        })
      ).statusCode,
    ).toBe(409);
    await ok(
      await write('PATCH', `/community/posts/${post.id}`, {
        version: published.version,
        content: news({ titleI18n: { de: 'Aktualisiert', it: 'Aggiornato' } }),
      }),
    );
    const updated = await ok<CommunityPost>(await get(`/community/posts/${post.id}`));
    await action(updated, 'archive');
    expect((await get(`/community/posts/${post.id}`, 'member')).statusCode).toBe(404);
  });
  it('accepts one vote per account, allows a change and reveals only aggregate results', async () => {
    const post = await action(await create(poll()), 'publish');
    const before = await ok<CommunityPost>(await get(`/community/posts/${post.id}`, 'member'));
    expect(before.totalVotes).toBeNull();
    expect(before.options.every((o) => o.votes === null)).toBe(true);
    const key = crypto.randomUUID();
    const retries = await Promise.all([vote(post, 0, 'member', key), vote(post, 0, 'member', key)]);
    retries.forEach((r) => expect(r.statusCode, r.body).toBe(200));
    let result = await ok<CommunityPost>(await get(`/community/posts/${post.id}`, 'member'));
    expect(result.totalVotes).toBe(1);
    expect(result.options[0]!.votes).toBe(1);
    await ok(await vote(post, 1));
    result = await ok<CommunityPost>(await get(`/community/posts/${post.id}`, 'member'));
    expect(result.totalVotes).toBe(1);
    expect(result.options[0]!.votes).toBe(0);
    expect(result.options[1]!.votes).toBe(1);
    const other = await ok<CommunityPost>(await get(`/community/posts/${post.id}`, 'other'));
    expect(other.myOptionId).toBeNull();
    expect(other.totalVotes).toBeNull();
    expect(JSON.stringify(other)).not.toContain(users.member!.id);
    const [stored] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.communityVotes)
      .where(eq(s.communityVotes.postId, post.id));
    expect(stored!.n).toBe(1);
  });
  it('hides after-close results even from managers and refuses votes or changes after closing', async () => {
    let post = await action(await create(poll({ resultsVisibility: 'after_close' })), 'publish');
    await ok(await vote(post));
    expect(
      (await ok<CommunityPost>(await get(`/community/posts/${post.id}`, 'member'))).totalVotes,
    ).toBeNull();
    expect(
      (await ok<CommunityPost>(await get(`/community/posts/${post.id}`, 'admin'))).totalVotes,
    ).toBeNull();
    post = await action(post, 'close');
    const results = await ok<CommunityPost>(await get(`/community/posts/${post.id}`, 'other'));
    expect(results.isClosed).toBe(true);
    expect(results.totalVotes).toBe(1);
    expect((await vote(post, 1)).statusCode).toBe(409);
    await expect(
      db
        .update(s.communityVotes)
        .set({ optionId: post.options[1]!.id })
        .where(eq(s.communityVotes.postId, post.id)),
    ).rejects.toThrow();
    await expect(
      db
        .update(s.communityPosts)
        .set({ closedAt: null, version: post.version + 1 })
        .where(eq(s.communityPosts.id, post.id)),
    ).rejects.toThrow();
  });
  it('prevents changing published choices and rejects answers from another poll', async () => {
    const post = await action(await create(poll()), 'publish');
    const other = await action(await create(poll()), 'publish');
    expect(
      (
        await write(
          'PUT',
          `/community/posts/${post.id}/vote`,
          { version: post.version, optionId: other.options[0]!.id },
          'member',
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await write('PATCH', `/community/posts/${post.id}`, {
          version: post.version,
          content: poll(),
        })
      ).statusCode,
    ).toBe(409);
    await expect(
      db
        .update(s.communityOptions)
        .set({ labelI18n: { de: 'Andere Antwort', it: 'Altra risposta' } })
        .where(eq(s.communityOptions.id, post.options[0]!.id)),
    ).rejects.toThrow();
    await expect(
      db.insert(s.communityVotes).values({
        organizationId: org,
        postId: post.id,
        userId: users.member!.id,
        optionId: other.options[0]!.id,
      }),
    ).rejects.toThrow();
  });
  it('enforces group voting in the API and in PostgreSQL', async () => {
    const post = await action(await create(poll({ groupId })), 'publish');
    expect((await vote(post, 0, 'other')).statusCode).toBe(404);
    await ok(await vote(post));
    await expect(
      db.insert(s.communityVotes).values({
        organizationId: org,
        postId: post.id,
        userId: users.other!.id,
        optionId: post.options[0]!.id,
      }),
    ).rejects.toThrow();
    await db.update(s.groups).set({ active: false }).where(eq(s.groups.id, groupId));
    expect((await get(`/community/posts/${post.id}`, 'member')).statusCode).toBe(404);
  });
  it('rejects expired publication deadlines and closes polls automatically at their deadline', async () => {
    const expired = await create(poll({ closesAt: '2020-01-01T10:00:00Z' }));
    expect(
      (await write('POST', `/community/posts/${expired.id}/publish`, { version: expired.version }))
        .statusCode,
    ).toBe(409);
    const deadline = new Date(Date.now() + 1000).toISOString();
    const post = await action(await create(poll({ closesAt: deadline })), 'publish');
    await db.execute(sql`select pg_sleep(1.1)`);
    const closed = await ok<CommunityPost>(await get(`/community/posts/${post.id}`, 'member'));
    expect(closed.isClosed).toBe(true);
    expect(closed.resultsVisible).toBe(true);
    expect((await vote(post)).statusCode).toBe(409);
    await expect(
      db.insert(s.communityVotes).values({
        organizationId: org,
        postId: post.id,
        userId: users.member!.id,
        optionId: post.options[0]!.id,
      }),
    ).rejects.toThrow();
  });
});

describe('unread markers and digests', () => {
  const unread = async (role: string) => ok<Unread>(await get('/community/unread', role));
  const markRead = (role: string, body: Record<string, unknown>) =>
    app.inject({
      method: 'PUT',
      url: '/api/v1/community/read',
      headers: headers(role),
      payload: body,
    });
  it('counts new content by others per channel and respects group membership', async () => {
    expect(await unread('member')).toEqual({ news: 0, polls: 0, chat: [], total: 0 });
    await action(await create(news()), 'publish');
    await action(await create(news({ groupId })), 'publish');
    await action(await create(poll()), 'publish');
    await create(news()); // draft: never unread
    await ok(await write('POST', '/community/chat', { body: 'Hallo alle' }, 'board'), 201);
    await ok(await write('POST', '/community/chat', { body: 'Hallo Wald', groupId }, 'board'), 201);
    await ok(await write('POST', '/community/chat', { body: 'Meine eigene' }, 'member'), 201);
    const removed = await ok<{ id: string }>(
      await write('POST', '/community/chat', { body: 'Gleich weg' }, 'board'),
      201,
    );
    await ok(await write('POST', `/community/chat/${removed.id}/remove`, { version: 1 }, 'board'));
    expect(await unread('member')).toEqual({
      news: 2,
      polls: 1,
      chat: [
        { groupId: null, count: 1 },
        { groupId, count: 1 },
      ],
      total: 5,
    });
    // Not in the group: neither group news nor group chat count; the member's club message does.
    expect(await unread('other')).toEqual({
      news: 1,
      polls: 1,
      chat: [{ groupId: null, count: 2 }],
      total: 4,
    });
    // The author's own posts and messages never count for them.
    expect((await unread('admin')).news).toBe(0);
  });
  it('moves read markers forward only and validates their scope', async () => {
    await ok(await write('POST', '/community/chat', { body: 'Eins' }, 'board'), 201);
    const now = new Date().toISOString();
    expect((await markRead('member', { channel: 'chat', until: now })).statusCode).toBe(204);
    expect((await unread('member')).chat).toEqual([]);
    expect(
      (await markRead('member', { channel: 'chat', until: '2020-01-01T00:00:00Z' })).statusCode,
    ).toBe(204);
    expect((await unread('member')).chat).toEqual([]);
    await ok(await write('POST', '/community/chat', { body: 'Zwei' }, 'board'), 201);
    expect((await unread('member')).chat).toEqual([{ groupId: null, count: 1 }]);
    // Marking up to the newest item exactly as the API returned it (millisecond precision).
    const listed = await ok<{ items: { createdAt: string }[] }>(
      await get('/community/chat', 'member'),
    );
    await markRead('member', { channel: 'chat', until: listed.items.at(-1)!.createdAt });
    expect((await unread('member')).chat).toEqual([]);
    await action(await create(news()), 'publish');
    await markRead('member', { channel: 'news', until: new Date().toISOString() });
    expect((await unread('member')).news).toBe(0);
    // A future `until` is clamped to the server clock, so later news still counts.
    await markRead('member', { channel: 'news', until: '2999-01-01T00:00:00Z' });
    await action(await create(news()), 'publish');
    expect((await unread('member')).news).toBe(1);
    expect((await markRead('member', { channel: 'news', groupId, until: now })).statusCode).toBe(
      422,
    );
    expect((await markRead('other', { channel: 'chat', groupId, until: now })).statusCode).toBe(
      404,
    );
    const foreign = await app.inject({
      method: 'PUT',
      url: '/api/v1/community/read',
      headers: headers('foreign', undefined, foreignOrg),
      payload: { channel: 'chat', groupId, until: now },
    });
    expect(foreign.statusCode).toBe(404);
  });
  it('stores the digest preference per account and organization', async () => {
    const initial = await ok<{ digest: string; email: string; emailEnabled: boolean }>(
      await get('/community/notifications', 'member'),
    );
    expect(initial).toEqual({
      digest: 'off',
      email: 'community-member@example.test',
      emailEnabled: false,
      pushPublicKey: null,
    });
    const put = (digest: string) =>
      app.inject({
        method: 'PUT',
        url: '/api/v1/community/notifications',
        headers: headers('member'),
        payload: { digest },
      });
    expect((await ok<{ digest: string }>(await put('weekly'))).digest).toBe('weekly');
    expect((await put('hourly')).statusCode).toBe(422);
    expect(
      (await ok<{ digest: string }>(await get('/community/notifications', 'member'))).digest,
    ).toBe('weekly');
    expect(
      (await ok<{ digest: string }>(await get('/community/notifications', 'other'))).digest,
    ).toBe('off');
  });
  it('queues one digest per due day with unread titles and revalidates before sending', async () => {
    const mailConfig = { ...config, EMAIL_MODE: 'local' as const };
    await db.insert(s.communityNotificationSettings).values([
      {
        organizationId: org,
        userId: users.member!.id,
        digest: 'daily',
        lastDigestAt: new Date(Date.now() - 60_000),
        lastDigestOn: '2020-01-01',
      },
      {
        organizationId: org,
        userId: users.other!.id,
        digest: 'daily',
        lastDigestAt: new Date(Date.now() - 60_000),
        lastDigestOn: '2020-01-01',
      },
    ]);
    await action(await create(news({ groupId })), 'publish');
    await ok(await write('POST', '/community/chat', { body: 'Hallo Wald', groupId }, 'board'), 201);
    // 09:00 in Europe/Rome, safely after DIGEST_HOUR.
    const morning = new Date();
    morning.setUTCHours(8, 0, 0, 0);
    if (morning.getTime() < Date.now()) morning.setUTCDate(morning.getUTCDate() + 1);
    await enqueueCommunityDigests(db, mailConfig, morning);
    await enqueueCommunityDigests(db, mailConfig, morning);
    const mails = await db
      .select()
      .from(s.mailMessages)
      .where(
        and(eq(s.mailMessages.organizationId, org), eq(s.mailMessages.kind, 'community_digest')),
      );
    // `other` is not in the group, so nothing is new for them: no empty digest.
    expect(mails).toHaveLength(1);
    const [mail] = mails;
    expect(mail!.userId).toBe(users.member!.id);
    expect(mail!.recipient).toBe('community-member@example.test');
    expect(mail!.body).toContain('Neuigkeiten aus dem Verein');
    expect(mail!.body).toContain('Waldgruppe: 1');
    expect(mail!.body).not.toContain('Hallo Wald');
    const settings = await db
      .select()
      .from(s.communityNotificationSettings)
      .where(eq(s.communityNotificationSettings.organizationId, org));
    expect(settings.every((row) => row.lastDigestOn !== '2020-01-01')).toBe(true);
    expect(await revalidateDigest(db, mail!)).toBe(true);
    await db
      .update(s.communityNotificationSettings)
      .set({ digest: 'off' })
      .where(eq(s.communityNotificationSettings.userId, users.member!.id));
    expect(await revalidateDigest(db, mail!)).toBe(false);
  });
  it('schedules daily and weekly digests after the morning hour', () => {
    expect(digestDue('off', null, '2026-11-03', 9)).toBe(false);
    expect(digestDue('daily', '2026-11-02', '2026-11-03', 6)).toBe(false);
    expect(digestDue('daily', '2026-11-02', '2026-11-03', 7)).toBe(true);
    expect(digestDue('daily', '2026-11-03', '2026-11-03', 20)).toBe(false);
    expect(digestDue('weekly', '2026-10-28', '2026-11-03', 9)).toBe(false);
    expect(digestDue('weekly', '2026-10-27', '2026-11-03', 9)).toBe(true);
  });
});
describe('chat replies, mentions and shared cards', () => {
  type Msg = {
    id: string;
    body: string;
    replyTo: { id: string; authorName: string; excerpt: string; removed: boolean } | null;
    mentionsMe: boolean;
    attachment: {
      kind: string;
      available: boolean;
      title: { de: string } | null;
      closed: boolean;
    } | null;
  };
  const list = async (role: string, group?: string) =>
    (
      await ok<{ items: Msg[] }>(
        await get(`/community/chat${group ? `?groupId=${group}` : ''}`, role),
      )
    ).items;
  const send = (payload: Record<string, unknown>, role = 'member') =>
    write('POST', '/community/chat', payload, role);
  it('links replies within the same channel and shows a preview', async () => {
    const first = await ok<{ id: string }>(
      await send({ body: 'Wer bringt Handschuhe?' }, 'board'),
      201,
    );
    await ok(await send({ body: 'Ich!', replyToId: first.id }), 201);
    const reply = (await list('other')).find((x) => x.body === 'Ich!')!;
    expect(reply.replyTo).toEqual({
      id: first.id,
      authorName: 'board',
      excerpt: 'Wer bringt Handschuhe?',
      removed: false,
    });
    const inGroup = await ok<{ id: string }>(await send({ body: 'Nur Gruppe', groupId }), 201);
    expect((await send({ body: 'Quer', replyToId: inGroup.id })).statusCode).toBe(404);
    await ok(await write('POST', `/community/chat/${first.id}/remove`, { version: 1 }, 'board'));
    expect((await list('member')).find((x) => x.body === 'Ich!')!.replyTo).toMatchObject({
      excerpt: '',
      removed: true,
    });
  });
  it('mentions only accounts with access to the channel and flags them', async () => {
    const members = async (group?: string, role = 'member') =>
      (
        await ok<{ items: { userId: string; name: string }[] }>(
          await get(`/community/chat/members${group ? `?groupId=${group}` : ''}`, role),
        )
      ).items.map((u) => u.name);
    expect(await members()).toEqual(
      expect.arrayContaining(['member', 'other', 'board', 'treasurer']),
    );
    const groupMembers = await members(groupId);
    expect(groupMembers).toEqual(expect.arrayContaining(['member', 'board']));
    expect(groupMembers).not.toContain('other');
    expect((await get(`/community/chat/members?groupId=${groupId}`, 'other')).statusCode).toBe(404);
    await ok(await send({ body: '@other kommst du?', mentionUserIds: [users.other!.id] }), 201);
    expect((await list('other')).find((x) => x.body.startsWith('@other'))!.mentionsMe).toBe(true);
    expect((await list('board')).find((x) => x.body.startsWith('@other'))!.mentionsMe).toBe(false);
    expect(
      (await send({ body: '@other', groupId, mentionUserIds: [users.other!.id] })).json().error
        .code,
    ).toBe('MENTION_NOT_ALLOWED');
    await ok(await send({ body: '@board', groupId, mentionUserIds: [users.board!.id] }), 201);
  });
  it('shares polls and events as cards that respect each viewer’s access', async () => {
    const club = await action(await create(poll()), 'publish');
    const grouped = await action(await create(poll({ groupId })), 'publish');
    const draft = await create(poll());
    await ok(
      await send({ body: 'Abstimmen!', attachment: { kind: 'poll', id: club.id } }, 'admin'),
      201,
    );
    for (const bad of [grouped.id, draft.id, crypto.randomUUID()])
      expect(
        (await send({ body: 'x', attachment: { kind: 'poll', id: bad } }, 'admin')).statusCode,
      ).toBe(404);
    await ok(
      await send({
        body: 'Gruppe stimmt ab',
        groupId,
        attachment: { kind: 'poll', id: grouped.id },
      }),
      201,
    );
    const card = (await list('other')).find((x) => x.body === 'Abstimmen!')!.attachment!;
    expect(card).toMatchObject({ kind: 'poll', available: true, closed: false });
    expect(card.title?.de).toBe('Wann treffen wir uns?');
    await action(club, 'close');
    expect((await list('other')).find((x) => x.body === 'Abstimmen!')!.attachment!.closed).toBe(
      true,
    );
    const category = await ok<{ id: string }>(
      await write('POST', '/event-categories', { nameI18n: { de: 'Natur', it: 'Natura' } }),
      201,
    );
    const day = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const event = await ok<{ id: string }>(
      await write('POST', '/events', {
        titleI18n: { de: 'Krötenwanderung', it: 'Migrazione dei rospi' },
        descriptionI18n: { de: '', it: '' },
        categoryId: category.id,
        startLocal: `${day}T18:00`,
        endLocal: `${day}T20:00`,
        organizerId: users.admin!.id,
        status: 'published',
        visibility: 'members',
        location: 'Seeufer',
      }),
      201,
    );
    const shared = await ok<{ id: string }>(
      await send({ body: 'Kommt mit!', attachment: { kind: 'event', id: event.id } }),
      201,
    );
    expect((await list('other')).find((x) => x.id === shared.id)!.attachment).toMatchObject({
      kind: 'event',
      available: true,
      location: 'Seeufer',
      closed: false,
      title: { de: 'Krötenwanderung' },
    });
    await ok(await write('POST', `/community/chat/${shared.id}/remove`, { version: 1 }, 'member'));
    expect((await list('other')).find((x) => x.id === shared.id)!.attachment).toBeNull();
  });
});
describe('scheduling polls', () => {
  const at = (days: number, hour: number) => {
    const d = new Date(Date.now() + days * 86_400_000);
    d.setUTCHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const input = (patch: Record<string, unknown> = {}) => ({
    titleI18n: { de: 'Wann pflegen wir die Hecke?', it: 'Quando curiamo la siepe?' },
    location: 'Biotop',
    slots: [
      { startAt: at(10, 8), endAt: at(10, 11) },
      { startAt: at(11, 8), endAt: at(11, 11) },
      { startAt: at(12, 14), endAt: at(12, 17) },
    ],
    ...patch,
  });
  type Detail = {
    id: string;
    version: number;
    isOpen: boolean;
    slots: { id: string; yes: number; maybe: number; no: number; mine: string | null }[];
    bestSlotIds: string[];
    participants: { name: string; answers: Record<string, string> }[];
    canManage: boolean;
    finalSlot: { startAt: string } | null;
    eventId: string | null;
  };
  const detail = async (id: string, role = 'member') =>
    ok<Detail>(await get(`/community/schedules/${id}`, role));
  const answer = (id: string, answers: unknown, role = 'member', key?: string) =>
    write('PUT', `/community/schedules/${id}/answers`, { answers }, role, key);
  it('collects yes/maybe/no per slot, lets answers change and highlights the best slot', async () => {
    const created = await ok<{ id: string }>(
      await write('POST', '/community/schedules', input(), 'lead'),
      201,
    );
    expect((await write('POST', '/community/schedules', input(), 'member')).statusCode).toBe(403);
    expect(
      (
        await write('POST', '/community/schedules', {
          ...input(),
          slots: [
            { startAt: at(1, 9), endAt: at(1, 8) },
            { startAt: at(2, 9), endAt: at(2, 10) },
          ],
        })
      ).statusCode,
    ).toBe(422);
    const view = await detail(created.id);
    expect(view.slots).toHaveLength(3);
    expect(view.canManage).toBe(false);
    const [a, b, c] = view.slots.map((x) => x.id) as [string, string, string];
    const key = crypto.randomUUID();
    const twice = await Promise.all([
      answer(
        created.id,
        [
          { slotId: a, answer: 'yes' },
          { slotId: b, answer: 'maybe' },
        ],
        'member',
        key,
      ),
      answer(
        created.id,
        [
          { slotId: a, answer: 'yes' },
          { slotId: b, answer: 'maybe' },
        ],
        'member',
        key,
      ),
    ]);
    twice.forEach((r) => expect(r.statusCode, r.body).toBe(200));
    await ok(
      await answer(
        created.id,
        [
          { slotId: b, answer: 'yes' },
          { slotId: c, answer: 'no' },
        ],
        'other',
      ),
    );
    await ok(await answer(created.id, [{ slotId: b, answer: 'yes' }], 'board'));
    // Changing an answer replaces it.
    await ok(await answer(created.id, [{ slotId: b, answer: 'yes' }], 'member'));
    const after = await detail(created.id);
    expect(after.slots.map((x) => [x.yes, x.maybe, x.no])).toEqual([
      [1, 0, 0],
      [3, 0, 0],
      [0, 0, 1],
    ]);
    expect(after.slots.map((x) => x.mine)).toEqual(['yes', 'yes', null]);
    expect(after.bestSlotIds).toEqual([b]);
    expect(after.participants.map((p) => p.name)).toEqual(['board', 'member', 'other']);
    expect(
      (await answer(created.id, [{ slotId: crypto.randomUUID(), answer: 'yes' }])).statusCode,
    ).toBe(404);
    // Only the organizer (or a moderator) closes it, with a final slot.
    expect(
      (
        await write('POST', `/community/schedules/${created.id}/close`, {
          version: after.version,
          finalSlotId: b,
        })
      ).statusCode,
    ).toBe(200);
    const closed = await detail(created.id);
    expect(closed.isOpen).toBe(false);
    expect(closed.finalSlot?.startAt).toBe(after.slots[1] ? at(11, 8) : '');
    expect((await answer(created.id, [{ slotId: a, answer: 'no' }])).json().error.code).toBe(
      'SCHEDULE_CLOSED',
    );
    await expect(
      db.insert(s.communityScheduleAnswers).values({
        organizationId: org,
        scheduleId: created.id,
        slotId: c,
        userId: users.member!.id,
        answer: 'yes',
      }),
    ).rejects.toThrow();
    const open = await ok<{ items: { id: string }[] }>(await get('/community/schedules', 'member'));
    expect(open.items.map((x) => x.id)).not.toContain(created.id);
    const done = await ok<{ items: { id: string; finalSlot: unknown }[] }>(
      await get('/community/schedules?state=closed', 'member'),
    );
    expect(done.items.find((x) => x.id === created.id)?.finalSlot).not.toBeNull();
  });
  it('turns the fixed slot into exactly one event in club time', async () => {
    const created = await ok<{ id: string }>(
      await write('POST', '/community/schedules', input(), 'lead'),
      201,
    );
    const category = await ok<{ id: string }>(
      await write('POST', '/event-categories', { nameI18n: { de: 'Pflege', it: 'Cura' } }),
      201,
    );
    const toEvent = (role = 'lead', key?: string) =>
      write(
        'POST',
        `/community/schedules/${created.id}/event`,
        { categoryId: category.id, visibility: 'members', status: 'published' },
        role,
        key,
      );
    expect((await toEvent()).json().error.code).toBe('SCHEDULE_NOT_FIXED');
    const view = await detail(created.id, 'lead');
    const final = view.slots[1]!;
    await ok(
      await write(
        'POST',
        `/community/schedules/${created.id}/close`,
        { version: view.version, finalSlotId: final.id },
        'lead',
      ),
    );
    expect((await toEvent('member')).statusCode).toBe(403);
    const key = crypto.randomUUID();
    const [first, replay] = await Promise.all([toEvent('lead', key), toEvent('lead', key)]);
    expect(first.statusCode, first.body).toBe(201);
    expect(replay.json().id).toBe(first.json().id);
    const eventId = first.json<{ id: string }>().id;
    const event = await ok<{
      titleI18n: { de: string };
      startAt: string;
      endAt: string;
      location: string;
      status: string;
    }>(await get(`/events/${eventId}`, 'admin'));
    expect(event).toMatchObject({
      titleI18n: { de: 'Wann pflegen wir die Hecke?' },
      location: 'Biotop',
      status: 'published',
    });
    expect(new Date(event.startAt).toISOString()).toBe(at(11, 8));
    expect(new Date(event.endAt).toISOString()).toBe(at(11, 11));
    expect((await detail(created.id)).eventId).toBe(eventId);
    expect((await toEvent()).json().error.code).toBe('EVENT_EXISTS');
  });
  it('limits group schedules to the group and rejects foreign slots and closing by others', async () => {
    const grouped = await ok<{ id: string }>(
      await write('POST', '/community/schedules', input({ groupId }), 'board'),
      201,
    );
    expect((await get(`/community/schedules/${grouped.id}`, 'other')).statusCode).toBe(404);
    const view = await detail(grouped.id);
    const other = await ok<{ id: string }>(
      await write('POST', '/community/schedules', input()),
      201,
    );
    const foreignSlot = (await detail(other.id)).slots[0]!.id;
    expect((await answer(grouped.id, [{ slotId: foreignSlot, answer: 'yes' }])).statusCode).toBe(
      404,
    );
    expect(
      (
        await write(
          'POST',
          `/community/schedules/${grouped.id}/close`,
          { version: view.version },
          'member',
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          url: `/api/v1/community/schedules/${grouped.id}`,
          headers: headers('foreign', undefined, foreignOrg),
        })
      ).statusCode,
    ).toBe(404);
    const expired = await write(
      'POST',
      '/community/schedules',
      input({ closesAt: '2020-01-01T00:00:00Z' }),
    );
    expect(expired.json().error.code).toBe('DEADLINE_PASSED');
  });
});
describe('rate limits', () => {
  it('keeps unread polling out of the general per-IP budget', async () => {
    const remoteAddress = '203.0.113.42';
    const call = (url: string) =>
      app.inject({ url: `/api/v1${url}`, headers: headers('member'), remoteAddress });
    for (let i = 0; i < 120; i++) expect((await call('/community/unread')).statusCode).toBe(200);
    expect((await call('/community/unread')).statusCode).toBe(429);
    // 120 polls plus 100 regular requests exceed 150, yet regular requests still pass.
    for (let i = 0; i < 100; i++) expect((await call('/community/audiences')).statusCode).toBe(200);
  });
});

describe('schedule pagination', () => {
  it('keeps all schedules reachable across pages', async () => {
    const inserted = await db
      .insert(s.communitySchedules)
      .values(
        Array.from({ length: 51 }, (_, i) => ({
          organizationId: org,
          titleI18n: { de: `Page ${i}`, it: `Pagina ${i}` },
          descriptionI18n: { de: '', it: '' },
          createdBy: users.admin!.id,
        })),
      )
      .returning();
    const first = await ok<{ items: { id: string }[]; total: number }>(
      await get('/community/schedules?page=1&pageSize=50'),
    );
    const second = await ok<{ items: { id: string }[] }>(
      await get('/community/schedules?page=2&pageSize=50'),
    );
    expect(first.total).toBe(51);
    expect(new Set([...first.items, ...second.items].map((x) => x.id))).toEqual(
      new Set(inserted.map((x) => x.id)),
    );
  });
});

describe('shared network polling', () => {
  it('gives authenticated accounts separate budgets on the same IP', async () => {
    const call = (role: string) =>
      app.inject({
        url: '/api/v1/community/audiences',
        headers: headers(role),
        remoteAddress: '203.0.113.50',
      });
    for (let i = 0; i < 150; i++) expect((await call('member')).statusCode).toBe(200);
    expect((await call('member')).statusCode).toBe(429);
    expect((await call('other')).statusCode).toBe(200);
  });
});

describe('push notifications', () => {
  const pushConfig = {
    ...config,
    VAPID_PUBLIC_KEY: 'test-public-key',
    VAPID_PRIVATE_KEY: 'test-private-key',
  };
  let sent: { target: PushTarget; payload: PushPayload }[] = [];
  let outcome: (target: PushTarget) => 'sent' | 'gone' | Error = () => 'sent';
  const sender: PushSender = async (target, payload) => {
    sent.push({ target, payload });
    const result = outcome(target);
    if (result instanceof Error) throw result;
    return result;
  };
  const endpoint = (name: string) => `https://fcm.googleapis.com/fcm/send/${name}`;
  const device = (name: string) => ({
    endpoint: endpoint(name),
    keys: { p256dh: `p256dh-key-of-${name}-0123456789`, auth: `auth-key-of-${name}-0123` },
  });
  const subscribe = (role: string, name = role, payload: unknown = device(name)) =>
    app.inject({
      method: 'PUT',
      url: '/api/v1/community/push-subscriptions',
      headers: headers(role),
      payload: payload as Record<string, unknown>,
    });
  const unsubscribe = (role: string, name = role) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/community/push-subscriptions/remove',
      headers: headers(role),
      payload: { endpoint: endpoint(name) },
    });
  const stored = () =>
    db.select().from(s.pushSubscriptions).where(eq(s.pushSubscriptions.organizationId, org));
  const receivers = () => sent.map((x) => x.target.endpoint.split('/').pop()).sort();
  // Deliveries start after the response; give a late one the chance to show up.
  const settled = async (count: number) => {
    await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(count));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sent).toHaveLength(count);
  };
  beforeEach(async () => {
    sent = [];
    outcome = () => 'sent';
    await app.close();
    app = await createApp(db, pushConfig, sender);
    await app.ready();
  });

  it('is switched off without server keys', async () => {
    await app.close();
    app = await createApp(db, config);
    await app.ready();
    const res = await subscribe('member');
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().error.code).toBe('PUSH_DISABLED');
    expect(await stored()).toHaveLength(0);
  });
  it('announces the public key and stores one row per device', async () => {
    const settings = await ok<{ pushPublicKey: string | null }>(
      await get('/community/notifications', 'member'),
    );
    expect(settings.pushPublicKey).toBe('test-public-key');
    expect((await subscribe('member')).statusCode).toBe(204);
    expect((await subscribe('member')).statusCode).toBe(204);
    expect((await subscribe('member', 'tablet')).statusCode).toBe(204);
    const rows = await stored();
    expect(rows.map((r) => r.endpoint).sort()).toEqual([endpoint('member'), endpoint('tablet')]);
    expect(rows.every((r) => r.userId === users.member!.id)).toBe(true);
  });
  it('only accepts endpoints of known push services', async () => {
    for (const bad of [
      'https://internal.example.test/hook',
      'http://fcm.googleapis.com/fcm/send/x',
      'https://fcm.googleapis.com.evil.test/x',
      'https://user:secret@fcm.googleapis.com/x',
      'https://fcm.googleapis.com:8443/x',
      'not a url',
    ]) {
      const res = await subscribe('member', 'x', { ...device('x'), endpoint: bad });
      expect(res.statusCode, bad).toBe(422);
    }
    expect((await subscribe('member', 'x', { endpoint: endpoint('x') })).statusCode).toBe(422);
    expect(await stored()).toHaveLength(0);
    for (const good of [
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/abc',
      'https://db5p.notify.windows.com/w/?token=abc',
    ])
      expect(
        (await subscribe('member', 'x', { ...device('x'), endpoint: good })).statusCode,
        good,
      ).toBe(204);
  });
  it('hands a shared device to the account that signs in and keeps clubs apart', async () => {
    await subscribe('member', 'shared');
    await subscribe('other', 'shared');
    const rows = await stored();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(users.other!.id);
    // The same device registered in another club is a separate row and is not touched here.
    await db.insert(s.pushSubscriptions).values({
      organizationId: foreignOrg,
      userId: users.foreign!.id,
      endpoint: endpoint('shared'),
      p256dh: 'p',
      auth: 'a',
    });
    expect((await unsubscribe('member', 'shared')).statusCode).toBe(204);
    expect(await stored()).toHaveLength(1);
    expect((await unsubscribe('other', 'shared')).statusCode).toBe(204);
    expect(await stored()).toHaveLength(0);
    const foreign = await db
      .select()
      .from(s.pushSubscriptions)
      .where(eq(s.pushSubscriptions.organizationId, foreignOrg));
    expect(foreign).toHaveLength(1);
    await db.delete(s.pushSubscriptions).where(eq(s.pushSubscriptions.organizationId, foreignOrg));
  });
  it('notifies the club about published news once, in each language, never the publisher', async () => {
    await db
      .update(s.persons)
      .set({ preferredLanguage: 'it' })
      .where(eq(s.persons.organizationId, org));
    for (const role of ['admin', 'member', 'other', 'board']) await subscribe(role);
    const draft = await create(news());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sent).toHaveLength(0);
    const key = crypto.randomUUID();
    const publish = () =>
      write(
        'POST',
        `/community/posts/${draft.id}/publish`,
        { version: draft.version },
        'admin',
        key,
      );
    await ok(await publish());
    await settled(3);
    await ok(await publish());
    await settled(3);
    expect(receivers()).toEqual(['board', 'member', 'other']);
    const of = (role: string) => sent.find((x) => x.target.endpoint === endpoint(role))!.payload;
    expect(of('member')).toEqual({
      title: 'Novità associative',
      body: 'Novità · b*nature Community-Test',
      url: `/community/${draft.id}`,
      tag: `post:${draft.id}`,
    });
    expect(of('other').title).toBe('Neuigkeiten aus dem Verein');
    expect(of('other').body).toBe('Neuigkeit · b*nature Community-Test');
  });
  it('limits group news and group chat to linked group members', async () => {
    for (const role of ['admin', 'member', 'other', 'board']) await subscribe(role);
    await action(await create(poll({ groupId })), 'publish');
    await settled(1);
    expect(receivers()).toEqual(['member']);
    expect(sent[0]!.payload.body).toBe('Neue Umfrage · b*nature Community-Test');
    sent = [];
    await ok(
      await write('POST', '/community/chat', { body: 'Geheimer Treffpunkt', groupId }, 'board'),
      201,
    );
    await settled(1);
    expect(receivers()).toEqual(['member']);
    expect(sent[0]!.payload).toEqual({
      title: 'Waldgruppe · b*nature Community-Test',
      body: 'Neue Nachricht von board',
      url: `/community?kind=chat&groupId=${groupId}`,
      tag: `chat:${org}:${groupId}`,
    });
    expect(JSON.stringify(sent)).not.toContain('Geheimer Treffpunkt');
  });
  it('tells mentioned accounts apart, forgets dead devices and survives push failures', async () => {
    for (const role of ['member', 'other', 'board']) await subscribe(role);
    outcome = (target) =>
      target.endpoint === endpoint('other')
        ? 'gone'
        : target.endpoint === endpoint('board')
          ? new Error('push service unreachable')
          : 'sent';
    const key = crypto.randomUUID();
    const send = () =>
      write(
        'POST',
        '/community/chat',
        { body: 'Hallo @member', groupId: null, mentionUserIds: [users.member!.id] },
        'admin',
        key,
      );
    await ok(await send(), 201);
    await settled(3);
    await ok(await send(), 201);
    await settled(3);
    const of = (role: string) => sent.find((x) => x.target.endpoint === endpoint(role))!.payload;
    expect(of('member').body).toBe('Community Admin hat dich erwähnt');
    expect(of('board').body).toBe('Neue Nachricht von Community Admin');
    expect(of('member').title).toBe('Vereinschat · b*nature Community-Test');
    expect(of('member').url).toBe('/community?kind=chat');
    await vi.waitFor(async () =>
      expect((await stored()).map((r) => r.endpoint).sort()).toEqual([
        endpoint('board'),
        endpoint('member'),
      ]),
    );
  });
  it('drops subscriptions with the club access and keeps at most ten devices', async () => {
    for (let i = 0; i < 12; i++) await subscribe('member', `device-${i}`);
    const rows = await stored();
    expect(rows).toHaveLength(10);
    expect(rows.map((r) => r.endpoint)).not.toContain(endpoint('device-0'));
    expect(rows.map((r) => r.endpoint)).toContain(endpoint('device-11'));
    await db
      .delete(s.organizationUserRoles)
      .where(
        and(
          eq(s.organizationUserRoles.organizationId, org),
          eq(s.organizationUserRoles.userId, users.member!.id),
        ),
      );
    expect(await stored()).toHaveLength(0);
  });
});
