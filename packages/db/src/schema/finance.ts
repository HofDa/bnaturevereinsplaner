import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  timestamp,
  date,
  boolean,
  jsonb,
  unique,
  uniqueIndex,
  index,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { organizations, memberships, memberType } from './core';
import { user } from './auth';
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const feeInterval = pgEnum('fee_interval', ['annual', 'once']);
export const paymentMethod = pgEnum('payment_method', ['cash', 'bank_transfer', 'other']);
export const membershipFeePlans = pgTable(
  'membership_fee_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('EUR'),
    interval: feeInterval('interval').notNull(),
    membershipType: memberType('membership_type'),
    active: boolean('active').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: created(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('fee_plans_org_id_unique').on(t.organizationId, t.id),
    unique('fee_plans_org_name_unique').on(t.organizationId, t.name),
    index('fee_plans_org_active_idx').on(t.organizationId, t.active),
    check('fee_plan_amount_valid', sql`${t.amountCents} between 0 and 1000000000`),
    check('fee_plan_currency_valid', sql`${t.currency} = 'EUR'`),
    check('fee_plan_version_valid', sql`${t.version}>0`),
    check('fee_plan_name_valid', sql`length(trim(${t.name})) between 1 and 120`),
  ],
);
export const membershipFeeAssessments = pgTable(
  'membership_fee_assessments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    membershipId: uuid('membership_id').notNull(),
    planId: uuid('plan_id').notNull(),
    fiscalYear: integer('fiscal_year').notNull(),
    dueDate: date('due_date').notNull(),
    memberName: text('member_name').notNull(),
    membershipNumber: text('membership_number').notNull(),
    planName: text('plan_name').notNull(),
    interval: feeInterval('interval').notNull(),
    planAmountCents: integer('plan_amount_cents').notNull(),
    baseAmountCents: integer('base_amount_cents').notNull(),
    reductionCents: integer('reduction_cents').notNull().default(0),
    exempt: boolean('exempt').notNull().default(false),
    adjustmentReason: text('adjustment_reason').notNull().default(''),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('EUR'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: created(),
  },
  (t) => [
    unique('fee_assessments_org_id_unique').on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.membershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.planId],
      foreignColumns: [membershipFeePlans.organizationId, membershipFeePlans.id],
    }),
    uniqueIndex('fee_assessment_annual_unique')
      .on(t.organizationId, t.membershipId, t.planId, t.fiscalYear)
      .where(sql`${t.interval}='annual'`),
    uniqueIndex('fee_assessment_once_unique')
      .on(t.organizationId, t.membershipId, t.planId)
      .where(sql`${t.interval}='once'`),
    index('fee_assessments_org_due_idx').on(t.organizationId, t.fiscalYear, t.dueDate),
    index('fee_assessments_membership_idx').on(t.organizationId, t.membershipId),
    check('fee_assessment_year_valid', sql`${t.fiscalYear} between 1900 and 2200`),
    check(
      'fee_assessment_amounts_valid',
      sql`${t.planAmountCents} between 0 and 1000000000 and ${t.baseAmountCents} between 0 and 1000000000 and ${t.reductionCents} between 0 and ${t.baseAmountCents} and ${t.amountCents} between 0 and 1000000000`,
    ),
    check(
      'fee_assessment_net_valid',
      sql`${t.amountCents}=case when ${t.exempt} then 0 else ${t.baseAmountCents}-${t.reductionCents} end`,
    ),
    check(
      'fee_assessment_reason_valid',
      sql`(not ${t.exempt} and ${t.baseAmountCents}=${t.planAmountCents} and ${t.reductionCents}=0) or length(trim(${t.adjustmentReason}))>0`,
    ),
    check('fee_assessment_exemption_valid', sql`not ${t.exempt} or ${t.reductionCents}=0`),
    check('fee_assessment_currency_valid', sql`${t.currency}='EUR'`),
  ],
);
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    receiptNumber: integer('receipt_number').notNull(),
    payerName: text('payer_name').notNull(),
    paidOn: date('paid_on').notNull(),
    method: paymentMethod('method').notNull(),
    reference: text('reference').notNull().default(''),
    notes: text('notes').notNull().default(''),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('EUR'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: created(),
  },
  (t) => [
    unique('payments_org_id_unique').on(t.organizationId, t.id),
    unique('payments_org_receipt_unique').on(t.organizationId, t.receiptNumber),
    uniqueIndex('payments_org_bank_reference_unique')
      .on(t.organizationId, t.reference)
      .where(sql`${t.method}='bank_transfer' and ${t.reference}<>''`),
    index('payments_org_paid_idx').on(t.organizationId, t.paidOn),
    check('payment_amount_valid', sql`${t.amountCents} between 1 and 1000000000`),
    check('payment_currency_valid', sql`${t.currency}='EUR'`),
    check('payment_receipt_valid', sql`${t.receiptNumber}>0`),
    check('payment_payer_valid', sql`length(trim(${t.payerName})) between 1 and 160`),
  ],
);
export const paymentAllocations = pgTable(
  'payment_allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    paymentId: uuid('payment_id').notNull(),
    assessmentId: uuid('assessment_id').notNull(),
    amountCents: integer('amount_cents').notNull(),
    createdAt: created(),
  },
  (t) => [
    unique('payment_allocation_pair_unique').on(t.paymentId, t.assessmentId),
    foreignKey({
      columns: [t.organizationId, t.paymentId],
      foreignColumns: [payments.organizationId, payments.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.assessmentId],
      foreignColumns: [membershipFeeAssessments.organizationId, membershipFeeAssessments.id],
    }),
    index('payment_allocations_assessment_idx').on(t.organizationId, t.assessmentId),
    check('payment_allocation_amount_valid', sql`${t.amountCents} between 1 and 1000000000`),
  ],
);
export const financeOperations = pgTable(
  'finance_operations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    idempotencyKey: uuid('idempotency_key').notNull(),
    operation: text('operation').notNull(),
    requestHash: text('request_hash').notNull(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => user.id),
    response: jsonb('response').$type<Record<string, unknown>>().notNull(),
    createdAt: created(),
  },
  (t) => [
    unique('finance_operations_key_unique').on(t.organizationId, t.idempotencyKey),
    index('finance_operations_org_created_idx').on(t.organizationId, t.createdAt),
    check('finance_operation_hash_valid', sql`${t.requestHash} ~ '^[0-9a-f]{64}$'`),
  ],
);
export const membershipFeeReminders = pgTable(
  'membership_fee_reminders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    assessmentId: uuid('assessment_id').notNull(),
    sequence: integer('sequence').notNull(),
    openCents: integer('open_cents').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: created(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.assessmentId],
      foreignColumns: [membershipFeeAssessments.organizationId, membershipFeeAssessments.id],
    }),
    unique('fee_reminders_sequence_unique').on(t.organizationId, t.assessmentId, t.sequence),
    check('fee_reminder_amount_valid', sql`${t.openCents} between 1 and 1000000000`),
    check('fee_reminder_sequence_valid', sql`${t.sequence}>0`),
  ],
);
