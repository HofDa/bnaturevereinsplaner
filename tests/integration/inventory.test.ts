import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';
import { createDatabase, schema as s } from '../../packages/db/src';
import { createApp } from '../../apps/api/src/app';
import { createAuth } from '../../apps/api/src/auth';
import { readConfig } from '../../apps/api/src/plugins/config';
import { bootstrap } from '../../apps/api/src/services/bootstrap';
import type { InventoryItem, InventoryLoan, Member, Page } from '../../packages/contracts/src';

const config = readConfig();
if (config.NODE_ENV !== 'test' || new URL(config.DATABASE_URL).pathname !== '/bnature_test')
  throw new Error('Dedicated test database required');
const { db, pool } = createDatabase(config.DATABASE_URL);
let app: Awaited<ReturnType<typeof createApp>>;
const password = 'Inventory-test-only-2026!';
const users: Record<string, { id: string; cookie: string }> = {};
let org = '',
  foreignOrg = '';
let lena: Member, guestId: string, foreignPersonId: string;
// Business dates follow the organization time zone (default Europe/Rome), not UTC.
const local = (offsetDays: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );
const past = (days: number) => local(-days);
const future = (days: number) => local(days);

function headers(role: string, key?: string, organization = org) {
  return {
    cookie: users[role]!.cookie,
    origin: config.APP_URL,
    'x-organization-id': role === 'foreign' ? foreignOrg : organization,
    ...(key ? { 'idempotency-key': key } : {}),
  };
}
const get = (path: string, role = 'admin') =>
  app.inject({ url: `/api/v1${path}`, headers: headers(role) });
const send = (
  method: 'POST' | 'PATCH',
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
const post = (path: string, payload: unknown, role = 'admin', key?: string) =>
  send('POST', path, payload, role, key);
async function ok<T>(response: Awaited<ReturnType<typeof get>>, status = 200): Promise<T> {
  expect(response.statusCode, response.body).toBe(status);
  return response.json<T>();
}
const createItem = (body: Record<string, unknown>, role = 'admin') =>
  post('/inventory/items', { name: 'Gegenstand', ...body }, role);
const lend = (body: Record<string, unknown>, role = 'admin', key?: string) =>
  post(
    '/inventory/loans',
    { personId: lena.personId, issuedOn: past(1), dueOn: future(7), ...body },
    role,
    key,
  );

beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/db/migrations' });
  await db.execute(sql`truncate table organizations, users cascade`);
  const root = await bootstrap(db, config, {
    name: 'Inventory Admin',
    email: 'inventory-admin@example.test',
    password,
    organizationName: 'Inventar',
    slug: 'inventory-root',
  });
  org = root.organizationId;
  const foreign = await bootstrap(db, config, {
    name: 'Foreign',
    email: 'inventory-foreign@example.test',
    password,
    organizationName: 'Fremd',
    slug: 'inventory-foreign',
  });
  foreignOrg = foreign.organizationId;
  users.admin = { id: root.userId, cookie: '' };
  users.foreign = { id: foreign.userId, cookie: '' };
  const provision = createAuth(db, config, true);
  for (const role of ['board', 'treasurer', 'project_lead', 'member'] as const) {
    const created = await provision.api.signUpEmail({
      body: { name: role, email: `inventory-${role}@example.test`, password },
    });
    users[role] = { id: created.user.id, cookie: '' };
    await db
      .insert(s.organizationUserRoles)
      .values({ organizationId: org, userId: created.user.id, role });
  }
  app = await createApp(db, config);
  await app.ready();
  for (const [role, user] of Object.entries(users)) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: config.APP_URL },
      payload: { email: `inventory-${role}@example.test`, password },
    });
    expect(response.statusCode, response.body).toBe(200);
    const cookie = response.headers['set-cookie'];
    user.cookie = (Array.isArray(cookie) ? cookie : [cookie])
      .filter(Boolean)
      .map((c) => c!.split(';')[0])
      .join('; ');
  }
  lena = await ok<Member>(
    await post('/members', {
      firstName: 'Lena',
      lastName: 'Leihweise',
      email: 'lena@example.test',
      membershipNumber: 'INV-1',
      joinedAt: '2020-01-01',
    }),
    201,
  );
  await db
    .insert(s.personUserLinks)
    .values({ organizationId: org, personId: lena.personId, userId: users.member!.id });
  const [guest] = await db
    .insert(s.persons)
    .values({ organizationId: org, firstName: 'Gast', lastName: 'Ohne Mitgliedschaft' })
    .returning();
  guestId = guest!.id;
  const [foreignPerson] = await db
    .insert(s.persons)
    .values({ organizationId: foreignOrg, firstName: 'Fremde', lastName: 'Person' })
    .returning();
  foreignPersonId = foreignPerson!.id;
});
afterAll(async () => {
  await app?.close();
  await pool.end();
});

