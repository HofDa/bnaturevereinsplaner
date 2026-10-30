import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { createDatabase } from '../../packages/db/src';
import { createApp } from '../../apps/api/src/app';
import { readConfig } from '../../apps/api/src/plugins/config';
import { bootstrap } from '../../apps/api/src/services/bootstrap';
import {
  encodeDocumentMetadata,
  type FinanceAccount,
  type CashbookCategory,
  type CashbookEntry,
  type AnnualReport,
  type LedgerTransfer,
  type Payment,
  type EtsReport,
  type FinanceDashboard,
  type DocumentDetail,
} from '../../packages/contracts/src';
const config = readConfig();
if (config.NODE_ENV !== 'test' || !new URL(config.DATABASE_URL).pathname.endsWith('/bnature_test'))
  throw new Error('Dedicated test database required');
const { db, pool } = createDatabase(config.DATABASE_URL),
  app = await createApp(db, config);
const password = 'Sprint22-integration-only-2026!';
let admin = '',
  member = '',
  board = '',
  foreign = '',
  org = '',
  bank: FinanceAccount,
  cash: FinanceAccount,
  donation: CashbookCategory,
  expense: CashbookCategory;
const headers = (cookie = admin, key?: string) => ({
  cookie,
  origin: config.APP_URL,
  ...(key ? { 'idempotency-key': key } : {}),
});
const get = (path: string, cookie = admin) =>
  app.inject({ url: `/api/v1${path}`, headers: headers(cookie) });
const post = (path: string, payload: unknown, cookie = admin, key = crypto.randomUUID()) =>
  app.inject({
    method: 'POST',
    url: `/api/v1${path}`,
    headers: headers(cookie, key),
    payload: payload as Record<string, unknown>,
  });
async function ok<T>(r: Awaited<ReturnType<typeof get>>, code = 200) {
  expect(r.statusCode, r.body).toBe(code);
  return r.json<T>();
}
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
    .map((c) => c!.split(';')[0])
    .join('; ');
}
const report = () =>
  get('/finance/reports/annual?fiscalYear=2026').then((r) => ok<AnnualReport>(r));
