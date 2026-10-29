import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';
import { createDatabase, schema as s } from '../../packages/db/src';
import { createApp } from '../../apps/api/src/app';
import { bootstrap } from '../../apps/api/src/services/bootstrap';
import { readConfig } from '../../apps/api/src/plugins/config';
import type {
  FinanceAccount,
  CashbookCategory,
  FiscalYear,
  CashbookEntry,
  FeePlan,
  FeeAssessment,
  Payment,
  Member,
  Page,
  AnnualReport,
  ReportTemplate,
} from '../../packages/contracts/src';
const config = readConfig();
if (config.NODE_ENV !== 'test' || !new URL(config.DATABASE_URL).pathname.endsWith('/bnature_test'))
  throw new Error('Dedicated test database required');
const { db, pool } = createDatabase(config.DATABASE_URL),
  app = await createApp(db, config);
const password = 'Ledger-test-only-Password-2026!';
let admin = '',
  treasurer = '',
  board = '',
  member = '',
  foreignAdmin = '',
  org = '';
let cash: FinanceAccount,
  bank: FinanceAccount,
  foreignAccount: FinanceAccount,
  fees: CashbookCategory,
  donations: CashbookCategory,
  rent: CashbookCategory,
  own: Member,
  plan: FeePlan,
  bankBooked: Payment;
let sequence = 0;
const headers = (cookie: string, key?: string) => ({
  cookie,
  origin: config.APP_URL,
  ...(key ? { 'idempotency-key': key } : {}),
});
const send = (
  method: 'POST' | 'PATCH',
  path: string,
  payload: Record<string, unknown>,
  cookie = treasurer,
  key: string = crypto.randomUUID(),
) => app.inject({ method, url: `/api/v1${path}`, headers: headers(cookie, key), payload });
const post = (path: string, payload: Record<string, unknown>, cookie = treasurer, key?: string) =>
  send('POST', path, payload, cookie, key);
const get = (path: string, cookie = treasurer) =>
  app.inject({ url: `/api/v1${path}`, headers: headers(cookie) });
