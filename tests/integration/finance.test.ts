import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, sql } from 'drizzle-orm';
import { createDatabase, schema as s } from '../../packages/db/src';
import { createApp } from '../../apps/api/src/app';
import { bootstrap } from '../../apps/api/src/services/bootstrap';
import { readConfig } from '../../apps/api/src/plugins/config';
import {
  feePlanInputSchema,
  assessmentInputSchema,
  paymentInputSchema,
  type FeePlan,
  type FeeAssessment,
  type Payment,
  type Member,
  type Page,
  type FinanceSummary,
} from '../../packages/contracts/src';
import {
  createPlan as createPlanService,
  createAssessment as createAssessmentService,
  createPayment as createPaymentService,
} from '../../apps/api/src/modules/finance/service';
import type { Access } from '../../apps/api/src/middleware/access';
const config = readConfig();
if (config.NODE_ENV !== 'test' || !new URL(config.DATABASE_URL).pathname.endsWith('/bnature_test'))
  throw new Error('Dedicated test database required');
const { db, pool } = createDatabase(config.DATABASE_URL),
  app = await createApp(db, config);
const password = 'Finance-test-only-Password-2026!';
let admin = '',
  foreignAdmin = '',
  treasurer = '',
  member = '',
  board = '',
  lead = '',
  org = '',
  foreignOrg = '',
  adminId = '';
let own: Member,
  other: Member,
  foreign: Member,
  plan: FeePlan,
  foreignPlan: FeePlan,
  assessment: FeeAssessment,
  foreignAssessment: FeeAssessment,
  payment: Payment;
let sequence = 0;
const headers = (cookie: string, key?: string, organization?: string) => ({
  cookie,
  origin: config.APP_URL,
  ...(key ? { 'idempotency-key': key } : {}),
  ...(organization ? { 'x-organization-id': organization } : {}),
});
const post = (
  path: string,
  payload: Record<string, unknown>,
  cookie = admin,
  key = crypto.randomUUID(),
) => app.inject({ method: 'POST', url: `/api/v1${path}`, headers: headers(cookie, key), payload });
const get = (path: string, cookie = admin) =>
  app.inject({ url: `/api/v1${path}`, headers: headers(cookie) });
const planInput = (patch: Record<string, unknown> = {}) => ({
  name: `Tarif ${++sequence}`,
  amountCents: 5000,
  interval: 'annual',
  ...patch,
});
const due = (
  planId: string,
  year = 2026,
  membershipId = own.id,
  patch: Record<string, unknown> = {},
) => ({ planId, membershipId, fiscalYear: year, dueDate: '2020-01-01', ...patch });
const pay = (id: string, amountCents: number, patch: Record<string, unknown> = {}) => ({
  payerName: 'Familie Test',
  paidOn: '2026-10-29',
  method: 'cash',
  amountCents,
  allocations: [{ assessmentId: id, amountCents }],
  ...patch,
});
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
async function newPlan(patch: Record<string, unknown> = {}) {
  const r = await post('/fee-plans', planInput(patch));
  expect(r.statusCode, r.body).toBe(201);
  return r.json<FeePlan>();
}
async function newAssessment(
  planId: string,
  year = 2026,
  membershipId = own.id,
  patch: Record<string, unknown> = {},
) {
  const r = await post('/fee-assessments', due(planId, year, membershipId, patch));
  expect(r.statusCode, r.body).toBe(201);
  return r.json<FeeAssessment>();
}
beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/db/migrations' });
  await db.execute(sql`truncate table organizations,users cascade`);
  const a = await bootstrap(db, config, {
      name: 'Finance Admin',
      email: 'finance-admin@example.test',
      password,
      organizationName: 'b*nature Finanztest',
      slug: 'finance-a',
    }),
    b = await bootstrap(db, config, {
      name: 'Foreign Admin',
      email: 'finance-foreign@example.test',
      password,
      organizationName: 'Andere Organisation',
      slug: 'finance-b',
    });
  org = a.organizationId;
  adminId = a.userId;
  foreignOrg = b.organizationId;
  await app.ready();
  admin = await login('finance-admin@example.test');
  foreignAdmin = await login('finance-foreign@example.test');
  for (const [role, email] of [
    ['treasurer', 'finance-treasurer@example.test'],
    ['member', 'finance-member@example.test'],
    ['board', 'finance-board@example.test'],
    ['project_lead', 'finance-lead@example.test'],
  ] as const) {
    const r = await post('/users', { name: role, email, password, role });
    expect(r.statusCode, r.body).toBe(201);
  }
  treasurer = await login('finance-treasurer@example.test');
  member = await login('finance-member@example.test');
  board = await login('finance-board@example.test');
  lead = await login('finance-lead@example.test');
  const createMember = async (number: string, cookie: string) => {
    const r = await post(
      '/members',
      { firstName: 'Léna', lastName: 'Test', membershipNumber: number, joinedAt: '2020-01-01' },
      cookie,
    );
    expect(r.statusCode, r.body).toBe(201);
    return r.json<Member>();
  };
  own = await createMember('A-001', admin);
  other = await createMember('A-002', admin);
  foreign = await createMember('B-001', foreignAdmin);
  const fp = await post('/fee-plans', planInput(), foreignAdmin);
  expect(fp.statusCode, fp.body).toBe(201);
  foreignPlan = fp.json<FeePlan>();
  const fa = await post('/fee-assessments', due(foreignPlan.id, 2026, foreign.id), foreignAdmin);
  expect(fa.statusCode, fa.body).toBe(201);
  foreignAssessment = fa.json<FeeAssessment>();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});
