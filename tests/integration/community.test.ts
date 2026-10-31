import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, sql } from 'drizzle-orm';
import { createDatabase, schema as s } from '../../packages/db/src';
import { createApp } from '../../apps/api/src/app';
import { createAuth } from '../../apps/api/src/auth';
import { bootstrap } from '../../apps/api/src/services/bootstrap';
import { readConfig } from '../../apps/api/src/plugins/config';
import type { CommunityPost } from '../../packages/contracts/src';
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