async function login(email: string) {
  const r = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers: { origin: config.APP_URL },
    payload: { email, password },
  });
  expect(r.statusCode, r.body).toBe(200);
  const cookies = r.headers['set-cookie'];
  return (Array.isArray(cookies) ? cookies : [cookies])
    .filter(Boolean)
    .map((c) => c!.split(';')[0])
    .join('; ');
}
async function created<T>(response: Awaited<ReturnType<typeof post>>, status = 201) {
  expect(response.statusCode, response.body).toBe(status);
  return response.json<T>();
}
const entry = (patch: Record<string, unknown> = {}) => ({
  accountId: cash.id,
  categoryId: rent.id,
  amountCents: 1000,
  bookingDate: '2026-03-01',
  documentDate: '2026-03-01',
  description: `Buchung ${++sequence}`,
  ...patch,
});
async function newAssessment(year = 2026) {
  return created<FeeAssessment>(
    await post(
      '/fee-assessments',
      { planId: plan.id, membershipId: own.id, fiscalYear: year, dueDate: `${year}-01-31` },
      admin,
    ),
  );
}
const payment = (assessment: FeeAssessment, patch: Record<string, unknown> = {}) => ({
  payerName: 'Familie Ledger',
  paidOn: '2026-04-01',
  method: 'cash',
  amountCents: assessment.amountCents,
  allocations: [{ assessmentId: assessment.id, amountCents: assessment.amountCents }],
  ...patch,
});
async function rawFails(statement: ReturnType<typeof sql>) {
  await expect(db.execute(statement)).rejects.toThrow();
}
async function report(year: number, query = '') {
  return created<AnnualReport>(
    await get(`/finance/reports/annual?fiscalYear=${year}${query}`),
    200,
  );
}
beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/db/migrations' });
  await db.execute(sql`truncate table organizations,users cascade`);
  const a = await bootstrap(db, config, {
      name: 'Ledger Admin',
      email: 'ledger-admin@example.test',
      password,
      organizationName: 'b*nature Kassabuch',
      slug: 'ledger-a',
    }),
    b = await bootstrap(db, config, {
      name: 'Foreign Ledger Admin',
      email: 'ledger-foreign@example.test',
      password,
      organizationName: 'Fremder Verein',
      slug: 'ledger-b',
    });
  org = a.organizationId;
  void b;
  await app.ready();
  admin = await login('ledger-admin@example.test');
  foreignAdmin = await login('ledger-foreign@example.test');
  for (const [role, email] of [
    ['treasurer', 'ledger-treasurer@example.test'],
    ['board', 'ledger-board@example.test'],
    ['member', 'ledger-member@example.test'],
  ] as const)
    await created(await post('/users', { name: role, email, password, role }, admin));
  treasurer = await login('ledger-treasurer@example.test');
  board = await login('ledger-board@example.test');
  member = await login('ledger-member@example.test');
  own = await created<Member>(
    await post(
      '/members',
      { firstName: 'Kai', lastName: 'Kasse', membershipNumber: 'L-001', joinedAt: '2020-01-01' },
      admin,
    ),
  );
  plan = await created<FeePlan>(
    await post(
      '/fee-plans',
      { name: 'Jahresbeitrag', amountCents: 5000, interval: 'annual' },
      admin,
    ),
  );
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('accounts, categories and fiscal years', () => {
  it('lets the treasurer create and version accounts and categories', async () => {
    cash = await created(await post('/finance/accounts', { name: 'Handkasse', kind: 'cash' }));
    bank = await created(
      await post('/finance/accounts', {
        name: 'Raiffeisen',
        kind: 'bank',
        iban: 'it60 x054 2811 1010 0000 0123 456',
      }),
    );
    expect(bank.iban).toBe('IT60X0542811101000000123456');
    fees = await created(
      await post('/finance/categories', {
        name: 'Mitgliedsbeiträge',
        direction: 'income',
        classification: 'membership_fee',
      }),
    );
    donations = await created(
      await post('/finance/categories', {
        name: 'Spenden',
        direction: 'income',
        classification: 'donation',
      }),
    );
    rent = await created(
      await post('/finance/categories', { name: 'Miete', direction: 'expense' }),
    );
    const renamed = await created<FinanceAccount>(
      await send('PATCH', `/finance/accounts/${cash.id}`, { name: 'Kasse', version: 1 }),
      200,
    );
    expect(renamed.version).toBe(2);
    expect(
      (await send('PATCH', `/finance/accounts/${cash.id}`, { name: 'X', version: 1 })).json().error
        .code,
    ).toBe('STALE_VERSION');
    cash = renamed;
    expect((await post('/finance/accounts', { name: 'Kasse', kind: 'cash' })).statusCode).toBe(409);
    expect(
      (
        await post('/finance/categories', {
          name: 'X',
          direction: 'expense',
          classification: 'donation',
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (await post('/finance/accounts', { name: 'Y', kind: 'bank', iban: 'nope' })).statusCode,
    ).toBe(422);
    foreignAccount = await created(
      await post('/finance/accounts', { name: 'Fremdkasse', kind: 'cash' }, foreignAdmin),
    );
  });
  it('refuses ledger access for board, members and foreign IDs', async () => {
    for (const cookie of [board, member]) {
      expect((await get('/finance/accounts', cookie)).statusCode).toBe(403);
      expect((await get('/finance/cashbook', cookie)).statusCode).toBe(403);
      expect(
        (await post('/finance/accounts', { name: 'Z', kind: 'cash' }, cookie)).statusCode,
      ).toBe(403);
      expect((await get('/finance/reports/annual/pdf?fiscalYear=2026', cookie)).statusCode).toBe(
        403,
      );
    }
    expect(
      (await send('PATCH', `/finance/accounts/${foreignAccount.id}`, { active: false, version: 1 }))
        .statusCode,
    ).toBe(404);
    expect(
      (await get('/finance/accounts')).json().items.map((a: FinanceAccount) => a.id),
    ).not.toContain(foreignAccount.id);
  });
  it('opens years once, rejects negative cash and validates foreign accounts', async () => {
    expect(
      (
        await post('/finance/fiscal-years', {
          year: 2026,
          openingBalances: [{ accountId: cash.id, amountCents: -1 }],
        })
      ).json().error.code,
    ).toBe('NEGATIVE_CASH');
    expect(
      (
        await post('/finance/fiscal-years', {
          year: 2026,
          openingBalances: [{ accountId: foreignAccount.id, amountCents: 100 }],
        })
      ).statusCode,
    ).toBe(404);
    const year = await created<FiscalYear>(
      await post('/finance/fiscal-years', {
        year: 2026,
        openingBalances: [
          { accountId: cash.id, amountCents: 20_000 },
          { accountId: bank.id, amountCents: -5_000 },
        ],
      }),
    );
    expect(year.status).toBe('open');
    expect(year.balances.find((b) => b.accountId === cash.id)?.openingCents).toBe('20000');
    expect((await post('/finance/fiscal-years', { year: 2026 })).json().error.code).toBe(
      'FISCAL_YEAR_EXISTS',
    );
    expect((await post('/finance/fiscal-years', { year: 2027 })).json().error.code).toBe(
      'PREVIOUS_YEAR_OPEN',
    );
    await rawFails(sql`update fiscal_years set year=2030 where organization_id=${org}`);
    await rawFails(sql`delete from fiscal_years where organization_id=${org}`);
    await rawFails(
      sql`update fiscal_year_opening_balances set amount_cents=1 where organization_id=${org}`,
    );
  });
});

describe('cashbook entries and reversals', () => {
  it('posts numbered entries, derives direction and keeps them immutable', async () => {
    const first = await created<CashbookEntry>(await post('/finance/cashbook', entry()));
    const second = await created<CashbookEntry>(
      await post(
        '/finance/cashbook',
        entry({ categoryId: donations.id, accountId: bank.id, amountCents: 2500 }),
      ),
    );
    expect(first.direction).toBe('expense');
    expect(second.direction).toBe('income');
    expect(second.entryNumber).toBe(first.entryNumber + 1);
    expect(
      (await post('/finance/cashbook', entry({ categoryId: fees.id }))).json().error.code,
    ).toBe('MEMBERSHIP_FEE_VIA_PAYMENT');
    expect(
      (await post('/finance/cashbook', entry({ bookingDate: '2025-12-31' }))).json().error.code,
    ).toBe('FISCAL_YEAR_NOT_OPEN');
    expect((await post('/finance/cashbook', entry({ amountCents: 0 }))).statusCode).toBe(422);
    expect(
      (await post('/finance/cashbook', entry({ accountId: foreignAccount.id }))).statusCode,
    ).toBe(404);
    await rawFails(sql`update cashbook_entries set amount_cents=1 where id=${first.id}`);
    await rawFails(sql`delete from cashbook_entries where id=${first.id}`);
    await rawFails(sql`insert into cashbook_entries
      (organization_id, fiscal_year, entry_number, account_id, category_id, direction, amount_cents, booking_date, document_date, description, created_by)
      select organization_id, 2026, 999, account_id, ${fees.id}, 'income', 100, booking_date, document_date, 'raw', created_by
      from cashbook_entries where id=${first.id}`);
  });
  it('reverses an entry once with a referenced negative counter-entry', async () => {
    const original = await created<CashbookEntry>(
      await post('/finance/cashbook', entry({ amountCents: 777 })),
    );
    expect(
      (
        await post(`/finance/cashbook/${original.id}/reversal`, {
          bookingDate: '2026-02-01',
          reason: 'zu früh',
        })
      ).json().error.code,
    ).toBe('REVERSAL_BEFORE_ORIGINAL');
    const key = crypto.randomUUID(),
      body = { bookingDate: '2026-03-02', reason: 'Doppelt erfasst' };
    const [a, b] = await Promise.all([
      post(`/finance/cashbook/${original.id}/reversal`, body, treasurer, key),
      post(`/finance/cashbook/${original.id}/reversal`, body, treasurer, key),
    ]);
    const reversal = await created<CashbookEntry>(a);
    expect(b.json()).toEqual(reversal);
    expect([a.headers['idempotency-replayed'], b.headers['idempotency-replayed']].sort()).toEqual([
      'false',
      'true',
    ]);
    expect(reversal.amountCents).toBe(-777);
    expect(reversal.reversesEntryId).toBe(original.id);
    expect((await post(`/finance/cashbook/${original.id}/reversal`, body)).json().error.code).toBe(
      'ALREADY_REVERSED',
    );
    expect((await post(`/finance/cashbook/${reversal.id}/reversal`, body)).json().error.code).toBe(
      'NOT_REVERSIBLE',
    );
    expect(
      (
        await post(
          `/finance/cashbook/${original.id}/reversal`,
          { ...body, reason: 'anders' },
          treasurer,
          key,
        )
      ).json().error.code,
    ).toBe('IDEMPOTENCY_MISMATCH');
    const detail = await created<CashbookEntry>(await get(`/finance/cashbook/${original.id}`), 200);
    expect(detail.reversedByEntryId).toBe(reversal.id);
  });
  it('assigns unique numbers to concurrent entries', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => post('/finance/cashbook', entry({ amountCents: 1 }))),
    );
    const numbers = results.map((r) => {
      expect(r.statusCode, r.body).toBe(201);
      return r.json<CashbookEntry>().entryNumber;
    });
    expect(new Set(numbers).size).toBe(6);
  });
  it('filters and searches the cashbook on the server', async () => {
    const page = await created<Page<CashbookEntry>>(
      await get(`/finance/cashbook?fiscalYear=2026&categoryId=${donations.id}`),
      200,
    );
    expect(page.total).toBe(1);
    expect(page.items[0]!.categoryName).toBe('Spenden');
    const searched = await created<Page<CashbookEntry>>(
      await get('/finance/cashbook?search=Doppelt'),
      200,
    );
    expect(searched.items.every((e) => e.reversesEntryId)).toBe(true);
    const foreign = await created<Page<CashbookEntry>>(
      await get('/finance/cashbook', foreignAdmin),
      200,
    );
    expect(foreign.total).toBe(0);
  });
});