describe('inventory items', () => {
  it('enforces role permissions and anonymous rejection', async () => {
    expect((await app.inject({ url: '/api/v1/inventory/items' })).statusCode).toBe(401);
    expect((await get('/inventory/items', 'member')).statusCode).toBe(403);
    expect((await get('/inventory/items', 'treasurer')).statusCode).toBe(200);
    expect((await createItem({ name: 'Nur lesen' }, 'treasurer')).statusCode).toBe(403);
    expect((await createItem({ name: 'Projektleitung' }, 'project_lead')).statusCode).toBe(403);
    await ok(await createItem({ name: 'Vorstand' }, 'board'), 201);
  });

  it('creates, searches, filters and keeps inventory numbers unique when set', async () => {
    const item = await ok<InventoryItem>(
      await createItem({
        inventoryNumber: 'INV-0001',
        name: 'Spektiv Swarovski',
        category: 'Optik',
        location: 'Vereinsraum Schrank 2',
        condition: 'good',
        valueCents: 89_900,
        purchasedOn: '2024-04-01',
      }),
      201,
    );
    expect(item).toMatchObject({ quantity: 1, availableQuantity: 1, lentQuantity: 0, version: 1 });
    expect((await createItem({ inventoryNumber: 'INV-0001', name: 'Doppelt' })).statusCode).toBe(
      409,
    );
    await ok(await createItem({ name: 'Ohne Nummer A' }), 201);
    await ok(await createItem({ name: 'Ohne Nummer B' }), 201);
    const found = await ok<Page<InventoryItem>>(await get('/inventory/items?search=spektiv'));
    expect(found.items.map((i) => i.id)).toEqual([item.id]);
    const optics = await ok<Page<InventoryItem>>(await get('/inventory/items?category=Optik'));
    expect(optics.total).toBe(1);
    expect((await get('/inventory/items?search=%25')).json<Page<InventoryItem>>().total).toBe(0);
  });

  it('rejects invalid input and stale versions', async () => {
    expect((await createItem({ quantity: 0 })).statusCode).toBe(422);
    expect((await createItem({ name: '   ' })).statusCode).toBe(422);
    expect((await createItem({ unknown: true })).statusCode).toBe(422);
    const item = await ok<InventoryItem>(await createItem({ name: 'Leiter' }), 201);
    const updated = await ok<InventoryItem>(
      await send('PATCH', `/inventory/items/${item.id}`, { version: 1, location: 'Garage' }),
    );
    expect(updated).toMatchObject({ location: 'Garage', version: 2, name: 'Leiter' });
    expect(
      (await send('PATCH', `/inventory/items/${item.id}`, { version: 1, location: 'Alt' }))
        .statusCode,
    ).toBe(409);
  });
});

