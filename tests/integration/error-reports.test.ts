import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { createDatabase, schema as s } from '../../packages/db/src';
import { createApp } from '../../apps/api/src/app';
import { createAuth } from '../../apps/api/src/auth';
import { bootstrap } from '../../apps/api/src/services/bootstrap';
import { readConfig } from '../../apps/api/src/plugins/config';
import {
  MAX_REPORTS,
  fingerprint,
  frames,
  recordError,
  scrub,
  type ErrorAlert,
} from '../../apps/api/src/services/error-reports';
import type { ErrorReport } from '../../packages/contracts/src';

const config = { ...readConfig(), EMAIL_MODE: 'disabled' as const };
if (config.NODE_ENV !== 'test' || new URL(config.DATABASE_URL).pathname !== '/bnature_test')
  throw new Error('Dedicated test database required');
const { db, pool } = createDatabase(config.DATABASE_URL);
const password = 'Error-report-test-only-password-2026!';
const alerts: Parameters<ErrorAlert>[0][] = [];
const alert: ErrorAlert = async (report) => {
  alerts.push(report);
};
let app: Awaited<ReturnType<typeof createApp>>;
let org = '';
const cookies: Record<string, string> = {};
const headers = (role?: string) => ({
  origin: config.APP_URL,
  'user-agent': 'TestBrowser/1.0',
  ...(role ? { cookie: cookies[role]!, 'x-organization-id': org } : {}),
});
const report = (payload: Record<string, unknown>, role?: string) =>
  app.inject({ method: 'POST', url: '/api/v1/client-errors', headers: headers(role), payload });
const list = async (role = 'admin') => {
  const res = await app.inject({ url: '/api/v1/error-reports', headers: headers(role) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ items: ErrorReport[] }>().items;
};
const chromeStack = (line: number) =>
  [
    "TypeError: Cannot read properties of undefined (reading 'name')",
    `    at MemberRow (https://verein.example.org/assets/members-AbCd1234.js:1:${line})`,
    '    at renderWithHooks (https://verein.example.org/assets/vendor-ZyXw9876.js:9:100)',
  ].join('\n');

beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/db/migrations' });
  await db.execute(sql`truncate table organizations, users cascade`);
  const root = await bootstrap(db, config, {
    name: 'Error Admin',
    email: 'errors-admin@example.test',
    password,
    organizationName: 'Errors',
    slug: 'errors-root',
  });
  org = root.organizationId;
  const member = await createAuth(db, config, true).api.signUpEmail({
    body: { name: 'member', email: 'errors-member@example.test', password },
  });
  await db
    .insert(s.organizationUserRoles)
    .values({ organizationId: org, userId: member.user.id, role: 'member' });
  app = await createApp(db, config, null, alert);
  // Stands in for a bug: an unexpected exception inside a request handler.
  app.get('/api/v1/test-failure/:id', () => {
    throw new TypeError('Cannot load "anna@example.org" for 4711');
  });
  await app.ready();
  for (const role of ['admin', 'member']) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: config.APP_URL },
      payload: { email: `errors-${role}@example.test`, password },
    });
    expect(res.statusCode, res.body).toBe(200);
    const set = res.headers['set-cookie'];
    cookies[role] = (Array.isArray(set) ? set : [set])
      .filter(Boolean)
      .map((c) => c!.split(';')[0])
      .join('; ');
  }
});
beforeEach(async () => {
  alerts.length = 0;
  await db.delete(s.errorReports);
});
afterAll(async () => {
  await db.delete(s.errorReports);
  await app.close();
  await pool.end();
});

