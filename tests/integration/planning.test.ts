import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { createDatabase, schema as s } from '../../packages/db/src';
import { createApp } from '../../apps/api/src/app';
import { createAuth } from '../../apps/api/src/auth';
import { readConfig } from '../../apps/api/src/plugins/config';
import { bootstrap } from '../../apps/api/src/services/bootstrap';
import type { CostPlan, CostPlanInput } from '../../packages/contracts/src';

const config = readConfig();
if (config.NODE_ENV !== 'test' || new URL(config.DATABASE_URL).pathname !== '/bnature_test')
  throw new Error('Dedicated test database required');
const { db, pool } = createDatabase(config.DATABASE_URL);
let app: Awaited<ReturnType<typeof createApp>>;
const password = 'Planning-test-only-2026!';
const users: Record<string, { cookie: string; org: string }> = {};
const column = crypto.randomUUID();
const input: CostPlanInput = {
  name: 'Heckenpflege',
  description: 'Projekt 2026',
  columns: [{ id: column, label: 'Lieferant' }],
  rows: [
    {
      id: crypto.randomUUID(),
      description: '=1+1',
      category: 'Material',
      quantity: 1.255,
      unit: 'kg',
      unitCostCents: 100,
      actualCents: 200,
      notes: 'Südtirol',
      custom: { [column]: 'Gärtnerei' },
    },
  ],
};
const headers = (role = 'admin', key?: string) => ({
  cookie: users[role]!.cookie,
  origin: config.APP_URL,
  'x-organization-id': users[role]!.org,
  ...(key ? { 'idempotency-key': key } : {}),
});
const get = (path = '', role = 'admin') =>
  app.inject({ url: `/api/v1/planning/costs${path}`, headers: headers(role) });
const write = (path: string, payload: unknown, role = 'admin', key = crypto.randomUUID()) =>
  app.inject({
    method: path ? 'PUT' : 'POST',
    url: `/api/v1/planning/costs${path}`,
    headers: headers(role, key),
    payload: payload as Record<string, unknown>,
  });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/db/migrations' });
  await db.execute(sql`truncate table organizations, users cascade`);
  for (const role of ['admin', 'foreign']) {
    const root = await bootstrap(db, config, {
      name: role,
      email: `planning-${role}@example.test`,
      password,
      organizationName: role,
      slug: `planning-${role}`,
    });
    users[role] = { cookie: '', org: root.organizationId };
  }
  const provision = createAuth(db, config, true);
  for (const role of ['board', 'treasurer', 'project_lead', 'member'] as const) {
    const created = await provision.api.signUpEmail({
      body: { name: role, email: `planning-${role}@example.test`, password },
    });
    await db
      .insert(s.organizationUserRoles)
      .values({ organizationId: users.admin!.org, userId: created.user.id, role });
    users[role] = { cookie: '', org: users.admin!.org };
  }
  app = await createApp(db, config);
  await app.ready();
  for (const [role, user] of Object.entries(users)) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: config.APP_URL },
      payload: { email: `planning-${role}@example.test`, password },
    });
    expect(response.statusCode, response.body).toBe(200);
    const cookie = response.headers['set-cookie'];
    user.cookie = (Array.isArray(cookie) ? cookie : [cookie])
      .filter(Boolean)
      .map((c) => c!.split(';')[0])
      .join('; ');
  }
});
afterAll(async () => {
  await app?.close();
  await pool.end();
});

describe('project cost plans', () => {
  it('requires authentication and organizer permissions', async () => {
    expect((await app.inject({ url: '/api/v1/planning/costs' })).statusCode).toBe(401);
    expect((await get('', 'member')).statusCode).toBe(403);
    expect((await write('', input, 'member')).statusCode).toBe(403);
    for (const role of ['board', 'treasurer', 'project_lead']) {
      const response = await write('', { ...input, name: role }, role);
      expect(response.statusCode, response.body).toBe(201);
      expect((await get('', role)).statusCode).toBe(200);
    }
  });
  it('persists custom columns, order and edits while rejecting stale versions and replaying retries', async () => {
    const key = crypto.randomUUID();
    const response = await write('', input, 'project_lead', key);
    expect(response.statusCode, response.body).toBe(201);
    const plan = response.json<CostPlan>();
    expect(plan).toMatchObject({ ...input, version: 1 });
    const retried = await write('', input, 'project_lead', key);
    expect(retried.json().id).toBe(plan.id);
    expect(retried.headers['idempotency-replayed']).toBe('true');
    expect((await write('', { ...input, name: 'Changed' }, 'project_lead', key)).statusCode).toBe(
      409,
    );
    const changed = {
      ...input,
      name: 'Neuer Plan',
      version: 1,
      rows: [
        ...input.rows,
        { ...input.rows[0]!, id: crypto.randomUUID(), description: 'Zweite Position' },
      ],
    };
    const saved = await write(`/${plan.id}`, changed, 'treasurer');
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ name: changed.name, version: 2, rows: changed.rows });
    expect((await get(`/${plan.id}`, 'board')).json().rows).toEqual(changed.rows);
    const conflict = await write(`/${plan.id}`, changed);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('STALE_VERSION');
  });
  it('isolates organizations for reads, updates and both exports', async () => {
    const plan = (await write('', input)).json<CostPlan>();
    expect((await get('', 'foreign')).json().items).toEqual([]);
    expect((await get(`/${plan.id}`, 'foreign')).statusCode).toBe(404);
    expect((await write(`/${plan.id}`, { ...input, version: 1 }, 'foreign')).statusCode).toBe(404);
    for (const format of ['csv', 'xlsx']) {
      expect((await get(`/${plan.id}/export?format=${format}`, 'foreign')).statusCode).toBe(404);
      expect((await get(`/${plan.id}/export?format=${format}`, 'member')).statusCode).toBe(403);
    }
  });
  it('validates custom field references and exports the saved plan in both formats', async () => {
    expect((await write('', { ...input, columns: [] })).statusCode).toBe(422);
    expect(
      (await write('', { ...input, rows: [{ ...input.rows[0], actualCents: -1 }] })).statusCode,
    ).toBe(422);
    const response = await write('', input);
    expect(response.statusCode, response.body).toBe(201);
    const plan = response.json<CostPlan>();
    const csv = await get(`/${plan.id}/export?format=csv&language=it`);
    expect(csv.statusCode, csv.body).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('"Progetto";"Heckenpflege"');
    expect(csv.body).toContain('"\'=1+1"');
    expect(csv.body).toContain('"1,26"');
    const xlsx = await get(`/${plan.id}/export?format=xlsx`);
    expect(xlsx.statusCode, xlsx.body).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(xlsx.headers['content-disposition']).toContain('.xlsx');
    expect(xlsx.rawPayload.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect((await get(`/${plan.id}/export?format=invalid`)).statusCode).toBe(422);
  });
});