describe('fees, assessments and immutable snapshots', () => {
  it('lets the administrator create a tariff and the treasurer create an assessment', async () => {
    plan = await newPlan();
    const r = await post('/fee-assessments', due(plan.id), treasurer);
    expect(r.statusCode, r.body).toBe(201);
    assessment = r.json<FeeAssessment>();
    expect(assessment.amountCents).toBe(5000);
    expect(assessment.status).toBe('open');
    expect(assessment.overdue).toBe(true);
  });
  it('supports individual amounts, reductions and exemptions with reasons', async () => {
    const individual = await newAssessment(plan.id, 2027, own.id, {
      individualAmountCents: 4000,
      reductionCents: 500,
      adjustmentReason: 'Ermäßigung',
    });
    expect(individual.amountCents).toBe(3500);
    const exempt = await newAssessment(plan.id, 2028, own.id, {
      exempt: true,
      adjustmentReason: 'Beitragsbefreiung',
    });
    expect(exempt.amountCents).toBe(0);
    expect(exempt.status).toBe('exempt');
    expect((await post('/payments', pay(exempt.id, 1))).statusCode).toBe(409);
  });
  it('rejects missing adjustment reasons and excessive reductions', async () => {
    expect(
      (await post('/fee-assessments', due(plan.id, 2029, own.id, { exempt: true }))).statusCode,
    ).toBe(422);
    expect(
      (
        await post(
          '/fee-assessments',
          due(plan.id, 2029, own.id, { reductionCents: 6000, adjustmentReason: 'Test' }),
        )
      ).statusCode,
    ).toBe(422);
  });
  it('rejects duplicate annual and once-only assessments', async () => {
    expect((await post('/fee-assessments', due(plan.id))).statusCode).toBe(409);
    const once = await newPlan({ interval: 'once' });
    await newAssessment(once.id, 2026);
    expect((await post('/fee-assessments', due(once.id, 2027))).statusCode).toBe(409);
  });
  it('validates membership categories and inactive tariffs', async () => {
    const honorary = await newPlan({ membershipType: 'honorary' });
    expect((await post('/fee-assessments', due(honorary.id))).statusCode).toBe(422);
    const inactive = await newPlan({ active: false });
    expect((await post('/fee-assessments', due(inactive.id))).statusCode).toBe(409);
  });
  it('versions tariff updates while preserving existing assessment values', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/fee-plans/${plan.id}`,
      headers: headers(admin, crypto.randomUUID()),
      payload: { version: 1, name: 'Neuer Name', amountCents: 6000 },
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json<FeePlan>().version).toBe(2);
    const saved = (await get(`/fee-assessments/${assessment.id}`)).json<FeeAssessment>();
    expect(saved.amountCents).toBe(5000);
    expect(saved.planAmountCents).toBe(5000);
    expect(saved.planName).toBe(plan.name);
  });
  it('detects stale tariff versions and locks the interval of a used plan', async () => {
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/fee-plans/${plan.id}`,
          headers: headers(admin, crypto.randomUUID()),
          payload: { version: 1, active: false },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/fee-plans/${plan.id}`,
          headers: headers(admin, crypto.randomUUID()),
          payload: { version: 2, interval: 'once' },
        })
      ).statusCode,
    ).toBe(409);
  });
  it('paginates, searches and filters financial resources on the server', async () => {
    const r = await get(
      '/fee-assessments?pageSize=1&fiscalYear=2026&status=overdue&search=A-001&sort=amountCents',
    );
    expect(r.statusCode, r.body).toBe(200);
    const data = r.json<Page<FeeAssessment>>();
    expect(data.items).toHaveLength(1);
    expect(data.items.every((v) => v.membershipNumber === 'A-001' && v.overdue)).toBe(true);
    expect(data.total).toBeGreaterThan(0);
  });
});
describe('payments and allocations', () => {
  it('reduces the outstanding amount with a partial payment', async () => {
    const r = await post('/payments', pay(assessment.id, 1500), treasurer);
    expect(r.statusCode, r.body).toBe(201);
    payment = r.json<Payment>();
    const item = (await get(`/fee-assessments/${assessment.id}`)).json<FeeAssessment>();
    expect(item.paidCents).toBe(1500);
    expect(item.openCents).toBe(3500);
    expect(item.status).toBe('partial');
  });
  it('settles one assessment with several payments', async () => {
    const r = await post('/payments', pay(assessment.id, 3500));
    expect(r.statusCode, r.body).toBe(201);
    const item = (await get(`/fee-assessments/${assessment.id}`)).json<{
      status: string;
      openCents: number;
      payments: unknown[];
    }>();
    expect(item.status).toBe('paid');
    expect(item.openCents).toBe(0);
    expect(item.payments).toHaveLength(2);
  });
  it('allocates a single payment to several assessments, including family memberships', async () => {
    const p = await newPlan({ amountCents: 2000 });
    const one = await newAssessment(p.id),
      two = await newAssessment(p.id, 2026, other.id);
    const r = await post('/payments', {
      ...pay(one.id, 3000),
      allocations: [
        { assessmentId: one.id, amountCents: 2000 },
        { assessmentId: two.id, amountCents: 1000 },
      ],
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json<Payment>().allocations).toHaveLength(2);
    expect((await get(`/fee-assessments/${two.id}`)).json<FeeAssessment>().openCents).toBe(1000);
  });
  it('supports bank transfer and other payment methods', async () => {
    const p = await newPlan({ amountCents: 4000 });
    const item = await newAssessment(p.id);
    for (const method of ['bank_transfer', 'other']) {
      const r = await post(
        '/payments',
        pay(item.id, 1000, {
          method,
          reference: method === 'bank_transfer' ? 'BANK-UNIQUE-1' : '',
        }),
      );
      expect(r.statusCode, r.body).toBe(201);
    }
    expect((await get(`/fee-assessments/${item.id}`)).json<FeeAssessment>().openCents).toBe(2000);
    expect(
      (
        await post(
          '/payments',
          pay(item.id, 1000, { method: 'bank_transfer', reference: 'BANK-UNIQUE-1' }),
        )
      ).statusCode,
    ).toBe(409);
  });
  it('rejects fractional/negative cents, duplicates and mismatched payment sums', async () => {
    expect((await post('/payments', pay(assessment.id, 0.5))).statusCode).toBe(422);
    expect((await post('/payments', pay(assessment.id, -1))).statusCode).toBe(422);
    expect(
      (
        await post('/payments', {
          ...pay(assessment.id, 100),
          allocations: [{ assessmentId: assessment.id, amountCents: 50 }],
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await post('/payments', {
          ...pay(assessment.id, 100),
          allocations: [
            { assessmentId: assessment.id, amountCents: 50 },
            { assessmentId: assessment.id, amountCents: 50 },
          ],
        })
      ).statusCode,
    ).toBe(422);
  });
  it('rejects overpayment and rolls back mixed valid/invalid allocation sets', async () => {
    const p = await newPlan({ amountCents: 500 }),
      item = await newAssessment(p.id);
    const before = await db.select().from(s.payments).where(eq(s.payments.organizationId, org));
    const r = await post('/payments', {
      ...pay(item.id, 600),
      allocations: [
        { assessmentId: item.id, amountCents: 100 },
        { assessmentId: foreignAssessment.id, amountCents: 500 },
      ],
    });
    expect(r.statusCode).toBe(404);
    expect((await get(`/fee-assessments/${item.id}`)).json<FeeAssessment>().paidCents).toBe(0);
    expect(
      (await db.select().from(s.payments).where(eq(s.payments.organizationId, org))).length,
    ).toBe(before.length);
    expect((await post('/payments', pay(item.id, 501))).statusCode).toBe(409);
  });
  it('returns exact aggregate cents as strings', async () => {
    const r = await get('/finance/summary?fiscalYear=2026');
    expect(r.statusCode, r.body).toBe(200);
    const data = r.json<FinanceSummary>();
    expect(BigInt(data.assessedCents) - BigInt(data.paidCents)).toBe(BigInt(data.openCents));
    expect(BigInt(data.overdueCents)).toBeLessThanOrEqual(BigInt(data.openCents));
  });
});
describe('idempotency and actual concurrent requests', () => {
  it('requires a UUID idempotency header on every finance mutation', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/fee-plans',
      headers: headers(admin),
      payload: planInput(),
    });
    expect(r.statusCode).toBe(422);
  });
  it('replays concurrent requests with one payment and one audit event', async () => {
    const p = await newPlan({ amountCents: 1200 }),
      item = await newAssessment(p.id),
      key = crypto.randomUUID(),
      input = pay(item.id, 300);
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => post('/payments', input, admin, key)),
    );
    expect(responses.map((r) => r.statusCode)).toEqual([201, 201, 201, 201]);
    expect(new Set(responses.map((r) => r.json<Payment>().id)).size).toBe(1);
    expect(responses.filter((r) => r.headers['idempotency-replayed'] === 'true')).toHaveLength(3);
    const id = responses[0]!.json<Payment>().id;
    expect(await db.select().from(s.auditLogs).where(eq(s.auditLogs.entityId, id))).toHaveLength(1);
    expect((await get(`/fee-assessments/${item.id}`)).json<FeeAssessment>().paidCents).toBe(300);
    expect((await post('/payments', pay(item.id, 301), admin, key)).statusCode).toBe(409);
  });
  it('replays plan, assessment, patch and reminder operations without duplicates', async () => {
    const key = crypto.randomUUID(),
      input = planInput();
    const first = await post('/fee-plans', input, admin, key),
      again = await post('/fee-plans', input, admin, key);
    expect(again.json()).toEqual(first.json());
    const p = first.json<FeePlan>(),
      ak = crypto.randomUUID(),
      ai = due(p.id);
    const a1 = await post('/fee-assessments', ai, treasurer, ak),
      a2 = await post('/fee-assessments', ai, treasurer, ak);
    expect(a2.json()).toEqual(a1.json());
    const pk = crypto.randomUUID();
    const patch = () =>
      app.inject({
        method: 'PATCH',
        url: `/api/v1/fee-plans/${p.id}`,
        headers: headers(admin, pk),
        payload: { version: 1, active: false },
      });
    expect((await patch()).json()).toEqual((await patch()).json());
    const rk = crypto.randomUUID(),
      id = a1.json<FeeAssessment>().id;
    const r1 = await post(`/fee-assessments/${id}/reminders`, {}, treasurer, rk),
      r2 = await post(`/fee-assessments/${id}/reminders`, {}, treasurer, rk);
    expect(r1.statusCode, r1.body).toBe(201);
    expect(r2.json()).toEqual(r1.json());
  });
  it('serializes competing payments so only one can consume the remaining balance', async () => {
    const p = await newPlan({ amountCents: 1000 }),
      item = await newAssessment(p.id);
    const results = await Promise.all([
      post('/payments', pay(item.id, 700)),
      post('/payments', pay(item.id, 700)),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const saved = (await get(`/fee-assessments/${item.id}`)).json<FeeAssessment>();
    expect(saved.paidCents).toBe(700);
    expect(saved.openCents).toBe(300);
  });
  it('serializes concurrent duplicate annual assessments', async () => {
    const p = await newPlan(),
      input = due(p.id);
    const results = await Promise.all([
      post('/fee-assessments', input),
      post('/fee-assessments', input),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  });
});
describe('authorization, PDFs and database backstops', () => {
  it('refuses financial reads for anonymous, board, project lead and ordinary member sessions', async () => {
    for (const cookie of ['', member, board, lead])
      for (const path of ['/fee-plans', '/fee-assessments', '/payments', '/finance/summary'])
        expect((await get(path, cookie)).statusCode).toBe(cookie ? 403 : 401);
  });
  it('limits tariff administration to admin while allowing the treasurer to read', async () => {
    expect((await get('/fee-plans', treasurer)).statusCode).toBe(200);
    expect((await post('/fee-plans', planInput(), treasurer)).statusCode).toBe(403);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/fee-plans/${plan.id}`,
          headers: headers(treasurer, crypto.randomUUID()),
          payload: { version: 2, active: false },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('rejects foreign finance IDs, contexts and links', async () => {
    for (const path of [
      `/fee-plans/${foreignPlan.id}`,
      `/fee-assessments/${foreignAssessment.id}`,
      `/payments/${payment.id}`,
      `/payments/${payment.id}/receipt`,
    ]) {
      const cookie = path.includes(payment.id) ? foreignAdmin : admin;
      expect((await get(path, cookie)).statusCode).toBe(404);
    }
    expect(
      (
        await app.inject({
          url: '/api/v1/payments',
          headers: headers(admin, undefined, foreignOrg),
        })
      ).statusCode,
    ).toBe(403);
    expect((await post('/fee-assessments', due(foreignPlan.id))).statusCode).toBe(404);
    expect((await post('/fee-assessments', due(plan.id, 2026, foreign.id))).statusCode).toBe(404);
    expect((await post('/payments', pay(foreignAssessment.id, 100))).statusCode).toBe(404);
  });
  it('produces real private PDFs in both languages and blocks unauthorized downloads', async () => {
    for (const language of ['de', 'it']) {
      const r = await get(`/payments/${payment.id}/receipt?language=${language}`, treasurer);
      expect(r.statusCode, r.body.slice(0, 200)).toBe(200);
      expect(r.headers['content-type']).toContain('application/pdf');
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
      expect(r.rawPayload.length).toBeGreaterThan(1000);
    }
    expect((await get(`/payments/${payment.id}/receipt`, member)).statusCode).toBe(403);
  });
  it('prepares reminder drafts without sending messages and protects their PDFs', async () => {
    const p = await newPlan(),
      item = await newAssessment(p.id);
    const r = await post(`/fee-assessments/${item.id}/reminders`, {}, treasurer);
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().status).toBe('prepared');
    const id = r.json().id;
    expect(
      (await get(`/fee-reminders/${id}/pdf?language=it`)).rawPayload.subarray(0, 5).toString(),
    ).toBe('%PDF-');
    expect((await get(`/fee-reminders/${id}/pdf`, foreignAdmin)).statusCode).toBe(404);
    expect((await get(`/fee-reminders/${id}/pdf`, member)).statusCode).toBe(403);
    expect((await post(`/fee-assessments/${assessment.id}/reminders`, {})).statusCode).toBe(409);
  });
  it('rejects raw database tampering with posted payment and allocation records', async () => {
    await expect(
      db.update(s.payments).set({ amountCents: 1 }).where(eq(s.payments.id, payment.id)),
    ).rejects.toThrow();
    await expect(
      db.delete(s.paymentAllocations).where(eq(s.paymentAllocations.paymentId, payment.id)),
    ).rejects.toThrow();
    await expect(
      db
        .update(s.membershipFeeAssessments)
        .set({ amountCents: 1 })
        .where(eq(s.membershipFeeAssessments.id, assessment.id)),
    ).rejects.toThrow();
  });
  it('rejects raw unallocated payments and cross-tenant allocations at commit', async () => {
    await expect(
      db.insert(s.payments).values({
        organizationId: org,
        receiptNumber: 999991,
        payerName: 'Raw',
        paidOn: '2026-10-29',
        method: 'cash',
        amountCents: 100,
        createdBy: adminId,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(s.paymentAllocations).values({
        organizationId: foreignOrg,
        paymentId: payment.id,
        assessmentId: foreignAssessment.id,
        amountCents: 1,
      }),
    ).rejects.toThrow();
  });
  it('rechecks current rights inside a financial transaction', async () => {
    const access = {
      organizationId: org,
      userId: adminId,
      role: 'admin',
      user: { id: adminId, name: 'Admin', email: 'finance-admin@example.test' },
      organizations: [],
    } satisfies Access;
    await db
      .update(s.organizationUserRoles)
      .set({ role: 'member' })
      .where(
        and(
          eq(s.organizationUserRoles.organizationId, org),
          eq(s.organizationUserRoles.userId, adminId),
        ),
      );
    try {
      await expect(
        createPlanService(db, access, crypto.randomUUID(), feePlanInputSchema.parse(planInput())),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    } finally {
      await db
        .update(s.organizationUserRoles)
        .set({ role: 'admin' })
        .where(
          and(
            eq(s.organizationUserRoles.organizationId, org),
            eq(s.organizationUserRoles.userId, adminId),
          ),
        );
    }
  });
  it('keeps audit and idempotency data free of passwords and snapshots of contact data', async () => {
    const logs = await db
      .select()
      .from(s.auditLogs)
      .where(and(eq(s.auditLogs.organizationId, org), eq(s.auditLogs.entityType, 'payment')));
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs)).not.toContain(password);
    expect(JSON.stringify(logs.map((l) => l.changeMetadata))).not.toContain('Familie Test');
  });
  it('also enforces overpayment rules for direct service callers', async () => {
    const access = {
      organizationId: org,
      userId: adminId,
      role: 'admin',
      user: { id: adminId, name: 'Admin', email: 'finance-admin@example.test' },
      organizations: [],
    } satisfies Access;
    const p = (
      await createPlanService(
        db,
        access,
        crypto.randomUUID(),
        feePlanInputSchema.parse(planInput({ amountCents: 100 })),
      )
    ).data;
    const item = (
      await createAssessmentService(
        db,
        access,
        crypto.randomUUID(),
        assessmentInputSchema.parse(due(p.id)),
      )
    ).data;
    await createPaymentService(
      db,
      access,
      crypto.randomUUID(),
      paymentInputSchema.parse(pay(item.id, 100)),
    );
    await expect(
      createPaymentService(
        db,
        access,
        crypto.randomUUID(),
        paymentInputSchema.parse(pay(item.id, 1)),
      ),
    ).rejects.toMatchObject({ code: 'OVERPAYMENT' });
  });
});

describe('additional financial backstops', () => {
  it('rejects financial writes from every unprivileged role', async () => {
    for (const cookie of [member, board, lead]) {
      expect((await post('/payments', pay(assessment.id, 1), cookie)).statusCode).toBe(403);
      expect((await post('/fee-assessments', due(plan.id, 2030), cookie)).statusCode).toBe(403);
      expect((await post('/fee-plans', planInput(), cookie)).statusCode).toBe(403);
    }
  });
  it('does not reuse an operation key for a different resource', async () => {
    const key = crypto.randomUUID();
    await post('/fee-plans', planInput(), admin, key);
    const response = await post('/payments', pay(assessment.id, 1), admin, key);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('IDEMPOTENCY_MISMATCH');
  });
  it('detects competing tariff updates with the same version', async () => {
    const p = await newPlan();
    const results = await Promise.all(
      ['first', 'second'].map((name) =>
        app.inject({
          method: 'PATCH',
          url: `/api/v1/fee-plans/${p.id}`,
          headers: headers(admin, crypto.randomUUID()),
          payload: { version: 1, description: name },
        }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect((await get(`/fee-plans/${p.id}`)).json<FeePlan>().version).toBe(2);
  });
  it('rejects incomplete allocations at deferred commit even when SQL bypasses the service', async () => {
    const p = await newPlan({ amountCents: 500 }),
      item = await newAssessment(p.id),
      id = crypto.randomUUID();
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(s.payments).values({
          id,
          organizationId: org,
          receiptNumber: 999992,
          payerName: 'Raw SQL',
          paidOn: '2026-10-29',
          method: 'cash',
          amountCents: 100,
          createdBy: adminId,
        });
        await tx
          .insert(s.paymentAllocations)
          .values({ organizationId: org, paymentId: id, assessmentId: item.id, amountCents: 50 });
      }),
    ).rejects.toThrow();
    expect(await db.select().from(s.payments).where(eq(s.payments.id, id))).toHaveLength(0);
  });
  it('serializes competing allocations even when SQL bypasses the service', async () => {
    const p = await newPlan({ amountCents: 500 }),
      item = await newAssessment(p.id);
    const results = await Promise.allSettled(
      [999993, 999994].map((receiptNumber) =>
        db.transaction(async (tx) => {
          const id = crypto.randomUUID();
          await tx.insert(s.payments).values({
            id,
            organizationId: org,
            receiptNumber,
            payerName: 'Raw SQL',
            paidOn: '2026-10-29',
            method: 'cash',
            amountCents: 400,
            createdBy: adminId,
          });
          await tx.insert(s.paymentAllocations).values({
            organizationId: org,
            paymentId: id,
            assessmentId: item.id,
            amountCents: 400,
          });
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((await get(`/fee-assessments/${item.id}`)).json<FeeAssessment>().paidCents).toBe(400);
  });
});

it('reports duplicate tariff names without changing an existing plan', async () => {
  const p = await newPlan();
  const r = await post('/fee-plans', planInput({ name: p.name }));
  expect(r.statusCode).toBe(409);
  expect(r.json().error.code).toBe('FEE_PLAN_EXISTS');
  expect((await get(`/fee-plans/${p.id}`)).json<FeePlan>().version).toBe(1);
});

it('documents protected PDF success and JSON error responses accurately', () => {
  const document = app.swagger();
  expect(document).toHaveProperty(
    'paths./api/v1/payments/{id}/receipt.get.responses.200.content.application/pdf',
  );
  expect(document).toHaveProperty(
    'paths./api/v1/payments/{id}/receipt.get.responses.403.content.application/json',
  );
  const text = JSON.stringify(document);
  expect(text).toContain('idempotency-key');
  expect(text).toContain('uuid');
});