describe('payment booking and reversal', () => {
  it('books a payment atomically with its creation and prevents double booking', async () => {
    const assessment = await newAssessment();
    const paid = await created<Payment>(
      await post(
        '/payments',
        payment(assessment, { booking: { accountId: cash.id, categoryId: fees.id } }),
      ),
    );
    expect(paid.cashbookEntryId).toBeTruthy();
    const booked = await created<CashbookEntry>(
      await get(`/finance/cashbook/${paid.cashbookEntryId}`),
      200,
    );
    expect(booked).toMatchObject({
      paymentId: paid.id,
      amountCents: 5000,
      classification: 'membership_fee',
    });
    expect(
      (
        await post(`/payments/${paid.id}/booking`, { accountId: bank.id, categoryId: fees.id })
      ).json().error.code,
    ).toBe('PAYMENT_ALREADY_BOOKED');
    expect(
      (
        await post(`/finance/cashbook/${booked.id}/reversal`, {
          bookingDate: '2026-05-01',
          reason: 'direkt',
        })
      ).json().error.code,
    ).toBe('USE_PAYMENT_REVERSAL');
    await rawFails(sql`insert into cashbook_entries
      (organization_id, fiscal_year, entry_number, account_id, category_id, direction, amount_cents, booking_date, document_date, description, payment_id, reverses_entry_id, reversal_reason, created_by)
      select organization_id, 2026, 990, account_id, category_id, direction, -amount_cents, booking_date, document_date, 'raw', payment_id, id, 'raw', created_by
      from cashbook_entries where id=${booked.id}`);
  });
  it('rolls back a payment whose booking is invalid', async () => {
    const assessment = await newAssessment(2027);
    const before = (await db.select().from(s.payments)).length;
    const failed = await post(
      '/payments',
      payment(assessment, { booking: { accountId: cash.id, categoryId: donations.id } }),
    );
    expect(failed.json().error.code).toBe('BOOKING_CATEGORY_INVALID');
    expect((await db.select().from(s.payments)).length).toBe(before);
    const later = await created<Payment>(await post('/payments', payment(assessment)));
    expect(later.cashbookEntryId).toBeNull();
    const booked = await created<Payment>(
      await post(`/payments/${later.id}/booking`, { accountId: bank.id, categoryId: fees.id }),
      200,
    );
    expect(booked.cashbookEntryId).toBeTruthy();
    bankBooked = booked;
  });
  it('reverses a booked payment, reopens the assessment and reverses the entry', async () => {
    const assessment = await newAssessment(2028);
    const paid = await created<Payment>(
      await post(
        '/payments',
        payment(assessment, {
          method: 'bank_transfer',
          reference: 'SEPA-REVERSAL-1',
          booking: { accountId: bank.id, categoryId: fees.id },
        }),
      ),
    );
    expect(
      (
        await post(
          '/payments',
          payment(await newAssessment(2029), {
            method: 'bank_transfer',
            reference: 'SEPA-REVERSAL-1',
          }),
        )
      ).json().error.code,
    ).toBe('PAYMENT_REFERENCE_EXISTS');
    expect(
      (
        await post(`/payments/${paid.id}/reversal`, { reversedOn: '2026-01-01', reason: 'x' })
      ).json().error.code,
    ).toBe('REVERSAL_BEFORE_ORIGINAL');
    const reversed = await created<Payment>(
      await post(`/payments/${paid.id}/reversal`, {
        reversedOn: '2026-04-15',
        reason: 'Falsche Zuordnung',
      }),
      200,
    );
    expect(reversed.status).toBe('reversed');
    expect(reversed.reversal?.reason).toBe('Falsche Zuordnung');
    const reopened = await created<FeeAssessment>(
      await get(`/fee-assessments/${assessment.id}`),
      200,
    );
    expect(reopened).toMatchObject({ paidCents: 0, openCents: 5000, status: 'open' });
    const entries = await created<Page<CashbookEntry>>(
      await get(`/finance/cashbook?search=BN-${String(paid.receiptNumber).padStart(6, '0')}`),
      200,
    );
    expect(entries.items.map((e) => e.amountCents).sort((a, b) => a - b)).toEqual([-5000, 5000]);
    expect(
      (
        await post(`/payments/${paid.id}/reversal`, { reversedOn: '2026-04-16', reason: 'nochmal' })
      ).json().error.code,
    ).toBe('PAYMENT_REVERSED');
    expect(
      (
        await post(`/payments/${paid.id}/booking`, { accountId: bank.id, categoryId: fees.id })
      ).json().error.code,
    ).toBe('PAYMENT_REVERSED');
    // The bank reference is released for the corrected payment.
    const corrected = await created<Payment>(
      await post(
        '/payments',
        payment(assessment, { method: 'bank_transfer', reference: 'SEPA-REVERSAL-1' }),
      ),
    );
    expect(corrected.status).toBe('posted');
    const detail = await get(`/fee-assessments/${assessment.id}`);
    expect(
      detail
        .json()
        .payments.map((p: { reversed: boolean }) => p.reversed)
        .sort(),
    ).toEqual([false, true]);
    const pdf = await get(`/payments/${paid.id}/receipt`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });
  it('requires the cashbook reversal for a booked payment at commit', async () => {
    const assessment = await newAssessment(2030);
    const paid = await created<Payment>(
      await post(
        '/payments',
        payment(assessment, { booking: { accountId: cash.id, categoryId: fees.id } }),
      ),
    );
    const [user] = await db.select({ id: s.user.id }).from(s.user).limit(1);
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(s.paymentReversals).values({
          organizationId: org,
          paymentId: paid.id,
          reversedOn: '2026-05-01',
          reason: 'raw',
          createdBy: user!.id,
        });
      }),
    ).rejects.toThrow();
    expect(
      (await db.select().from(s.paymentReversals).where(eq(s.paymentReversals.paymentId, paid.id)))
        .length,
    ).toBe(0);
  });
});

