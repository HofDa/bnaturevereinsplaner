import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, sql } from 'drizzle-orm';
import { createDatabase, schema as s } from '../../packages/db/src';
import { createApp } from '../../apps/api/src/app';
import { bootstrap } from '../../apps/api/src/services/bootstrap';
import { readConfig } from '../../apps/api/src/plugins/config';
import type { Member, Group, Me, Page } from '../../packages/contracts/src';
const config = readConfig();
if (config.NODE_ENV !== 'test' || !new URL(config.DATABASE_URL).pathname.endsWith('/bnature_test'))
  throw new Error('Integration tests require NODE_ENV=test and a dedicated bnature_test database');
const { db, pool } = createDatabase(config.DATABASE_URL);
const app = await createApp(db, config);
let cookieA = '',
  cookieB = '',
  memberCookie = '',
  treasurerCookie = '',
  leadCookie = '';
let orgA = '',
  orgB = '',
  userA = '',
  foreign: Member,
  own: Member,
  groupA: Group;
const password = 'Integration-only-Password-2026!';
const headers = (cookie: string, org?: string) => ({
  cookie,
  origin: config.APP_URL,
  ...(org ? { 'x-organization-id': org } : {}),
});
const memberInput = (number: string) => ({
  firstName: 'Anna',
  lastName: `Test ${number}`,
  email: `test-${number}@example.test`,
  membershipNumber: number,
  joinedAt: '2026-01-01',
  status: 'active',
});
async function login(email: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers: { origin: config.APP_URL },
    payload: { email, password },
  });
  expect(response.statusCode, response.body).toBe(200);
  const cookies = response.headers['set-cookie'];
  return (Array.isArray(cookies) ? cookies : [cookies])
    .filter(Boolean)
    .map((cookie) => cookie!.split(';')[0])
    .join('; ');
}
beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/db/migrations' });
  await db.execute(sql`truncate table organizations, users cascade`);
  const a = await bootstrap(db, config, {
    name: 'Admin A',
    email: 'admin-a@example.test',
    password,
    organizationName: 'Organisation A',
    slug: 'org-a',
  });
  const b = await bootstrap(db, config, {
    name: 'Admin B',
    email: 'admin-b@example.test',
    password,
    organizationName: 'Organisation B',
    slug: 'org-b',
  });
  orgA = a.organizationId;
  orgB = b.organizationId;
  userA = a.userId;
  await app.ready();
  cookieA = await login('admin-a@example.test');
  cookieB = await login('admin-b@example.test');
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/members',
    headers: headers(cookieB),
    payload: memberInput('B-001'),
  });
  expect(response.statusCode, response.body).toBe(201);
  foreign = response.json<Member>();
  const ownResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/members',
    headers: headers(cookieA),
    payload: memberInput('A-001'),
  });
  expect(ownResponse.statusCode, ownResponse.body).toBe(201);
  own = ownResponse.json<Member>();
  for (const [role, email] of [
    ['member', 'member@example.test'],
    ['treasurer', 'treasurer@example.test'],
    ['project_lead', 'lead@example.test'],
  ] as const) {
    const result = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: headers(cookieA),
      payload: {
        name: role,
        email,
        password,
        role,
        ...(role === 'member' ? { personId: own.personId } : {}),
      },
    });
    expect(result.statusCode, result.body).toBe(201);
  }
  memberCookie = await login('member@example.test');
  treasurerCookie = await login('treasurer@example.test');
  leadCookie = await login('lead@example.test');
});
afterAll(async () => {
  await app.close();
  await pool.end();
});
describe('actual Better Auth integration', () => {
  it('serves health and refuses unauthenticated personal data', async () => {
    expect((await app.inject('/api/v1/health')).json()).toEqual({ status: 'ok' });
    for (const path of ['/api/v1/me', '/api/v1/members', '/api/v1/groups', '/api/v1/audit-logs'])
      expect((await app.inject(path)).statusCode).toBe(401);
  });
  it('returns secure session attributes and a real session', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: config.APP_URL },
      payload: { email: 'admin-a@example.test', password },
    });
    expect(String(response.headers['set-cookie'])).toMatch(/httponly/i);
    expect(String(response.headers['set-cookie'])).toMatch(/samesite=lax/i);
    const me = await app.inject({ url: '/api/v1/me', headers: headers(cookieA) });
    expect(me.json<Me>().activeOrganizationId).toBe(orgA);
    expect(me.json<Me>().timezone).toBe('Europe/Rome');
    expect(me.json<Me>().permissions).toContain('users:manage');
    expect(me.headers['cache-control']).toBe('no-store');
  });
  it('never exposes signup or an unlisted auth endpoint', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: config.APP_URL },
      payload: { name: 'Attacker', email: 'attacker@example.test', password },
    });
    expect(response.statusCode).toBe(404);
    expect(
      (await db.select().from(s.user).where(eq(s.user.email, 'attacker@example.test'))).length,
    ).toBe(0);
  });
  it('rejects wrong or absent mutation origins', async () => {
    for (const origin of [undefined, 'https://evil.example']) {
      const result = await app.inject({
        method: 'POST',
        url: '/api/v1/members',
        headers: { cookie: cookieA, ...(origin ? { origin } : {}) },
        payload: memberInput('CSRF'),
      });
      expect(result.statusCode).toBe(403);
    }
  });
  it('rejects wrong credentials', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: config.APP_URL },
      payload: { email: 'admin-a@example.test', password: 'incorrect-password' },
    });
    expect(response.statusCode).toBe(401);
  });
  it('stores a library-managed hash rather than the password', async () => {
    const [account] = await db.select().from(s.account).where(eq(s.account.userId, userA));
    expect(account?.password).toBeTruthy();
    expect(account?.password).not.toContain(password);
  });
  it('refuses a second bootstrap and keeps the original user count', async () => {
    await expect(
      bootstrap(db, config, {
        name: 'Other',
        email: 'other@example.test',
        password,
        organizationName: 'Other',
        slug: 'org-a',
      }),
    ).rejects.toThrow('existiert');
    expect(
      (await db.select().from(s.user).where(eq(s.user.email, 'other@example.test'))).length,
    ).toBe(0);
  });
});
describe('tenant boundaries', () => {
  it('only lists own memberships and excludes foreign search matches', async () => {
    const response = await app.inject({ url: '/api/v1/members', headers: headers(cookieA) });
    const page = response.json<Page<Member>>();
    expect(page.items.map((m) => m.id)).toContain(own.id);
    expect(page.items.map((m) => m.id)).not.toContain(foreign.id);
    const search = await app.inject({
      url: '/api/v1/members?search=B-001',
      headers: headers(cookieA),
    });
    expect(search.json<Page<Member>>().total).toBe(0);
  });
  it('returns 404 for a foreign membership read and update', async () => {
    expect(
      (await app.inject({ url: `/api/v1/members/${foreign.id}`, headers: headers(cookieA) }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/members/${foreign.id}`,
          headers: headers(cookieA),
          payload: { firstName: 'Hacked' },
        })
      ).statusCode,
    ).toBe(404);
    const [person] = await db.select().from(s.persons).where(eq(s.persons.id, foreign.personId));
    expect(person?.firstName).toBe('Anna');
  });
  it('rejects switching to another organization and invalid context headers', async () => {
    expect(
      (await app.inject({ url: '/api/v1/members', headers: headers(cookieA, orgB) })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: '/api/v1/members', headers: headers(cookieA, 'invalid') }))
        .statusCode,
    ).toBe(400);
  });
  it('protects organization details and changes', async () => {
    expect(
      (await app.inject({ url: `/api/v1/organizations/${orgB}`, headers: headers(cookieA) }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/organizations/${orgB}`,
          headers: headers(cookieA),
          payload: { name: 'Hacked' },
        })
      ).statusCode,
    ).toBe(404);
    const ownOrg = await app.inject({
      url: `/api/v1/organizations/${orgA}`,
      headers: headers(cookieA),
    });
    expect(ownOrg.statusCode, ownOrg.body).toBe(200);
  });
  it('refuses cross-organization board/person links', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/board-mandates',
      headers: headers(cookieA),
      payload: { personId: foreign.personId, position: 'President', startDate: '2026-01-01' },
    });
    expect(response.statusCode).toBe(404);
  });
  it('also enforces tenant relationships at database level', async () => {
    await expect(
      db.insert(s.memberships).values({
        organizationId: orgA,
        personId: foreign.personId,
        membershipNumber: 'X-TENANT',
        joinedAt: '2026-01-01',
      }),
    ).rejects.toThrow();
  });
  it('filters audits by tenant without personal field values', async () => {
    const response = await app.inject({
      url: '/api/v1/audit-logs?direction=desc',
      headers: headers(cookieA),
    });
    const logs = response.json<{ items: { organizationId: string; changeMetadata: unknown }[] }>()
      .items;
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((log) => log.organizationId === orgA)).toBe(true);
    expect(JSON.stringify(logs.map((log) => log.changeMetadata))).not.toContain('Anna');
    expect(JSON.stringify(logs)).not.toContain(password);
  });
});
describe('members and transactions', () => {
  it('paginates, sorts, searches and filters server-side', async () => {
    const response = await app.inject({
      url: '/api/v1/members?pageSize=1&status=active&search=A-001',
      headers: headers(cookieA),
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<Page<Member>>().items).toHaveLength(1);
    expect(response.json<Page<Member>>().total).toBe(1);
  });
  it('rejects invalid status transitions even on partial patches', async () => {
    for (const patch of [
      { status: 'resigned' },
      { endedAt: '2026-02-01' },
      { dateOfBirth: '2026-03-01' },
    ]) {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/members/${own.id}`,
        headers: headers(cookieA),
        payload: patch,
      });
      expect(response.statusCode, response.body).toBe(422);
    }
  });
  it('rolls back a duplicate membership including the new person', async () => {
    const before = await db.select().from(s.persons).where(eq(s.persons.organizationId, orgA));
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/members',
      headers: headers(cookieA),
      payload: memberInput('A-001'),
    });
    expect(response.statusCode, response.body).toBe(409);
    const after = await db.select().from(s.persons).where(eq(s.persons.organizationId, orgA));
    expect(after.length).toBe(before.length);
  });
  it('rejects extra fields and preserves tenant identity', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/members/${own.id}`,
      headers: headers(cookieA),
      payload: { organizationId: orgB },
    });
    expect(response.statusCode).toBe(422);
  });
  it('writes person, membership and audit together', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/members/${own.id}`,
      headers: headers(cookieA),
      payload: { phone: '+39 000 000', status: 'inactive' },
    });
    expect(response.statusCode, response.body).toBe(200);
    const member = response.json<Member>();
    expect(member.phone).toBe('+39 000 000');
    expect(member.status).toBe('inactive');
    expect(member.membershipNumber).toBe('A-001');
    const audits = await db
      .select()
      .from(s.auditLogs)
      .where(and(eq(s.auditLogs.entityId, own.id), eq(s.auditLogs.action, 'update')));
    expect(audits.at(-1)?.changeMetadata.fields).toContain('phone');
  });
});
describe('groups, board and roles', () => {
  it('creates a real group and prevents foreign group access/assignment', async () => {
    const result = await app.inject({
      method: 'POST',
      url: '/api/v1/groups',
      headers: headers(cookieA),
      payload: { name: 'Habitatpflege', description: 'Test' },
    });
    expect(result.statusCode, result.body).toBe(201);
    groupA = result.json<Group>();
    expect(
      (await app.inject({ url: `/api/v1/groups/${groupA.id}`, headers: headers(cookieB) }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/groups/${groupA.id}`,
          headers: headers(cookieB),
          payload: { name: 'Hacked' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/v1/groups/${groupA.id}/members`,
          headers: headers(cookieA),
          payload: { personIds: [foreign.personId] },
        })
      ).statusCode,
    ).toBe(404);
    const assigned = await app.inject({
      method: 'PUT',
      url: `/api/v1/groups/${groupA.id}/members`,
      headers: headers(cookieA),
      payload: { personIds: [own.personId] },
    });
    expect(assigned.statusCode, assigned.body).toBe(200);
  });
  it('allows normal members only limited organization data and own profile', async () => {
    for (const path of [
      '/api/v1/members',
      '/api/v1/users',
      '/api/v1/audit-logs',
      '/api/v1/dashboard',
      '/api/v1/dashboard/occasions',
      '/api/v1/reports/annual-overview?year=2026',
    ])
      expect((await app.inject({ url: path, headers: headers(memberCookie) })).statusCode).toBe(
        403,
      );
    const group = await app.inject({
      url: `/api/v1/groups/${groupA.id}`,
      headers: headers(memberCookie),
    });
    expect(group.json().members).toEqual([]);
    const profile = await app.inject({ url: '/api/v1/profile', headers: headers(memberCookie) });
    expect(profile.json().person.id).toBe(own.personId);
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/v1/profile',
      headers: headers(memberCookie),
      payload: { role: 'admin' },
    });
    expect(patch.statusCode).toBe(422);
  });
  it('lets treasurers read but not modify memberships', async () => {
    expect(
      (await app.inject({ url: '/api/v1/members', headers: headers(treasurerCookie) })).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/members/${own.id}`,
          headers: headers(treasurerCookie),
          payload: { firstName: 'Changed' },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('lets project leads manage group metadata without personal data', async () => {
    expect(
      (await app.inject({ url: '/api/v1/members', headers: headers(leadCookie) })).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/groups/${groupA.id}`,
          headers: headers(leadCookie),
          payload: { description: 'Updated' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/v1/groups/${groupA.id}/members`,
          headers: headers(leadCookie),
          payload: { personIds: [own.personId] },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('protects the last administrator and foreign role assignments', async () => {
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/users/${userA}/role`,
          headers: headers(cookieA),
          payload: { role: 'member' },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/users/${userA}/role`,
          headers: headers(cookieB),
          payload: { role: 'member' },
        })
      ).statusCode,
    ).toBe(404);
  });
  it('rejects cross-tenant user/person linking and rolls back the user', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: headers(cookieA),
      payload: {
        name: 'Bad link',
        email: 'bad-link@example.test',
        password,
        role: 'member',
        personId: foreign.personId,
      },
    });
    expect(response.statusCode).toBe(404);
    expect(
      (await db.select().from(s.user).where(eq(s.user.email, 'bad-link@example.test'))).length,
    ).toBe(0);
  });
  it('creates and updates a mandate and supplies live dashboard totals', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/board-mandates',
      headers: headers(cookieA),
      payload: { personId: own.personId, position: 'Vorsitz', startDate: '2026-01-01' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id;
    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/v1/board-mandates/${id}`,
      headers: headers(cookieA),
      payload: { endDate: '2026-12-31' },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/board-mandates/${id}`,
          headers: headers(cookieB),
          payload: { position: 'Hacked' },
        })
      ).statusCode,
    ).toBe(404);
    const dashboard = await app.inject({ url: '/api/v1/dashboard', headers: headers(cookieA) });
    expect(dashboard.statusCode, dashboard.body).toBe(200);
    expect(dashboard.json().totalMembers).toBe(1);
    expect(dashboard.json().activeGroups).toBe(1);
  });
  it('lists upcoming birthdays of own active members in the club time zone', async () => {
    const inDays = (n: number) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(
        new Date(Date.now() + n * 86_400_000),
      );
    const birthday = `1990${inDays(3).slice(4)}`;
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/members',
      headers: headers(cookieA),
      payload: { ...memberInput('A-BDAY'), dateOfBirth: birthday },
    });
    expect(created.statusCode, created.body).toBe(201);
    const celebrant = created.json<Member>();
    // Another club's member with the same birthday must not leak into this list.
    await db
      .update(s.persons)
      .set({ dateOfBirth: birthday })
      .where(eq(s.persons.id, foreign.personId));
    const response = await app.inject({
      url: '/api/v1/dashboard/occasions?days=10',
      headers: headers(cookieA),
    });
    expect(response.statusCode, response.body).toBe(200);
    const items = response.json().items as { personId: string; kind: string; date: string }[];
    expect(items.filter((i) => i.kind === 'birthday')).toEqual([
      expect.objectContaining({ personId: celebrant.personId, date: inDays(3), daysAway: 3 }),
    ]);
    expect(
      (await app.inject({ url: '/api/v1/dashboard/occasions?days=365', headers: headers(cookieA) }))
        .statusCode,
    ).toBe(422);
  });
  it('summarizes the year per month in the annual overview', async () => {
    const r = await app.inject({
      url: '/api/v1/reports/annual-overview?year=2026',
      headers: headers(cookieA),
    });
    expect(r.statusCode, r.body).toBe(200);
    const report = r.json<{
      members: { months: { month: number; joined: number; active: number }[] };
      events: { months: unknown[] } | null;
      volunteers: { months: { minutes: number }[] } | null;
    }>();
    expect(report.members.months.map((m) => m.month)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    const [members] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.memberships)
      .where(
        and(
          eq(s.memberships.organizationId, orgA),
          sql`${s.memberships.joinedAt} between '2026-01-01' and '2026-01-31'`,
        ),
      );
    expect(report.members.months[0]!.joined).toBe(members!.n);
    expect(report.events?.months).toHaveLength(12);
    expect(report.volunteers?.months).toHaveLength(12);
    expect(
      (
        await app.inject({
          url: '/api/v1/reports/annual-overview?year=99',
          headers: headers(cookieA),
        })
      ).statusCode,
    ).toBe(422);
  });
  it('invalidates a session on logout', async () => {
    const cookie = await login('admin-b@example.test');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/sign-out',
          headers: headers(cookie),
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect((await app.inject({ url: '/api/v1/me', headers: headers(cookie) })).statusCode).toBe(
      401,
    );
  });
});