const entry = (patch: Record<string, unknown> = {}) => ({
  accountId: bank.id,
  categoryId: donation.id,
  amountCents: 3000,
  bookingDate: '2026-05-01',
  documentDate: '2026-05-01',
  description: 'Spende Umweltprojekt',
  project: 'Waldpflege',
  ...patch,
});
beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/db/migrations' });
  await db.execute(sql`truncate table organizations,users cascade`);
  const result = await bootstrap(db, config, {
    name: 'Sprint22 Admin',
    email: 's22-admin@example.test',
    password,
    organizationName: 'Sprint22',
    slug: 's22',
  });
  org = result.organizationId;
  await bootstrap(db, config, {
    name: 'Foreign',
    email: 's22-foreign@example.test',
    password,
    organizationName: 'Foreign',
    slug: 's22-foreign',
  });
  await app.ready();
  admin = await login('s22-admin@example.test');
  foreign = await login('s22-foreign@example.test');
  for (const role of ['member', 'board'] as const) {
    await ok(
      await post('/users', { name: role, email: `s22-${role}@example.test`, password, role }),
      201,
    );
    if (role === 'member') member = await login(`s22-${role}@example.test`);
    else board = await login(`s22-${role}@example.test`);
  }
  await ok(await post('/finance/initialize', { language: 'de' }));
  const accounts = await ok<{ items: FinanceAccount[] }>(await get('/finance/accounts'));
  bank = accounts.items.find((a) => a.kind === 'bank')!;
  cash = accounts.items.find((a) => a.kind === 'cash')!;
  const categories = await ok<{ items: CashbookCategory[] }>(await get('/finance/categories'));
  donation = categories.items.find((c) => c.classification === 'donation')!;
  expense = categories.items.find((c) => c.name === 'Verwaltung')!;
  await ok(
    await post('/finance/fiscal-years', {
      year: 2026,
      startsOn: '2026-04-01',
      endsOn: '2027-03-31',
      openingBalances: [{ accountId: bank.id, amountCents: 20000 }],
    }),
    201,
  );
});
afterAll(async () => {
  await app.close();
  await pool.end();
});
describe('Sprint 2.2 monetary invariants', () => {
  it('initializes categories idempotently and does not reinterpret prior entries', async () => {
    const before = await ok<{ items: CashbookCategory[] }>(await get('/finance/categories'));
    expect(before.items).toHaveLength(15);
    const key = crypto.randomUUID();
    await ok(await post('/finance/initialize', { language: 'de' }, admin, key));
    const replay = await post('/finance/initialize', { language: 'de' }, admin, key);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(
      (await ok<{ items: CashbookCategory[] }>(await get('/finance/categories'))).items,
    ).toHaveLength(15);
  });
  it('derives income/expense balances and keeps internal transfers neutral under concurrent retries', async () => {
    await ok(await post('/finance/cashbook', entry()), 201);
    await ok(
      await post('/finance/cashbook', entry({ categoryId: expense.id, amountCents: 500 })),
      201,
    );
    const before = await report(),
      key = crypto.randomUUID(),
      payload = {
        fromAccountId: bank.id,
        toAccountId: cash.id,
        amountCents: 4000,
        bookingDate: '2026-05-02',
        description: 'Bank zur Barkasse',
      };
    const responses = await Promise.all([
      post('/finance/transfers', payload, admin, key),
      post('/finance/transfers', payload, admin, key),
    ]);
    const transfers = await Promise.all(responses.map((r) => ok<LedgerTransfer>(r, 201)));
    expect(transfers[0]!.id).toBe(transfers[1]!.id);
    const after = await report();
    expect(after.incomeCents).toBe('3000');
    expect(after.expenseCents).toBe('500');
    expect(after.resultCents).toBe('2500');
    expect(after.accounts.reduce((n, a) => n + BigInt(a.closingCents), 0n)).toBe(
      before.accounts.reduce((n, a) => n + BigInt(a.closingCents), 0n),
    );
    expect(after.accounts.find((a) => a.accountId === cash.id)?.closingCents).toBe('4000');
    expect(after.accounts.find((a) => a.accountId === bank.id)?.closingCents).toBe('18500');
    await expect(
      db.execute(sql`update ledger_transfers set amount_cents=1 where id=${transfers[0]!.id}`),
    ).rejects.toThrow();
    await ok(
      await post(`/finance/transfers/${transfers[0]!.id}/reversal`, {
        bookingDate: '2026-05-03',
        reason: 'Falsches Zielkonto',
      }),
      201,
    );
    expect((await report()).accounts.find((a) => a.accountId === cash.id)?.closingCents).toBe('0');
    expect(
      (
        await post(`/finance/transfers/${transfers[0]!.id}/reversal`, {
          bookingDate: '2026-05-03',
          reason: 'Doppelt',
        })
      ).statusCode,
    ).toBe(409);
  });
  it('rejects cross-organization transfers atomically and enforces dates at the database boundary', async () => {
    const other = await ok<FinanceAccount>(
        await post('/finance/accounts', { name: 'Foreign bank', kind: 'bank' }, foreign),
        201,
      ),
      before = await report();
    expect(
      (
        await post('/finance/transfers', {
          fromAccountId: bank.id,
          toAccountId: other.id,
          amountCents: 100,
          bookingDate: '2026-05-02',
          description: 'invalid',
        })
      ).statusCode,
    ).toBe(404);
    expect((await report()).accounts).toEqual(before.accounts);
    expect(
      (
        await post('/finance/fiscal-years', {
          year: 2027,
          startsOn: '2027-03-31',
          endsOn: '2028-03-30',
        })
      ).statusCode,
    ).toBe(409);
    const crossCalendar = await ok<CashbookEntry>(
      await post(
        '/finance/cashbook',
        entry({ bookingDate: '2027-02-01', documentDate: '2027-02-01', amountCents: 100 }),
      ),
      201,
    );
    expect(crossCalendar.fiscalYear).toBe(2026);
    await expect(
      db.execute(
        sql`insert into ledger_transfers(organization_id,fiscal_year,from_account_id,to_account_id,amount_cents,booking_date,description,created_by) select organization_id,2026,${bank.id},${cash.id},100,'2026-01-01','invalid',created_by from cashbook_entries limit 1`,
      ),
    ).rejects.toThrow();
  });
  it('posts one full monetary event for partial allocations, retries and payment reversals', async () => {
    const memberRow = await ok<{ id: string }>(
      await post('/members', {
        firstName: 'Eva',
        lastName: 'Natur',
        membershipNumber: 'S22-1',
        joinedAt: '2020-01-01',
      }),
      201,
    );
    const plan = await ok<{ id: string }>(
      await post('/fee-plans', { name: 'Beitrag', amountCents: 3000, interval: 'annual' }),
      201,
    );
    const assessments = [];
    for (const fiscalYear of [2026, 2027])
      assessments.push(
        await ok<{ id: string }>(
          await post('/fee-assessments', {
            planId: plan.id,
            membershipId: memberRow.id,
            fiscalYear,
            dueDate: '2026-04-30',
          }),
          201,
        ),
      );
    const before = await report(),
      key = crypto.randomUUID(),
      payload = {
        payerName: 'Eva Natur',
        paidOn: '2026-06-01',
        method: 'bank_transfer',
        reference: 's22-unique',
        amountCents: 3000,
        allocations: assessments.map((a) => ({ assessmentId: a.id, amountCents: 1500 })),
      };
    expect((await post('/payments', { ...payload, method: 'other' })).statusCode).toBe(422);
    expect((await report()).incomeCents).toBe(before.incomeCents);
    const paid = await ok<Payment>(await post('/payments', payload, admin, key), 201);
    expect(paid.cashbookEntryId).toBeTruthy();
    const repeat = await ok<Payment>(await post('/payments', payload, admin, key), 201);
    expect(repeat.cashbookEntryId).toBe(paid.cashbookEntryId);
    expect(BigInt((await report()).incomeCents) - BigInt(before.incomeCents)).toBe(3000n);
    for (const a of assessments) {
      const row = await ok<{ paidCents: number; openCents: number }>(
        await get(`/fee-assessments/${a.id}`),
      );
      expect(row.paidCents).toBe(1500);
      expect(row.openCents).toBe(1500);
    }
    await ok(
      await post(`/payments/${paid.id}/reversal`, {
        reversedOn: '2026-06-02',
        reason: 'Zahlung zurückgebucht',
      }),
    );
    expect((await report()).incomeCents).toBe(before.incomeCents);
    for (const a of assessments)
      expect(
        (await ok<{ openCents: number }>(await get(`/fee-assessments/${a.id}`))).openCents,
      ).toBe(3000);
  });
  it('backfills legacy payments once and protects closed years with explicit confirmation', async () => {
    // A legacy organization has payments before enabling automatic ledger defaults.
    const person = await ok<{ id: string }>(
      await post(
        '/members',
        {
          firstName: 'Alt',
          lastName: 'Bestand',
          membershipNumber: 'LEG-1',
          joinedAt: '2020-01-01',
        },
        foreign,
      ),
      201,
    );
    const plan = await ok<{ id: string }>(
      await post(
        '/fee-plans',
        { name: 'Altbeitrag', amountCents: 3000, interval: 'annual' },
        foreign,
      ),
      201,
    );
    const assessment = await ok<{ id: string }>(
      await post(
        '/fee-assessments',
        { planId: plan.id, membershipId: person.id, fiscalYear: 2026, dueDate: '2026-01-31' },
        foreign,
      ),
      201,
    );
    const payment = await ok<Payment>(
      await post(
        '/payments',
        {
          payerName: 'Altbestand',
          amountCents: 3000,
          paidOn: '2026-03-01',
          method: 'bank_transfer',
          allocations: [{ assessmentId: assessment.id, amountCents: 3000 }],
        },
        foreign,
      ),
      201,
    );
    expect(payment.cashbookEntryId).toBeNull();
    await ok(await post('/finance/initialize', { language: 'it' }, foreign));
    const accounts = await ok<{ items: FinanceAccount[] }>(await get('/finance/accounts', foreign));
    const categories = await ok<{ items: CashbookCategory[] }>(
      await get('/finance/categories', foreign),
    );
    await ok(await post('/finance/fiscal-years', { year: 2026 }, foreign), 201);
    const body = {
        accountId: accounts.items.find((a) => a.kind === 'bank')!.id,
        categoryId: categories.items.find((c) => c.classification === 'membership_fee')!.id,
        fiscalYear: 2026,
        method: 'bank_transfer',
      },
      key = crypto.randomUUID();
    expect(await ok(await post('/finance/payments/backfill', body, foreign, key))).toEqual({
      booked: 1,
      remaining: 0,
    });
    expect(await ok(await post('/finance/payments/backfill', body, foreign))).toEqual({
      booked: 0,
      remaining: 0,
    });
    expect(await ok(await post('/finance/payments/backfill', body, foreign, key))).toEqual({
      booked: 1,
      remaining: 0,
    });
    expect((await post('/finance/fiscal-years/2026/close', {}, foreign)).statusCode).toBe(422);
    await ok(await post('/finance/fiscal-years/2026/close', { confirm: true }, foreign));
    expect((await post('/finance/payments/backfill', body, foreign)).statusCode).toBe(409);
    await expect(
      db.execute(sql`update fiscal_years set ends_on='2026-11-30' where organization_id<>${org}`),
    ).rejects.toThrow();
  });
});
describe('report reproducibility, authorization and documents', () => {
  it('snapshots category names and mappings; reversals retain the original mapping', async () => {
    const original = await ok<CashbookEntry>(
      await post('/finance/cashbook', entry({ bookingDate: '2026-08-01' })),
      201,
    );
    expect(original.etsPosition).toBe('A.income.4');
    await ok(
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/finance/categories/${donation.id}`,
        headers: headers(admin, crypto.randomUUID()),
        payload: { name: 'Freie Spenden', version: donation.version },
      }),
    );
    await ok(
      await post(`/finance/categories/${donation.id}/ets-mappings`, {
        effectiveFrom: '2026-09-01',
        position: 'C.income.1',
      }),
      201,
    );
    const next = await ok<CashbookEntry>(
      await post('/finance/cashbook', entry({ bookingDate: '2026-09-01' })),
      201,
    );
    expect(next.etsPosition).toBe('C.income.1');
    expect(next.categoryName).toBe('Freie Spenden');
    const unchanged = await ok<CashbookEntry>(await get(`/finance/cashbook/${original.id}`));
    expect(unchanged.categoryName).toBe('Spenden');
    await ok(await post('/finance/initialize', { language: 'it' }));
    expect(
      (await ok<{ items: CashbookCategory[] }>(await get('/finance/categories'))).items,
    ).toHaveLength(15);
    await expect(
      db.execute(
        sql`update cashbook_categories set classification='other' where id=${donation.id}`,
      ),
    ).rejects.toThrow();
    const reversal = await ok<CashbookEntry>(
      await post(`/finance/cashbook/${original.id}/reversal`, {
        bookingDate: '2026-09-02',
        reason: 'Korrektur',
      }),
      201,
    );
    expect(reversal.etsPosition).toBe('A.income.4');
    expect(reversal.categoryName).toBe('Spenden');
    expect(
      (
        await ok<{ total: number }>(
          await get('/finance/cashbook?from=2026-09-01&to=2026-09-01&project=Waldpflege'),
        )
      ).total,
    ).toBe(1);
  });
  it('exports reconciled ETS models, exact boundary thresholds, warnings and dashboard data', async () => {
    const annual = await report();
    const d = await ok<EtsReport>(
      await get(
        '/finance/reports/ets?fiscalYear=2026&model=D&legalPersonality=no&priorRevenueCents=30000000',
      ),
    );
    const e = await ok<EtsReport>(
      await get(
        '/finance/reports/ets?fiscalYear=2026&model=E&legalPersonality=yes&priorRevenueCents=6000000',
      ),
    );
    expect(d.eligibility).toBe('within_limit');
    expect(e.eligibility).toBe('within_limit');
    expect(e.incomeCents).toBe(annual.incomeCents);
    expect(e.expenseCents).toBe(annual.expenseCents);
    expect(e.checks.find((c) => c.code === 'balanced')?.ok).toBe(true);
    expect(e.rows.find((r) => r.code === 'total')?.resultCents).toBe(annual.resultCents);
    expect(BigInt(e.closingCents) - BigInt(e.openingCents)).toBe(BigInt(e.resultCents));
    expect(
      (
        await ok<EtsReport>(
          await get('/finance/reports/ets?fiscalYear=2026&model=E&priorRevenueCents=6000001'),
        )
      ).eligibility,
    ).toBe('outside_limit');
    const unmapped = await ok<CashbookEntry>(
      await post(
        '/finance/cashbook',
        entry({
          categoryId: (
            await ok<{ items: CashbookCategory[] }>(await get('/finance/categories'))
          ).items.find((c) => c.name === 'Projektkosten')!.id,
          amountCents: 50,
        }),
      ),
      201,
    );
    expect(
      (await ok<EtsReport>(await get('/finance/reports/ets?fiscalYear=2026'))).unmappedEntryIds,
    ).toContain(unmapped.id);
    const dashboard = await ok<FinanceDashboard>(await get('/finance/dashboard?fiscalYear=2026'));
    expect(dashboard.totalCents).toBe(
      (await ok<EtsReport>(await get('/finance/reports/ets?fiscalYear=2026'))).closingCents,
    );
    expect(dashboard.recent.length).toBeGreaterThan(0);
    expect(dashboard.trend.length).toBeGreaterThan(0);
    // More parallel readers than pool connections must not reserve a snapshot while waiting for auth.
    const parallel = await Promise.all(
      Array.from({ length: 12 }, () => get('/finance/dashboard?fiscalYear=2026')),
    );
    for (const response of parallel) expect(response.statusCode, response.body).toBe(200);
    for (const path of [
      '/finance/reports/ets/pdf?fiscalYear=2026&language=it',
      '/finance/cashbook-export/pdf?fiscalYear=2026',
    ]) {
      const r = await get(path);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    }
    const csv = await get('/finance/reports/ets/csv?fiscalYear=2026');
    expect(csv.statusCode, csv.body).toBe(200);
    expect(csv.body).toContain('ets-d2020-e2026-r1');
    expect(csv.body).toContain('unmapped');
  });
  it('denies finance access across roles and organizations, including private transfer receipts', async () => {
    for (const path of [
      '/finance/dashboard?fiscalYear=2026',
      '/finance/ets-definitions',
      '/finance/transfers?fiscalYear=2026',
      '/finance/reports/ets?fiscalYear=2026',
      '/finance/cashbook-export/pdf?fiscalYear=2026',
    ]) {
      expect((await get(path, member)).statusCode).toBe(403);
      expect((await get(path, board)).statusCode).toBe(403);
    }
    const tr = await ok<LedgerTransfer>(
      await post('/finance/transfers', {
        fromAccountId: bank.id,
        toAccountId: cash.id,
        amountCents: 100,
        bookingDate: '2026-09-03',
        description: 'Quittung',
      }),
      201,
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: {
        ...headers(admin, crypto.randomUUID()),
        'content-type': 'application/pdf',
        'x-document-metadata': encodeDocumentMetadata({
          title: 'Übertragsbeleg',
          category: 'receipt',
          transferId: tr.id,
          filename: 'quittung.pdf',
        }),
      },
      payload: Buffer.from('%PDF-1.4\n%%EOF'),
    });
    const doc = await ok<DocumentDetail>(response, 201),
      path = `/documents/${doc.id}/versions/${doc.latestVersion!.id}/content`;
    expect((await get(path)).statusCode).toBe(200);
    expect((await get(path, member)).statusCode).toBe(403);
    expect((await get(path, board)).statusCode).toBe(404);
    expect((await get(path, foreign)).statusCode).toBe(404);
    expect((await get(`/documents/${doc.id}`, board)).statusCode).toBe(404);
    expect(
      (
        await post(
          '/finance/transfers',
          {
            fromAccountId: bank.id,
            toAccountId: cash.id,
            amountCents: 100,
            bookingDate: '2026-09-03',
            description: 'foreign',
          },
          foreign,
        )
      ).statusCode,
    ).toBe(409); // no open foreign year
    expect((await get(`/finance/categories/${donation.id}/ets-mappings`, foreign)).statusCode).toBe(
      404,
    );
  });
  it('locks a confirmed year against subsequent ledger entries and transfers', async () => {
    const before = await report();
    await ok(await post('/finance/fiscal-years/2026/close', { confirm: true }));
    expect((await post('/finance/cashbook', entry())).statusCode).toBe(409);
    expect(
      (
        await post('/finance/transfers', {
          fromAccountId: bank.id,
          toAccountId: cash.id,
          amountCents: 100,
          bookingDate: '2026-09-03',
          description: 'closed',
        })
      ).statusCode,
    ).toBe(409);
    expect((await report()).incomeCents).toBe(before.incomeCents);
  });
  it('carries balances and reports prior-year figures across non-calendar years', async () => {
    const previous = await report();
    const next = await ok<{ balances: AnnualReport['accounts'] }>(
      await post('/finance/fiscal-years', {
        year: 2027,
        startsOn: '2027-04-01',
        endsOn: '2028-03-31',
      }),
      201,
    );
    for (const account of previous.accounts)
      expect(next.balances.find((a) => a.accountId === account.accountId)?.openingCents).toBe(
        account.closingCents,
      );
    const comparison = await ok<EtsReport>(
      await get('/finance/reports/ets?fiscalYear=2027&model=E&legalPersonality=no'),
    );
    expect(comparison.priorFiscalYear).toBe(2026);
    expect(comparison.rows.find((r) => r.code === 'total')?.priorResultCents).toBe(
      previous.resultCents,
    );
    expect(comparison.incomeCents).toBe('0');
    expect(comparison.resultCents).toBe('0');
    expect(comparison.checks.find((c) => c.code === 'balanced')?.ok).toBe(true);
  });
});