describe('inventory loans', () => {
  it('lends batches up to the available quantity and returns them', async () => {
    const vests = await ok<InventoryItem>(
      await createItem({ name: 'Warnwesten', quantity: 10, category: 'Sicherheit' }),
      201,
    );
    const first = await ok<InventoryLoan>(await lend({ itemId: vests.id, quantity: 6 }), 201);
    expect(first).toMatchObject({
      itemName: 'Warnwesten',
      borrowerName: 'Lena Leihweise',
      borrowerIsMember: true,
      issueCondition: 'good',
      overdue: false,
      returnedOn: null,
    });
    const tooMany = await lend({ itemId: vests.id, quantity: 5 });
    expect(tooMany.statusCode).toBe(409);
    expect(tooMany.json().error.code).toBe('INVENTORY_NOT_AVAILABLE');
    await ok(await lend({ itemId: vests.id, quantity: 4, personId: guestId }, 'project_lead'), 201);
    expect(await ok<InventoryItem>(await get(`/inventory/items/${vests.id}`))).toMatchObject({
      lentQuantity: 10,
      availableQuantity: 0,
    });
    const lower = await send('PATCH', `/inventory/items/${vests.id}`, {
      version: 1,
      quantity: 9,
    });
    expect(lower.json().error.code).toBe('INVENTORY_QUANTITY_LENT');
    const returned = await ok<InventoryLoan>(
      await post(`/inventory/loans/${first.id}/return`, {
        version: 1,
        returnedOn: past(0),
        returnCondition: 'worn',
        returnNotes: 'Eine Weste verschmutzt',
      }),
    );
    expect(returned).toMatchObject({ returnCondition: 'worn', version: 2 });
    // Batch condition stays; damage is documented in the return notes.
    expect(await ok<InventoryItem>(await get(`/inventory/items/${vests.id}`))).toMatchObject({
      condition: 'good',
      availableQuantity: 6,
    });
    const again = await post(`/inventory/loans/${first.id}/return`, {
      version: 2,
      returnedOn: past(0),
      returnCondition: 'good',
    });
    expect(again.json().error.code).toBe('INVENTORY_RETURNED');
  });

  it('allows only one of two concurrent loans for the last piece', async () => {
    const camera = await ok<InventoryItem>(await createItem({ name: 'Wildkamera' }), 201);
    const results = await Promise.all([
      lend({ itemId: camera.id }),
      lend({ itemId: camera.id, personId: guestId }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const loans = await db
      .select()
      .from(s.inventoryLoans)
      .where(eq(s.inventoryLoans.itemId, camera.id));
    expect(loans).toHaveLength(1);
  });

  it('carries the return condition of single items and validates return dates', async () => {
    const drill = await ok<InventoryItem>(await createItem({ name: 'Akkubohrer' }), 201);
    const loan = await ok<InventoryLoan>(
      await lend({ itemId: drill.id, issuedOn: past(3), dueOn: past(1) }),
      201,
    );
    expect(loan).toMatchObject({ overdue: true, daysOverdue: 1 });
    const overdue = await ok<Page<InventoryLoan>>(await get('/inventory/loans?state=overdue'));
    expect(overdue.items.map((l) => l.id)).toContain(loan.id);
    expect(
      (await ok<Page<InventoryItem>>(await get('/inventory/items?availability=overdue'))).items.map(
        (i) => i.id,
      ),
    ).toContain(drill.id);
    const early = await post(`/inventory/loans/${loan.id}/return`, {
      version: 1,
      returnedOn: past(5),
      returnCondition: 'good',
    });
    expect(early.statusCode).toBe(422);
    const later = await post(`/inventory/loans/${loan.id}/return`, {
      version: 1,
      returnedOn: future(2),
      returnCondition: 'good',
    });
    expect(later.statusCode).toBe(422);
    await ok(
      await post(`/inventory/loans/${loan.id}/return`, {
        version: 1,
        returnedOn: past(0),
        returnCondition: 'defective',
      }),
    );
    expect(await ok<InventoryItem>(await get(`/inventory/items/${drill.id}`))).toMatchObject({
      condition: 'defective',
      version: 2,
    });
  });

  it('extends due dates with version checks', async () => {
    const tent = await ok<InventoryItem>(await createItem({ name: 'Zelt' }), 201);
    const loan = await ok<InventoryLoan>(await lend({ itemId: tent.id }), 201);
    const extended = await ok<InventoryLoan>(
      await post(`/inventory/loans/${loan.id}/extend`, { version: 1, dueOn: future(30) }),
    );
    expect(extended).toMatchObject({ dueOn: future(30), version: 2 });
    expect(
      (await post(`/inventory/loans/${loan.id}/extend`, { version: 1, dueOn: future(40) }))
        .statusCode,
    ).toBe(409);
    expect(
      (await post(`/inventory/loans/${loan.id}/extend`, { version: 2, dueOn: past(10) }))
        .statusCode,
    ).toBe(422);
  });

  it('retires items only without open loans and blocks lending afterwards', async () => {
    const saw = await ok<InventoryItem>(await createItem({ name: 'Motorsäge' }), 201);
    const loan = await ok<InventoryLoan>(await lend({ itemId: saw.id }), 201);
    const blocked = await post(`/inventory/items/${saw.id}/retire`, {
      version: 1,
      retiredOn: past(0),
      reason: 'Kette gerissen',
    });
    expect(blocked.json().error.code).toBe('INVENTORY_OPEN_LOANS');
    await ok(
      await post(`/inventory/loans/${loan.id}/return`, {
        version: 1,
        returnedOn: past(0),
        returnCondition: 'damaged',
      }),
    );
    const retired = await ok<InventoryItem>(
      await post(`/inventory/items/${saw.id}/retire`, {
        version: 2,
        retiredOn: past(0),
        reason: 'Kette gerissen',
      }),
    );
    expect(retired).toMatchObject({ status: 'retired', retiredReason: 'Kette gerissen' });
    expect((await lend({ itemId: saw.id })).json().error.code).toBe('INVENTORY_RETIRED');
    expect(
      (await send('PATCH', `/inventory/items/${saw.id}`, { version: 3, name: 'X' })).statusCode,
    ).toBe(409);
    const active = await ok<Page<InventoryItem>>(await get('/inventory/items?search=Motors'));
    expect(active.total).toBe(0);
    const all = await ok<Page<InventoryItem>>(
      await get('/inventory/items?search=Motors&status=all'),
    );
    expect(all.total).toBe(1);
  });

  it('replays idempotent requests and rejects reused keys with other data', async () => {
    const rope = await ok<InventoryItem>(await createItem({ name: 'Seil', quantity: 3 }), 201);
    const key = crypto.randomUUID();
    const a = await lend({ itemId: rope.id }, 'admin', key);
    const b = await lend({ itemId: rope.id }, 'admin', key);
    expect(a.statusCode).toBe(201);
    expect(b.headers['idempotency-replayed']).toBe('true');
    expect(b.json().id).toBe(a.json().id);
    expect((await lend({ itemId: rope.id, quantity: 2 }, 'admin', key)).statusCode).toBe(409);
    expect((await ok<InventoryItem>(await get(`/inventory/items/${rope.id}`))).lentQuantity).toBe(
      1,
    );
  });

  it('isolates organizations', async () => {
    const lamp = await ok<InventoryItem>(await createItem({ name: 'Stirnlampe' }), 201);
    const loan = await ok<InventoryLoan>(await lend({ itemId: lamp.id }), 201);
    expect((await get(`/inventory/items/${lamp.id}`, 'foreign')).statusCode).toBe(404);
    expect((await get(`/inventory/loans/${loan.id}`, 'foreign')).statusCode).toBe(404);
    expect(
      (await ok<Page<InventoryItem>>(await get('/inventory/items?status=all', 'foreign'))).total,
    ).toBe(0);
    expect((await lend({ itemId: lamp.id, personId: foreignPersonId })).statusCode).toBe(404);
    expect(
      (
        await post(
          '/inventory/loans',
          { itemId: lamp.id, personId: foreignPersonId, issuedOn: past(0), dueOn: future(1) },
          'foreign',
        )
      ).statusCode,
    ).toBe(404);
  });

  it('lists borrowers with membership status and minimal data', async () => {
    const people = await ok<{ items: Record<string, unknown>[] }>(
      await get('/inventory/people', 'project_lead'),
    );
    expect(people.items.find((p) => p.id === lena.personId)).toEqual({
      id: lena.personId,
      name: 'Leihweise Lena',
      isMember: true,
    });
    expect(people.items.find((p) => p.id === guestId)).toMatchObject({ isMember: false });
    expect(people.items.some((p) => p.id === foreignPersonId)).toBe(false);
    expect((await get('/inventory/people', 'treasurer')).statusCode).toBe(403);
  });

  it('shows members only their own loans', async () => {
    const book = await ok<InventoryItem>(await createItem({ name: 'Bestimmungsbuch' }), 201);
    await ok(await lend({ itemId: book.id }), 201);
    const own = await ok<Page<InventoryLoan>>(await get('/inventory/my-loans', 'member'));
    expect(own.items.length).toBeGreaterThan(0);
    expect(own.items.every((l) => l.personId === lena.personId)).toBe(true);
    // Filters for other persons are ignored on the personal endpoint.
    const forced = await ok<Page<InventoryLoan>>(
      await get(`/inventory/my-loans?personId=${guestId}`, 'member'),
    );
    expect(forced.items.every((l) => l.personId === lena.personId)).toBe(true);
    const unlinked = await ok<Page<InventoryLoan>>(await get('/inventory/my-loans', 'treasurer'));
    expect(unlinked.total).toBe(0);
    expect((await get('/inventory/loans', 'member')).statusCode).toBe(403);
  });

  it('enforces the rules in the database for direct SQL changes', async () => {
    const [item] = await db
      .insert(s.inventoryItems)
      .values({ organizationId: org, name: 'SQL-Test', quantity: 1, createdBy: users.admin!.id })
      .returning();
    const loan = {
      organizationId: org,
      itemId: item!.id,
      personId: lena.personId,
      issuedOn: past(0),
      dueOn: future(1),
      issueCondition: 'good' as const,
      createdBy: users.admin!.id,
    };
    await db.insert(s.inventoryLoans).values(loan);
    await expect(db.insert(s.inventoryLoans).values(loan)).rejects.toThrow();
    await expect(
      db
        .update(s.inventoryItems)
        .set({ quantity: 0, version: 2 })
        .where(eq(s.inventoryItems.id, item!.id)),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`delete from inventory_items where id=${item!.id}`),
    ).rejects.toThrow();
    const [open] = await db
      .select()
      .from(s.inventoryLoans)
      .where(eq(s.inventoryLoans.itemId, item!.id));
    await expect(
      db
        .update(s.inventoryLoans)
        .set({ quantity: 2, version: 2 })
        .where(eq(s.inventoryLoans.id, open!.id)),
    ).rejects.toThrow();
    await db
      .update(s.inventoryLoans)
      .set({
        returnedOn: past(0),
        returnCondition: 'good',
        returnedBy: users.admin!.id,
        version: 2,
      })
      .where(eq(s.inventoryLoans.id, open!.id));
    await expect(
      db
        .update(s.inventoryLoans)
        .set({ dueOn: future(9), version: 3 })
        .where(eq(s.inventoryLoans.id, open!.id)),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`delete from inventory_loans where id=${open!.id}`),
    ).rejects.toThrow();
  });

  it('exports CSV with neutralized formulas and reports a summary', async () => {
    await ok(
      await createItem({
        name: '=HYPERLINK("x")',
        category: 'Test',
        valueCents: 1250,
        quantity: 2,
      }),
      201,
    );
    const csv = await app.inject({
      url: '/api/v1/inventory/items/export?language=it',
      headers: headers('treasurer'),
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.startsWith('﻿"Numero inventario"')).toBe(true);
    expect(csv.body).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv.body).toContain('"12,50"');
    const summary = await ok<{ items: number; overdueLoans: number; categories: string[] }>(
      await get('/inventory/summary', 'treasurer'),
    );
    expect(summary.items).toBeGreaterThan(0);
    expect(summary.categories).toContain('Optik');
    expect((await get('/inventory/summary', 'member')).statusCode).toBe(403);
  });
});