describe('error reports', () => {
  it('masks personal data and keeps only stack frames', () => {
    expect(scrub('User anna@example.org with id 3f2b8c1e-1111-4222-8333-444455556666')).toBe(
      'User <email> with id <id>',
    );
    expect(scrub('Invalid value "Anna Muster" at row 12345')).toBe(
      'Invalid value <value> at row <n>',
    );
    expect(frames(chromeStack(42))).toEqual([
      'at MemberRow (/assets/members.js:1:42)',
      'at renderWithHooks (/assets/vendor.js:9:100)',
    ]);
    expect(frames('fn@https://verein.example.org/assets/a-AbCd1234.js?v=1:2:3')).toEqual([
      'fn@/assets/a.js:2:3',
    ]);
    // The same bug in another build, at another line, is still the same problem.
    const one = { source: 'web' as const, name: 'TypeError', message: 'x', stack: chromeStack(42) };
    expect(fingerprint(one)).toBe(fingerprint({ ...one, stack: chromeStack(977) }));
    expect(fingerprint(one)).not.toBe(fingerprint({ ...one, name: 'RangeError' }));
    expect(fingerprint(one)).not.toBe(fingerprint({ ...one, source: 'api' }));
  });
  it('accepts browser reports without a session, counts repeats and alerts once', async () => {
    const payload = {
      kind: 'render',
      name: 'TypeError',
      message: "Cannot read properties of undefined (reading 'name') for anna@example.org",
      stack: chromeStack(42),
      path: '/members/3f2b8c1e-1111-4222-8333-444455556666?search=Anna#x',
      release: '2026-11-16T10:00',
    };
    expect((await report(payload)).statusCode).toBe(204);
    expect((await report({ ...payload, stack: chromeStack(500) }, 'member')).statusCode).toBe(204);
    const [row, ...rest] = await list();
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({
      source: 'web',
      name: 'TypeError',
      occurrences: 2,
      location: 'render /members/3f2b8c1e-1111-4222-8333-444455556666',
      release: '2026-11-16T10:00',
      userAgent: 'TestBrowser/1.0',
    });
    expect(JSON.stringify(row)).not.toContain('anna@example.org');
    expect(JSON.stringify(row)).not.toContain('search=Anna');
    expect(row!.stack).toContain('at MemberRow (/assets/members.js');
    await vi.waitFor(() => expect(alerts).toHaveLength(1));
  });
  it('rejects oversized or malformed reports and unknown fields', async () => {
    for (const bad of [
      { kind: 'other', name: 'E' },
      { kind: 'error', message: 'x'.repeat(501) },
      { kind: 'error', stack: 'x'.repeat(4001) },
      { kind: 'error', cookies: 'session=1' },
      {},
    ])
      expect((await report(bad)).statusCode, JSON.stringify(bad).slice(0, 60)).toBe(422);
    expect(await list()).toHaveLength(0);
  });
  it('records unexpected server failures with the route pattern, not the request', async () => {
    const fail = () =>
      app.inject({
        url: '/api/v1/test-failure/3f2b8c1e-1111-4222-8333-444455556666?token=secret',
        headers: headers('admin'),
      });
    const res = await fail();
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('anna@example.org');
    await fail();
    let rows: ErrorReport[] = [];
    await vi.waitFor(async () => {
      rows = await list();
      expect(rows[0]?.occurrences).toBe(2);
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: 'api',
      name: 'TypeError',
      message: 'Cannot load <value> for <n>',
      location: 'GET /api/v1/test-failure/:id',
    });
    expect(JSON.stringify(rows[0])).not.toMatch(/secret|anna@example\.org|3f2b8c1e/);
    expect(rows[0]!.stack).toContain('(/tests/integration/error-reports.test.ts:');
    expect(rows[0]!.stack).not.toContain(process.cwd());
    expect(alerts).toHaveLength(1);
    // Expected refusals are not failures.
    await app.inject({ url: '/api/v1/error-reports' });
    await app.inject({ url: '/api/v1/nowhere', headers: headers('admin') });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await list()).toHaveLength(1);
  });
  it('shows reports only to administrators and lets them dismiss', async () => {
    await report({ kind: 'error', name: 'RangeError', message: 'boom' });
    const forbidden = await app.inject({
      url: '/api/v1/error-reports',
      headers: headers('member'),
    });
    expect(forbidden.statusCode).toBe(403);
    expect((await app.inject({ url: '/api/v1/error-reports' })).statusCode).toBe(401);
    const [row] = await list();
    const dismiss = (role: string, id = row!.id) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/error-reports/${id}/dismiss`,
        headers: headers(role),
      });
    expect((await dismiss('member')).statusCode).toBe(403);
    expect((await dismiss('admin')).statusCode).toBe(204);
    expect((await dismiss('admin')).statusCode).toBe(404);
    expect(await list()).toHaveLength(0);
    // The same problem coming back is new again.
    await report({ kind: 'error', name: 'RangeError', message: 'boom' });
    expect((await list())[0]!.occurrences).toBe(1);
  });
  it('stops storing new problems at the cap and never throws', async () => {
    await db.insert(s.errorReports).values(
      Array.from({ length: MAX_REPORTS }, (_, i) => ({
        source: 'web' as const,
        fingerprint: `filler-${i}`,
        name: 'Filler',
        message: '',
      })),
    );
    expect(await recordError(db, { source: 'web', name: 'New', message: 'one more' })).toBeNull();
    const known = await recordError(db, { source: 'web', name: 'Again', message: 'x' });
    expect(known).toBeNull();
    const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(s.errorReports);
    expect(count!.n).toBe(MAX_REPORTS);
    const broken = {
      update: () => {
        throw new Error('database down');
      },
    } as unknown as typeof db;
    expect(await recordError(broken, { source: 'api', name: 'E', message: 'm' })).toBeNull();
  });
});
