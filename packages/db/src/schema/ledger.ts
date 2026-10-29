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
  primaryKey,
  check,
} from 'drizzle-orm/pg-core';
import { organizations } from './core';
import { user } from './auth';
import { payments } from './finance';
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
export const accountKind = pgEnum('finance_account_kind', ['cash', 'bank']);
export const ledgerDirection = pgEnum('ledger_direction', ['income', 'expense']);
export const ledgerClassification = pgEnum('ledger_classification', [
  'membership_fee',
  'donation',
  'other',
]);
export const fiscalYearStatus = pgEnum('fiscal_year_status', ['open', 'closed']);
export const financeAccounts = pgTable(
  'finance_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    kind: accountKind('kind').notNull(),
    iban: text('iban').notNull().default(''),
    active: boolean('active').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique('finance_accounts_org_id_unique').on(t.organizationId, t.id),
    unique('finance_accounts_org_name_unique').on(t.organizationId, t.name),
    check('finance_account_name_valid', sql`length(trim(${t.name})) between 1 and 120`),
    check('finance_account_version_valid', sql`${t.version}>0`),
  ],
);
export const cashbookCategories = pgTable(
  'cashbook_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    direction: ledgerDirection('direction').notNull(),
    classification: ledgerClassification('classification').notNull().default('other'),
    active: boolean('active').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique('cashbook_categories_org_id_unique').on(t.organizationId, t.id),
    unique('cashbook_categories_org_id_direction_unique').on(t.organizationId, t.id, t.direction),
    unique('cashbook_categories_org_name_unique').on(t.organizationId, t.name),
    check('cashbook_category_name_valid', sql`length(trim(${t.name})) between 1 and 120`),
    check(
      'cashbook_category_classification_valid',
      sql`${t.direction}='income' or ${t.classification}='other'`,
    ),
    check('cashbook_category_version_valid', sql`${t.version}>0`),
  ],
);
export const fiscalYears = pgTable(
  'fiscal_years',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    year: integer('year').notNull(),
    status: fiscalYearStatus('status').notNull().default('open'),
    openedBy: uuid('opened_by')
      .notNull()
      .references(() => user.id),
    closedBy: uuid('closed_by').references(() => user.id),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [
    unique('fiscal_years_org_year_unique').on(t.organizationId, t.year),
    check('fiscal_year_valid', sql`${t.year} between 1900 and 2200`),
    check(
      'fiscal_year_closing_valid',
      sql`(${t.status}='open' and ${t.closedBy} is null and ${t.closedAt} is null) or (${t.status}='closed' and ${t.closedBy} is not null and ${t.closedAt} is not null)`,
    ),
  ],
);
export const fiscalYearOpeningBalances = pgTable(
  'fiscal_year_opening_balances',
  {
    organizationId: uuid('organization_id').notNull(),
    fiscalYear: integer('fiscal_year').notNull(),
    accountId: uuid('account_id').notNull(),
    amountCents: integer('amount_cents').notNull(),
    createdAt: created(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.fiscalYear, t.accountId] }),
    foreignKey({
      columns: [t.organizationId, t.fiscalYear],
      foreignColumns: [fiscalYears.organizationId, fiscalYears.year],
    }),
    foreignKey({
      columns: [t.organizationId, t.accountId],
      foreignColumns: [financeAccounts.organizationId, financeAccounts.id],
    }),
    check('opening_balance_amount_valid', sql`${t.amountCents} between -1000000000 and 1000000000`),
  ],
);
export const cashbookEntries = pgTable(
  'cashbook_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    fiscalYear: integer('fiscal_year').notNull(),
    entryNumber: integer('entry_number').notNull(),
    accountId: uuid('account_id').notNull(),
    categoryId: uuid('category_id').notNull(),
    direction: ledgerDirection('direction').notNull(),
    // Signed: original postings are positive, reversals negate the original amount.
    amountCents: integer('amount_cents').notNull(),
    bookingDate: date('booking_date').notNull(),
    documentDate: date('document_date').notNull(),
    documentNumber: text('document_number').notNull().default(''),
    description: text('description').notNull(),
    counterparty: text('counterparty').notNull().default(''),
    paymentId: uuid('payment_id'),
    reversesEntryId: uuid('reverses_entry_id'),
    reversalReason: text('reversal_reason').notNull().default(''),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: created(),
  },
  (t) => [
    unique('cashbook_entries_org_id_unique').on(t.organizationId, t.id),
    unique('cashbook_entries_number_unique').on(t.organizationId, t.fiscalYear, t.entryNumber),
    foreignKey({
      columns: [t.organizationId, t.fiscalYear],
      foreignColumns: [fiscalYears.organizationId, fiscalYears.year],
    }),
    foreignKey({
      columns: [t.organizationId, t.accountId],
      foreignColumns: [financeAccounts.organizationId, financeAccounts.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.categoryId, t.direction],
      foreignColumns: [
        cashbookCategories.organizationId,
        cashbookCategories.id,
        cashbookCategories.direction,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.paymentId],
      foreignColumns: [payments.organizationId, payments.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.reversesEntryId],
      foreignColumns: [t.organizationId, t.id],
    }),
    uniqueIndex('cashbook_entries_payment_unique')
      .on(t.organizationId, t.paymentId)
      .where(sql`${t.paymentId} is not null and ${t.reversesEntryId} is null`),
    uniqueIndex('cashbook_entries_reversal_unique')
      .on(t.organizationId, t.reversesEntryId)
      .where(sql`${t.reversesEntryId} is not null`),
    index('cashbook_entries_org_date_idx').on(t.organizationId, t.fiscalYear, t.bookingDate),
    check('cashbook_entry_number_valid', sql`${t.entryNumber}>0`),
    check(
      'cashbook_entry_year_valid',
      sql`extract(year from ${t.bookingDate})::integer=${t.fiscalYear}`,
    ),
    check(
      'cashbook_entry_amount_valid',
      sql`(${t.reversesEntryId} is null and ${t.amountCents} between 1 and 1000000000 and ${t.reversalReason}='') or (${t.reversesEntryId} is not null and ${t.amountCents} between -1000000000 and -1 and length(trim(${t.reversalReason}))>0)`,
    ),
    check(
      'cashbook_entry_description_valid',
      sql`length(trim(${t.description})) between 1 and 300`,
    ),
  ],
);
export const paymentReversals = pgTable(
  'payment_reversals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    paymentId: uuid('payment_id').notNull(),
    reversedOn: date('reversed_on').notNull(),
    reason: text('reason').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: created(),
  },
  (t) => [
    unique('payment_reversals_payment_unique').on(t.organizationId, t.paymentId),
    foreignKey({
      columns: [t.organizationId, t.paymentId],
      foreignColumns: [payments.organizationId, payments.id],
    }),
    check('payment_reversal_reason_valid', sql`length(trim(${t.reason})) between 1 and 500`),
  ],
);
export type ReportLine = {
  code: string;
  label: string;
  direction: 'income' | 'expense';
  categoryIds: string[];
};
export const financeReportTemplates = pgTable(
  'finance_report_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    templateKey: uuid('template_key').notNull(),
    version: integer('version').notNull(),
    name: text('name').notNull(),
    validFromYear: integer('valid_from_year').notNull(),
    validToYear: integer('valid_to_year'),
    revenueThresholdCents: integer('revenue_threshold_cents'),
    lines: jsonb('lines').$type<ReportLine[]>().notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: created(),
  },
  (t) => [
    unique('report_templates_org_id_unique').on(t.organizationId, t.id),
    unique('report_templates_version_unique').on(t.organizationId, t.templateKey, t.version),
    index('report_templates_org_key_idx').on(t.organizationId, t.templateKey),
    check('report_template_version_valid', sql`${t.version}>0`),
    check('report_template_name_valid', sql`length(trim(${t.name})) between 1 and 160`),
    check(
      'report_template_years_valid',
      sql`${t.validFromYear} between 1900 and 2200 and (${t.validToYear} is null or ${t.validToYear} between ${t.validFromYear} and 2200)`,
    ),
    check(
      'report_template_threshold_valid',
      sql`${t.revenueThresholdCents} is null or ${t.revenueThresholdCents} between 0 and 1000000000`,
    ),
  ],
);
