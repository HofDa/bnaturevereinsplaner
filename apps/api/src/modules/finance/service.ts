import { and, eq, sql, asc, desc, count, ilike, or, gte, lt, isNull, type SQL } from 'drizzle-orm';
import { schema as s, type Database, type Executor } from '@bnature/db';
import {
  feePlanResponseSchema,
  assessmentResponseSchema,
  paymentResponseSchema,
  reminderResponseSchema,
  financeSummarySchema,
  feePlanInputSchema,
  type FeePlanInput,
  type FeePlanPatch,
  type AssessmentInput,
  type PaymentInput,
  type FinanceListQuery,
  type FeeAssessment,
  type Page,
  type FeePlan,
  type Payment,
} from '@bnature/contracts';
import { HttpError, type Access } from '../../middleware/access';
import { audit } from '../../services/audit';
import { wire } from '../responses';
import { escapeLike } from '../members';
import { financialOperation } from './operations';
import { bookPayment } from './ledger';

export async function businessDate(
  db: Executor,
  organizationId: string,
  now = new Date(),
): Promise<string> {
  const [org] = await db
    .select({ timezone: s.organizations.timezone })
    .from(s.organizations)
    .where(eq(s.organizations.id, organizationId));
  if (!org) throw new HttpError(404, 'NOT_FOUND', 'Organisation nicht gefunden.');
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: org.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
const a = s.membershipFeeAssessments;
// Allocations of reversed payments no longer settle an assessment.
const paid = sql<number>`coalesce((select sum(pa.amount_cents) from payment_allocations pa where pa.organization_id="membership_fee_assessments"."organization_id" and pa.assessment_id="membership_fee_assessments"."id" and not exists(select 1 from payment_reversals pr where pr.organization_id=pa.organization_id and pr.payment_id=pa.payment_id)),0)::integer`;
const reversed = (payment: typeof s.payments) =>
  sql<boolean>`exists(select 1 from payment_reversals pr where pr.organization_id=${payment.organizationId} and pr.payment_id=${payment.id})`;
const open = sql<number>`${a.amountCents}-${paid}`;
const assessmentSelect = {
  id: a.id,
  membershipId: a.membershipId,
  planId: a.planId,
  fiscalYear: a.fiscalYear,
  dueDate: a.dueDate,
  memberName: a.memberName,
  membershipNumber: a.membershipNumber,
  planName: a.planName,
  interval: a.interval,
  planAmountCents: a.planAmountCents,
  baseAmountCents: a.baseAmountCents,
  reductionCents: a.reductionCents,
  exempt: a.exempt,
  adjustmentReason: a.adjustmentReason,
  amountCents: a.amountCents,
  currency: a.currency,
  createdAt: a.createdAt,
  paidCents: paid,
};
type AssessmentRow = { amountCents: number; paidCents: number; exempt: boolean; dueDate: string };
export function assessmentState(row: AssessmentRow, today: string) {
  const openCents = row.amountCents - row.paidCents;
  return {
    openCents,
    status: row.exempt
      ? ('exempt' as const)
      : openCents === 0
        ? ('paid' as const)
        : row.paidCents > 0
          ? ('partial' as const)
          : ('open' as const),
    overdue: openCents > 0 && row.dueDate < today,
  };
}
function assessmentWhere(org: string, q: FinanceListQuery, today: string) {
  let status: SQL | undefined;
  if (q.status === 'paid') status = and(eq(a.exempt, false), sql`${open}=0`);
  if (q.status === 'exempt') status = eq(a.exempt, true);
  if (q.status === 'open') status = sql`${paid}=0 and ${a.amountCents}>0`;
  if (q.status === 'partial') status = sql`${paid}>0 and ${open}>0`;
  if (q.status === 'outstanding') status = sql`${open}>0`;
  if (q.status === 'overdue') status = sql`${open}>0 and ${a.dueDate}<${today}::date`;
  return and(
    eq(a.organizationId, org),
    q.fiscalYear ? eq(a.fiscalYear, q.fiscalYear) : undefined,
    q.membershipId ? eq(a.membershipId, q.membershipId) : undefined,
    q.planId ? eq(a.planId, q.planId) : undefined,
    status,
    q.search
      ? or(
          ilike(a.memberName, `%${escapeLike(q.search)}%`),
          ilike(a.membershipNumber, `%${escapeLike(q.search)}%`),
          ilike(a.planName, `%${escapeLike(q.search)}%`),
        )
      : undefined,
  );
}
export async function getAssessment(
  db: Executor,
  org: string,
  id: string,
  today?: string,
): Promise<FeeAssessment> {
  const [row] = await db
    .select(assessmentSelect)
    .from(a)
    .where(and(eq(a.organizationId, org), eq(a.id, id)));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Forderung nicht gefunden.');
  return assessmentResponseSchema.parse({
    ...wire(row),
    ...assessmentState(row, today ?? (await businessDate(db, org))),
  });
}
export async function getAssessmentDetail(db: Database, org: string, id: string) {
  return db.transaction(
    async (tx) => {
      const item = await getAssessment(tx, org, id);
      const payments = await tx
        .select({
          paymentId: s.payments.id,
          receiptNumber: s.payments.receiptNumber,
          paidOn: s.payments.paidOn,
          method: s.payments.method,
          amountCents: s.paymentAllocations.amountCents,
          reversed: reversed(s.payments),
        })
        .from(s.paymentAllocations)
        .innerJoin(
          s.payments,
          and(
            eq(s.payments.id, s.paymentAllocations.paymentId),
            eq(s.payments.organizationId, s.paymentAllocations.organizationId),
          ),
        )
        .where(
          and(
            eq(s.paymentAllocations.organizationId, org),
            eq(s.paymentAllocations.assessmentId, id),
          ),
        )
        .orderBy(asc(s.payments.createdAt), asc(s.payments.id));
      return { ...item, payments };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
export async function listAssessments(
  db: Database,
  org: string,
  q: FinanceListQuery,
): Promise<Page<FeeAssessment>> {
  return db.transaction(
    async (tx) => {
      const today = await businessDate(tx, org),
        where = assessmentWhere(org, q, today),
        order = q.direction === 'asc' ? asc : desc;
      const sort =
        q.sort === 'name'
          ? a.memberName
          : q.sort === 'amountCents'
            ? a.amountCents
            : q.sort === 'dueDate'
              ? a.dueDate
              : a.createdAt;
      const rows = await tx
        .select(assessmentSelect)
        .from(a)
        .where(where)
        .orderBy(order(sort), asc(a.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
      const [total] = await tx.select({ n: count() }).from(a).where(where);
      return {
        items: rows.map((row) =>
          assessmentResponseSchema.parse({ ...wire(row), ...assessmentState(row, today) }),
        ),
        total: total?.n ?? 0,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
export async function financeSummary(db: Database, org: string, year?: number) {
  const today = await businessDate(db, org);
  const [row] = await db
    .select({
      assessedCents: sql<string>`coalesce(sum(${a.amountCents}),0)::text`,
      paidCents: sql<string>`coalesce(sum(${paid}),0)::text`,
      openCents: sql<string>`coalesce(sum(${open}),0)::text`,
      overdueCents: sql<string>`coalesce(sum(case when ${a.dueDate}<${today}::date then ${open} else 0 end),0)::text`,
      assessmentCount: count(),
      openCount: sql<number>`count(*) filter(where ${open}>0)::int`,
      paidCount: sql<number>`count(*) filter(where ${open}=0 and not ${a.exempt})::int`,
      exemptCount: sql<number>`count(*) filter(where ${a.exempt})::int`,
    })
    .from(a)
    .where(and(eq(a.organizationId, org), year ? eq(a.fiscalYear, year) : undefined));
  return financeSummarySchema.parse({ ...row, currency: 'EUR' });
}
export async function listPlans(
  db: Database,
  org: string,
  q: FinanceListQuery,
): Promise<Page<FeePlan>> {
  const t = s.membershipFeePlans,
    where = and(
      eq(t.organizationId, org),
      q.active ? eq(t.active, q.active === 'true') : undefined,
      q.membershipType ? eq(t.membershipType, q.membershipType) : undefined,
      q.search
        ? or(
            ilike(t.name, `%${escapeLike(q.search)}%`),
            ilike(t.description, `%${escapeLike(q.search)}%`),
          )
        : undefined,
    ),
    order = q.direction === 'asc' ? asc : desc;
  return db.transaction(
    async (tx) => {
      const rows = await tx
        .select()
        .from(t)
        .where(where)
        .orderBy(
          order(
            q.sort === 'amountCents'
              ? t.amountCents
              : q.sort === 'createdAt'
                ? t.createdAt
                : t.name,
          ),
          asc(t.id),
        )
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
      const [total] = await tx.select({ n: count() }).from(t).where(where);
      return {
        items: rows.map((r) => feePlanResponseSchema.parse(wire(r))),
        total: total?.n ?? 0,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
export async function getPlan(db: Executor, org: string, id: string) {
  const [row] = await db
    .select()
    .from(s.membershipFeePlans)
    .where(and(eq(s.membershipFeePlans.organizationId, org), eq(s.membershipFeePlans.id, id)));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Tarif nicht gefunden.');
  return feePlanResponseSchema.parse(wire(row));
}
async function assertPlanNameFree(
  db: Executor,
  organizationId: string,
  name: string,
  exceptId?: string,
) {
  const [existing] = await db
    .select({ id: s.membershipFeePlans.id })
    .from(s.membershipFeePlans)
    .where(
      and(
        eq(s.membershipFeePlans.organizationId, organizationId),
        eq(s.membershipFeePlans.name, name),
      ),
    );
  if (existing && existing.id !== exceptId)
    throw new HttpError(409, 'FEE_PLAN_EXISTS', 'Ein Tarif mit diesem Namen existiert bereits.');
}
export function createPlan(db: Database, access: Access, key: string, input: FeePlanInput) {
  return financialOperation(
    db,
    access,
    key,
    'fee-plans:create',
    input,
    'finance:plans',
    async (tx) => {
      await assertPlanNameFree(tx, access.organizationId, input.name);
      const [row] = await tx
        .insert(s.membershipFeePlans)
        .values({ ...input, organizationId: access.organizationId })
        .returning();
      await audit(tx, access, 'create', 'membership_fee_plan', row!.id, Object.keys(input));
      return feePlanResponseSchema.parse(wire(row));
    },
  );
}
export function updatePlan(
  db: Database,
  access: Access,
  key: string,
  id: string,
  input: FeePlanPatch,
) {
  return financialOperation(
    db,
    access,
    key,
    `fee-plans:update:${id}`,
    input,
    'finance:plans',
    async (tx) => {
      const current = await getPlan(tx, access.organizationId, id);
      if (current.version !== input.version)
        throw new HttpError(409, 'STALE_VERSION', 'Der Tarif wurde zwischenzeitlich geändert.');
      if (input.interval && input.interval !== current.interval) {
        const [used] = await tx
          .select({ id: a.id })
          .from(a)
          .where(and(eq(a.organizationId, access.organizationId), eq(a.planId, id)))
          .limit(1);
        if (used)
          throw new HttpError(
            409,
            'PLAN_IN_USE',
            'Die Periodizität eines verwendeten Tarifs ist festgeschrieben.',
          );
      }
      const { version, ...patch } = input;
      const merged = feePlanInputSchema.parse({
        ...Object.fromEntries(
          Object.keys(feePlanInputSchema.shape).map((k) => [k, current[k as keyof typeof current]]),
        ),
        ...patch,
      });
      await assertPlanNameFree(tx, access.organizationId, merged.name, id);
      const [row] = await tx
        .update(s.membershipFeePlans)
        .set({ ...merged, version: version + 1, updatedAt: new Date() })
        .where(
          and(
            eq(s.membershipFeePlans.organizationId, access.organizationId),
            eq(s.membershipFeePlans.id, id),
          ),
        )
        .returning();
      await audit(tx, access, 'update', 'membership_fee_plan', id, Object.keys(patch));
      return feePlanResponseSchema.parse(wire(row));
    },
  );
}
export function createAssessment(
  db: Database,
  access: Access,
  key: string,
  input: AssessmentInput,
) {
  return financialOperation(
    db,
    access,
    key,
    'fee-assessments:create',
    input,
    'finance:write',
    async (tx) => {
      const plan = await getPlan(tx, access.organizationId, input.planId);
      if (!plan.active) throw new HttpError(409, 'PLAN_INACTIVE', 'Dieser Tarif ist deaktiviert.');
      const [member] = await tx
        .select({
          id: s.memberships.id,
          membershipType: s.memberships.membershipType,
          membershipNumber: s.memberships.membershipNumber,
          firstName: s.persons.firstName,
          lastName: s.persons.lastName,
        })
        .from(s.memberships)
        .innerJoin(
          s.persons,
          and(
            eq(s.persons.id, s.memberships.personId),
            eq(s.persons.organizationId, s.memberships.organizationId),
          ),
        )
        .where(
          and(
            eq(s.memberships.organizationId, access.organizationId),
            eq(s.memberships.id, input.membershipId),
          ),
        )
        .for('share', { of: s.memberships });
      if (!member) throw new HttpError(404, 'NOT_FOUND', 'Mitglied nicht gefunden.');
      if (plan.membershipType && plan.membershipType !== member.membershipType)
        throw new HttpError(
          422,
          'FEE_CATEGORY_MISMATCH',
          'Tarif und Mitgliedskategorie passen nicht zusammen.',
        );
      const base = input.individualAmountCents ?? plan.amountCents;
      if (input.reductionCents > base)
        throw new HttpError(
          422,
          'INVALID_REDUCTION',
          'Die Ermäßigung überschreitet den Grundbetrag.',
        );
      const [exists] = await tx
        .select({ id: a.id })
        .from(a)
        .where(
          and(
            eq(a.organizationId, access.organizationId),
            eq(a.membershipId, member.id),
            eq(a.planId, plan.id),
            plan.interval === 'annual' ? eq(a.fiscalYear, input.fiscalYear) : undefined,
          ),
        )
        .limit(1);
      if (exists)
        throw new HttpError(409, 'ASSESSMENT_EXISTS', 'Diese Beitragsforderung existiert bereits.');
      const [row] = await tx
        .insert(a)
        .values({
          organizationId: access.organizationId,
          membershipId: member.id,
          planId: plan.id,
          fiscalYear: input.fiscalYear,
          dueDate: input.dueDate,
          memberName: `${member.firstName} ${member.lastName}`,
          membershipNumber: member.membershipNumber,
          planName: plan.name,
          interval: plan.interval,
          planAmountCents: plan.amountCents,
          baseAmountCents: base,
          reductionCents: input.reductionCents,
          exempt: input.exempt,
          adjustmentReason: input.adjustmentReason,
          amountCents: input.exempt ? 0 : base - input.reductionCents,
          createdBy: access.userId,
        })
        .returning({ id: a.id });
      await audit(tx, access, 'create', 'membership_fee_assessment', row!.id, Object.keys(input));
      return getAssessment(tx, access.organizationId, row!.id);
    },
  );
}
export async function getPayment(db: Executor, org: string, id: string): Promise<Payment> {
  const [payment] = await db
    .select()
    .from(s.payments)
    .where(and(eq(s.payments.organizationId, org), eq(s.payments.id, id)));
  if (!payment) throw new HttpError(404, 'NOT_FOUND', 'Zahlung nicht gefunden.');
  const [reversal] = await db
    .select({
      reversedOn: s.paymentReversals.reversedOn,
      reason: s.paymentReversals.reason,
      createdAt: s.paymentReversals.createdAt,
    })
    .from(s.paymentReversals)
    .where(and(eq(s.paymentReversals.organizationId, org), eq(s.paymentReversals.paymentId, id)));
  const [entry] = await db
    .select({ id: s.cashbookEntries.id })
    .from(s.cashbookEntries)
    .where(
      and(
        eq(s.cashbookEntries.organizationId, org),
        eq(s.cashbookEntries.paymentId, id),
        isNull(s.cashbookEntries.reversesEntryId),
      ),
    );
  const allocations = await db
    .select({
      assessmentId: s.paymentAllocations.assessmentId,
      amountCents: s.paymentAllocations.amountCents,
      memberName: a.memberName,
      membershipNumber: a.membershipNumber,
      planName: a.planName,
      fiscalYear: a.fiscalYear,
    })
    .from(s.paymentAllocations)
    .innerJoin(
      a,
      and(
        eq(a.id, s.paymentAllocations.assessmentId),
        eq(a.organizationId, s.paymentAllocations.organizationId),
      ),
    )
    .where(
      and(eq(s.paymentAllocations.organizationId, org), eq(s.paymentAllocations.paymentId, id)),
    )
    .orderBy(asc(a.id));
  return paymentResponseSchema.parse({
    ...wire(payment),
    allocations,
    status: reversal ? 'reversed' : 'posted',
    reversal: reversal ? wire(reversal) : null,
    cashbookEntryId: entry?.id ?? null,
  });
}
export async function listPayments(
  db: Database,
  org: string,
  q: FinanceListQuery,
): Promise<Page<Payment>> {
  const t = s.payments,
    order = q.direction === 'asc' ? asc : desc;
  const where = and(
    eq(t.organizationId, org),
    q.fiscalYear
      ? and(gte(t.paidOn, `${q.fiscalYear}-01-01`), lt(t.paidOn, `${q.fiscalYear + 1}-01-01`))
      : undefined,
    q.search
      ? or(
          ilike(t.payerName, `%${escapeLike(q.search)}%`),
          ilike(t.reference, `%${escapeLike(q.search)}%`),
        )
      : undefined,
  );
  return db.transaction(
    async (tx) => {
      const rows = await tx
        .select({ id: t.id })
        .from(t)
        .where(where)
        .orderBy(
          order(
            q.sort === 'amountCents'
              ? t.amountCents
              : q.sort === 'name'
                ? t.payerName
                : q.sort === 'createdAt'
                  ? t.createdAt
                  : t.paidOn,
          ),
          asc(t.id),
        )
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
      const [total] = await tx.select({ n: count() }).from(t).where(where);
      const items: Payment[] = [];
      for (const row of rows) items.push(await getPayment(tx, org, row.id));
      return { items, total: total?.n ?? 0, page: q.page, pageSize: q.pageSize };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
export function createPayment(db: Database, access: Access, key: string, input: PaymentInput) {
  // Requests without booking hash exactly like Sprint 2.1 requests did.
  const { booking, ...rest } = input;
  const normalized = {
    ...rest,
    ...(booking ? { booking } : {}),
    allocations: [...input.allocations].sort((a, b) =>
      a.assessmentId.localeCompare(b.assessmentId),
    ),
  };
  return financialOperation(
    db,
    access,
    key,
    'payments:create',
    normalized,
    'finance:write',
    async (tx) => {
      // Validate the whole allocation set before inserting any payment; all writes share the org lock.
      for (const allocation of normalized.allocations) {
        const assessment = await getAssessment(tx, access.organizationId, allocation.assessmentId);
        if (allocation.amountCents > assessment.openCents)
          throw new HttpError(
            409,
            'OVERPAYMENT',
            'Die Zuordnung überschreitet den offenen Betrag. Bitte Daten neu laden.',
          );
      }
      if (input.method === 'bank_transfer' && input.reference) {
        const [duplicate] = await tx
          .select({ id: s.payments.id })
          .from(s.payments)
          .where(
            and(
              eq(s.payments.organizationId, access.organizationId),
              eq(s.payments.method, 'bank_transfer'),
              eq(s.payments.reference, input.reference),
              sql`not ${reversed(s.payments)}`,
            ),
          );
        if (duplicate)
          throw new HttpError(
            409,
            'PAYMENT_REFERENCE_EXISTS',
            'Diese Bankreferenz wurde bereits verbucht.',
          );
      }
      const [sequence] = await tx
        .select({ next: sql<number>`coalesce(max(${s.payments.receiptNumber}),0)+1` })
        .from(s.payments)
        .where(eq(s.payments.organizationId, access.organizationId));
      const { allocations } = normalized,
        { payerName, paidOn, method, reference, notes, amountCents } = rest,
        payment = { payerName, paidOn, method, reference, notes, amountCents };
      const [row] = await tx
        .insert(s.payments)
        .values({
          ...payment,
          organizationId: access.organizationId,
          receiptNumber: sequence!.next,
          createdBy: access.userId,
        })
        .returning({ id: s.payments.id });
      await tx.insert(s.paymentAllocations).values(
        allocations.map((item) => ({
          ...item,
          organizationId: access.organizationId,
          paymentId: row!.id,
        })),
      );
      await audit(tx, access, 'create', 'payment', row!.id, [
        'amountCents',
        'paidOn',
        'method',
        'payerName',
        'reference',
        'notes',
        'allocations',
      ]);
      if (booking) await bookPayment(tx, access, row!.id, booking);
      return getPayment(tx, access.organizationId, row!.id);
    },
  );
}
export function createReminder(db: Database, access: Access, key: string, id: string) {
  return financialOperation(
    db,
    access,
    key,
    `fee-reminders:create:${id}`,
    {},
    'finance:write',
    async (tx) => {
      const assessment = await getAssessment(tx, access.organizationId, id);
      if (!assessment.overdue || assessment.openCents <= 0)
        throw new HttpError(
          409,
          'REMINDER_NOT_DUE',
          'Nur offene überfällige Forderungen können erinnert werden.',
        );
      const t = s.membershipFeeReminders;
      const [sequence] = await tx
        .select({ next: sql<number>`coalesce(max(${t.sequence}),0)+1` })
        .from(t)
        .where(and(eq(t.organizationId, access.organizationId), eq(t.assessmentId, id)));
      const [row] = await tx
        .insert(t)
        .values({
          organizationId: access.organizationId,
          assessmentId: id,
          sequence: sequence!.next,
          openCents: assessment.openCents,
          createdBy: access.userId,
        })
        .returning();
      await audit(tx, access, 'prepare', 'membership_fee_reminder', row!.id, [
        'assessmentId',
        'openCents',
      ]);
      return reminderResponseSchema.parse({ ...wire(row), status: 'prepared' });
    },
  );
}