describe('closing and reports', () => {
  let template: ReportTemplate;
  it('builds the annual report with separated fee and donation income', async () => {
    const unbooked = await newAssessment(2031);
    await created(await post('/payments', payment(unbooked, { paidOn: '2026-06-01' })));
    const data = await report(2026);
    expect(data.status).toBe('open');
    // Fees: 5000 (cash) + 5000 (bank, 2027 assessment) + 5000 (cash, 2030) ; reversed booking nets to zero.
    expect(data.membershipFeeIncomeCents).toBe('15000');
    expect(data.donationIncomeCents).toBe('2500');
    expect(BigInt(data.incomeCents)).toBe(17_500n);
    expect(BigInt(data.resultCents)).toBe(BigInt(data.incomeCents) - BigInt(data.expenseCents));
    expect(data.unbookedPaymentCount).toBe(2);
    const cashBalance = data.accounts.find((a) => a.accountId === cash.id)!;
    expect(BigInt(cashBalance.closingCents)).toBe(
      20_000n + BigInt(cashBalance.incomeCents) - BigInt(cashBalance.expenseCents),
    );
    expect((await get('/finance/reports/annual?fiscalYear=2026', foreignAdmin)).statusCode).toBe(
      404,
    );
  });
  it('versions organization-defined templates and applies thresholds', async () => {
    const lines = [
      { code: 'A1', label: 'Quote associative', direction: 'income', categoryIds: [fees.id] },
      {
        code: 'A2',
        label: 'Erogazioni liberali',
        direction: 'income',
        categoryIds: [donations.id],
      },
    ];
    expect(
      (
        await post('/finance/report-templates', {
          name: 'Falsch',
          validFromYear: 2026,
          lines: [{ code: 'B1', label: 'x', direction: 'expense', categoryIds: [fees.id] }],
        })
      ).json().error.code,
    ).toBe('TEMPLATE_CATEGORY_INVALID');
    expect(
      (
        await post('/finance/report-templates', {
          name: 'Doppelt',
          validFromYear: 2026,
          lines: [lines[0], { ...lines[1], categoryIds: [fees.id] }],
        })
      ).statusCode,
    ).toBe(422);
    template = await created(
      await post('/finance/report-templates', {
        name: 'Rendiconto per cassa (Vereinskonfiguration)',
        validFromYear: 2026,
        validToYear: 2027,
        revenueThresholdCents: 10_000,
        lines,
      }),
    );
    const data = await report(2026, `&templateId=${template.id}`);
    expect(data.template?.lines.map((l) => l.totalCents)).toEqual(['15000', '2500']);
    expect(data.template?.thresholdExceeded).toBe(true);
    expect(data.template?.unmappedCategoryIds).toEqual([rent.id]);
    const next = await created<ReportTemplate>(
      await post(`/finance/report-templates/${template.templateKey}/versions`, {
        version: 1,
        template: {
          name: template.name,
          validFromYear: 2026,
          validToYear: 2027,
          revenueThresholdCents: 100_000,
          lines,
        },
      }),
    );
    expect(next.version).toBe(2);
    expect(
      (
        await post(`/finance/report-templates/${template.templateKey}/versions`, {
          version: 1,
          template: { name: 'alt', validFromYear: 2026, lines },
        })
      ).json().error.code,
    ).toBe('STALE_VERSION');
    expect((await report(2026, `&templateId=${next.id}`)).template?.thresholdExceeded).toBe(false);
    // The earlier version stays reproducible.
    expect((await report(2026, `&templateId=${template.id}`)).template?.thresholdExceeded).toBe(
      true,
    );
    const listed = (await get('/finance/report-templates')).json().items;
    expect(listed.map((t: ReportTemplate) => t.version)).toEqual([2]);
    await rawFails(sql`update finance_report_templates set name='x' where id=${template.id}`);
    const pdf = await get(
      `/finance/reports/annual/pdf?fiscalYear=2026&language=it&templateId=${next.id}`,
    );
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['cache-control']).toBe('no-store');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });
  it('closes years for admin only and blocks later postings', async () => {
    const early = await created<FiscalYear>(
      await post('/finance/fiscal-years', { year: 2027, openingBalances: [] }),
    );
    expect(early.openingMismatch).toBe(true);
    expect((await post('/finance/fiscal-years/2027/close', {}, admin)).json().error.code).toBe(
      'PREVIOUS_YEAR_OPEN',
    );
    expect((await post('/finance/fiscal-years/2026/close', {})).statusCode).toBe(403);
    const closed = await created<FiscalYear>(
      await post('/finance/fiscal-years/2026/close', {}, admin),
      200,
    );
    expect(closed.status).toBe('closed');
    expect((await post('/finance/fiscal-years/2026/close', {}, admin)).json().error.code).toBe(
      'FISCAL_YEAR_CLOSED',
    );
    expect((await post('/finance/cashbook', entry())).json().error.code).toBe(
      'FISCAL_YEAR_NOT_OPEN',
    );
    await rawFails(
      sql`update fiscal_years set status='open', closed_by=null, closed_at=null where organization_id=${org} and year=2026`,
    );
    await rawFails(sql`insert into cashbook_entries
      (organization_id, fiscal_year, entry_number, account_id, category_id, direction, amount_cents, booking_date, document_date, description, created_by)
      values (${org}, 2026, 5000, ${cash.id}, ${rent.id}, 'expense', 1, '2026-12-31', '2026-12-31', 'raw', ${closed.id})`);
    // Reversal of a 2026 payment booking must happen in an open year; a 2026 date leaves nothing behind.
    expect(
      (
        await post(`/payments/${bankBooked.id}/reversal`, {
          reversedOn: '2026-12-31',
          reason: 'spät',
        })
      ).json().error.code,
    ).toBe('FISCAL_YEAR_NOT_OPEN');
    expect(
      (
        await db
          .select()
          .from(s.paymentReversals)
          .where(eq(s.paymentReversals.paymentId, bankBooked.id))
      ).length,
    ).toBe(0);
    const correction = await created<Payment>(
      await post(`/payments/${bankBooked.id}/reversal`, {
        reversedOn: '2027-01-10',
        reason: 'Korrektur',
      }),
      200,
    );
    expect(correction.status).toBe('reversed');
    expect((await report(2026)).status).toBe('closed');
    expect((await report(2027)).membershipFeeIncomeCents).toBe('-5000');
    expect((await get('/finance/reports/annual?fiscalYear=2028')).statusCode).toBe(404);
  });
  it('carries closing balances forward into the next year', async () => {
    await created(await post('/finance/fiscal-years/2027/close', {}, admin), 200);
    const opened = await created<FiscalYear>(await post('/finance/fiscal-years', { year: 2028 }));
    expect(opened.openingMismatch).toBe(false);
    expect(opened.balances.find((b) => b.accountId === bank.id)?.openingCents).toBe('-5000');
    expect(opened.balances.find((b) => b.accountId === cash.id)?.openingCents).toBe('0');
    expect(
      (await get(`/finance/reports/annual?fiscalYear=2028&templateId=${template.id}`)).json().error
        .code,
    ).toBe('TEMPLATE_NOT_VALID_FOR_YEAR');
    const years = (await get('/finance/fiscal-years')).json().items as FiscalYear[];
    expect(years.map((y) => [y.year, y.status])).toEqual([
      [2028, 'open'],
      [2027, 'closed'],
      [2026, 'closed'],
    ]);
    expect((await get('/finance/fiscal-years', foreignAdmin)).json().items).toEqual([]);
  });
});