describe('production and abuse controls', () => {
  it('refuses an administrative write queued before the caller was demoted', async () => {
    const [secondAdmin] = await db
      .insert(s.user)
      .values({ name: 'Concurrent administrator', email: 'concurrent-admin@example.test' })
      .returning();
    await db
      .insert(s.organizationUserRoles)
      .values({ organizationId: orgA, userId: secondAdmin!.id, role: 'admin' });
    const blocker = await pool.connect();
    let pending: Promise<Awaited<ReturnType<typeof app.inject>>> | undefined;
    try {
      await blocker.query('BEGIN');
      const {
        rows: [{ pid }],
      } = await blocker.query('select pg_backend_pid() pid');
      await blocker.query('select id from organizations where id=$1 for update', [orgA]);
      pending = Promise.resolve(
        app.inject({
          method: 'PATCH',
          url: `/api/v1/users/${userA}/role`,
          headers: headers(cookieA),
          payload: { role: 'admin' },
        }),
      );
      await expect
        .poll(
          async () =>
            (
              await pool.query(
                'select count(*)::int n from pg_stat_activity where $1=any(pg_blocking_pids(pid))',
                [pid],
              )
            ).rows[0].n,
          { timeout: 10_000 },
        )
        .toBeGreaterThan(0);
      await blocker.query(
        "update organization_user_roles set role='member' where organization_id=$1 and user_id=$2",
        [orgA, userA],
      );
      await blocker.query('COMMIT');
      expect((await pending).statusCode).toBe(403);
      const [row] = await db
        .select()
        .from(s.organizationUserRoles)
        .where(
          and(
            eq(s.organizationUserRoles.organizationId, orgA),
            eq(s.organizationUserRoles.userId, userA),
          ),
        );
      expect(row?.role).toBe('member');
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await pending;
      await db
        .update(s.organizationUserRoles)
        .set({ role: 'admin' })
        .where(
          and(
            eq(s.organizationUserRoles.organizationId, orgA),
            eq(s.organizationUserRoles.userId, userA),
          ),
        );
    }
  });
  it('sets Secure cookies in production without exposing development documentation', async () => {
    const production = await createApp(db, {
      ...config,
      NODE_ENV: 'production',
      APP_URL: 'https://verein.example.test',
    });
    try {
      const response = await production.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: { origin: 'https://verein.example.test' },
        payload: { email: 'admin-a@example.test', password },
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(String(response.headers['set-cookie'])).toMatch(/; Secure/i);
      expect(String(response.headers['set-cookie'])).toMatch(/HttpOnly/i);
      expect((await production.inject('/api/docs')).statusCode).toBe(404);
    } finally {
      await production.close();
    }
  });
  it('rate-limits repeated authentication failures', async () => {
    const statuses: number[] = [];
    for (let n = 0; n < 12; n++) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: { origin: config.APP_URL },
        payload: { email: 'missing@example.test', password: 'invalid-password-value' },
      });
      statuses.push(response.statusCode);
    }
    expect(statuses).toContain(429);
  });
});
