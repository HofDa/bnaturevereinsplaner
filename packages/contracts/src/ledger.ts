import { z } from 'zod';
import { idSchema, patchSchema, languageSchema } from './common';
import { MAX_CENTS, positiveCentsSchema, fiscalYearSchema, centsSchema } from './finance';

export const accountKindSchema = z.enum(['cash', 'bank']);
export const ledgerDirectionSchema = z.enum(['income', 'expense']);
export const ledgerClassificationSchema = z.enum(['membership_fee', 'donation', 'other']);
export const signedCentsSchema = z.number().int().min(-MAX_CENTS).max(MAX_CENTS);
// Aggregates may exceed the JS safe integer range and may be negative.
export const signedTotalSchema = z.string().regex(/^-?\d+$/);
const versioned = { version: z.number().int().min(1) };

export const accountInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: accountKindSchema,
    iban: z
      .string()
      .trim()
      .toUpperCase()
      .transform((v) => v.replaceAll(' ', ''))
      .refine((v) => !v || /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v), 'ledgerInvalidIban')
      .default(''),
    active: z.boolean().default(true),
  })
  .strict();
export const accountPatchSchema = patchSchema(accountInputSchema.omit({ kind: true })).extend(
  versioned,
);
export const accountResponseSchema = z.object({
  id: idSchema,
  name: z.string(),
  kind: accountKindSchema,
  iban: z.string(),
  active: z.boolean(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AccountInput = z.infer<typeof accountInputSchema>;
export type AccountPatch = z.infer<typeof accountPatchSchema>;
export type FinanceAccount = z.infer<typeof accountResponseSchema>;

export const categoryInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    direction: ledgerDirectionSchema,
    classification: ledgerClassificationSchema.default('other'),
    active: z.boolean().default(true),
  })
  .strict()
  .refine((v) => v.direction === 'income' || v.classification === 'other', {
    path: ['classification'],
    message: 'ledgerClassificationIncomeOnly',
  });
export const categoryPatchSchema = z
  .object({ name: z.string().trim().min(1).max(120), active: z.boolean() })
  .strict()
  .partial()
  .extend(versioned);
export const categoryResponseSchema = z.object({
  id: idSchema,
  name: z.string(),
  direction: ledgerDirectionSchema,
  classification: ledgerClassificationSchema,
  active: z.boolean(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CategoryInput = z.infer<typeof categoryInputSchema>;
export type CategoryPatch = z.infer<typeof categoryPatchSchema>;
export type CashbookCategory = z.infer<typeof categoryResponseSchema>;

export const fiscalYearInputSchema = z
  .object({
    year: fiscalYearSchema,
    startsOn: z.iso.date().optional(),
    endsOn: z.iso.date().optional(),
    // Omitted: carried forward from the previous fiscal year, or zero for the first year.
    openingBalances: z
      .array(z.object({ accountId: idSchema, amountCents: signedCentsSchema }).strict())
      .max(100)
      .optional(),
  })
  .strict()
  .refine(
    (v) =>
      !v.openingBalances ||
      new Set(v.openingBalances.map((b) => b.accountId)).size === v.openingBalances.length,
    { path: ['openingBalances'], message: 'ledgerDuplicateAccount' },
  );
export type FiscalYearInput = z.infer<typeof fiscalYearInputSchema>;
export const accountBalanceSchema = z.object({
  accountId: idSchema,
  name: z.string(),
  kind: accountKindSchema,
  transferCents: signedTotalSchema.default('0'),
  openingCents: signedTotalSchema,
  incomeCents: signedTotalSchema,
  expenseCents: signedTotalSchema,
  closingCents: signedTotalSchema,
});
export type AccountBalance = z.infer<typeof accountBalanceSchema>;
export const fiscalYearResponseSchema = z.object({
  id: idSchema,
  year: fiscalYearSchema,
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
  status: z.enum(['open', 'closed']),
  createdAt: z.string(),
  closedAt: z.string().nullable(),
  // True when an opening balance differs from the previous year's current closing balance.
  openingMismatch: z.boolean(),
  balances: z.array(accountBalanceSchema),
});
export type FiscalYear = z.infer<typeof fiscalYearResponseSchema>;
export const yearParams = z.object({ year: z.coerce.number().int().min(1900).max(2200) });

const entryFields = {
  accountId: idSchema,
  categoryId: idSchema,
  project: z.string().trim().max(160).default(''),
  amountCents: positiveCentsSchema,
  bookingDate: z.iso.date(),
  documentDate: z.iso.date(),
  documentNumber: z.string().trim().max(60).default(''),
  description: z.string().trim().min(1).max(300),
  counterparty: z.string().trim().max(160).default(''),
};
export const cashbookEntryInputSchema = z.object(entryFields).strict();
export type CashbookEntryInput = z.infer<typeof cashbookEntryInputSchema>;
export const reversalInputSchema = z
  .object({ bookingDate: z.iso.date(), reason: z.string().trim().min(1).max(500) })
  .strict();
export type ReversalInput = z.infer<typeof reversalInputSchema>;
export const cashbookEntryResponseSchema = z.object({
  id: idSchema,
  fiscalYear: fiscalYearSchema,
  entryNumber: z.number().int().positive(),
  accountId: idSchema,
  accountName: z.string(),
  categoryId: idSchema,
  categoryName: z.string(),
  project: z.string().default(''),
  etsPosition: z.string().nullable().default(null),
  etsDefinitionVersion: z.string().nullable().default(null),
  classification: ledgerClassificationSchema,
  direction: ledgerDirectionSchema,
  amountCents: signedCentsSchema,
  bookingDate: z.iso.date(),
  documentDate: z.iso.date(),
  documentNumber: z.string(),
  description: z.string(),
  counterparty: z.string(),
  paymentId: idSchema.nullable(),
  reversesEntryId: idSchema.nullable(),
  reversalReason: z.string(),
  reversedByEntryId: idSchema.nullable(),
  createdAt: z.string(),
});
export type CashbookEntry = z.infer<typeof cashbookEntryResponseSchema>;
export const cashbookQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).default(''),
  fiscalYear: z.coerce.number().int().min(1900).max(2200).optional(),
  accountId: idSchema.optional(),
  categoryId: idSchema.optional(),
  direction: ledgerDirectionSchema.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  project: z.string().trim().max(160).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type CashbookQuery = z.infer<typeof cashbookQuerySchema>;

export const paymentReversalInputSchema = z
  .object({ reversedOn: z.iso.date(), reason: z.string().trim().min(1).max(500) })
  .strict();
export type PaymentReversalInput = z.infer<typeof paymentReversalInputSchema>;

export const reportLineSchema = z
  .object({
    code: z.string().trim().min(1).max(20),
    label: z.string().trim().min(1).max(200),
    direction: ledgerDirectionSchema,
    categoryIds: z.array(idSchema).max(200),
  })
  .strict();
export const reportTemplateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    validFromYear: fiscalYearSchema,
    validToYear: fiscalYearSchema.nullable().default(null),
    revenueThresholdCents: centsSchema.nullable().default(null),
    lines: z.array(reportLineSchema).min(1).max(200),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.validToYear !== null && v.validToYear < v.validFromYear)
      ctx.addIssue({ code: 'custom', path: ['validToYear'], message: 'endBeforeStart' });
    const codes = v.lines.map((l) => l.code);
    if (new Set(codes).size !== codes.length)
      ctx.addIssue({ code: 'custom', path: ['lines'], message: 'ledgerDuplicateLine' });
    const categories = v.lines.flatMap((l) => l.categoryIds);
    if (new Set(categories).size !== categories.length)
      ctx.addIssue({ code: 'custom', path: ['lines'], message: 'ledgerCategoryMappedTwice' });
  });
export type ReportTemplateInput = z.infer<typeof reportTemplateInputSchema>;
export const reportTemplateVersionInputSchema = z
  .object({ template: reportTemplateInputSchema, ...versioned })
  .strict();
export const reportTemplateResponseSchema = z.object({
  id: idSchema,
  templateKey: idSchema,
  version: z.number().int().positive(),
  name: z.string(),
  validFromYear: fiscalYearSchema,
  validToYear: fiscalYearSchema.nullable(),
  revenueThresholdCents: centsSchema.nullable(),
  lines: z.array(reportLineSchema),
  createdAt: z.string(),
});
export type ReportTemplate = z.infer<typeof reportTemplateResponseSchema>;
export const templateKeyParams = z.object({ key: idSchema });

export const annualReportQuerySchema = z.object({
  fiscalYear: z.coerce.number().int().min(1900).max(2200),
  templateId: idSchema.optional(),
  language: languageSchema.default('de'),
});
export const annualReportSchema = z.object({
  fiscalYear: fiscalYearSchema,
  status: z.enum(['open', 'closed']),
  currency: z.literal('EUR'),
  incomeCents: signedTotalSchema,
  expenseCents: signedTotalSchema,
  resultCents: signedTotalSchema,
  membershipFeeIncomeCents: signedTotalSchema,
  donationIncomeCents: signedTotalSchema,
  otherIncomeCents: signedTotalSchema,
  unbookedPaymentCount: z.number().int(),
  categories: z.array(
    z.object({
      categoryId: idSchema,
      name: z.string(),
      direction: ledgerDirectionSchema,
      classification: ledgerClassificationSchema,
      totalCents: signedTotalSchema,
    }),
  ),
  accounts: z.array(accountBalanceSchema),
  template: z
    .object({
      id: idSchema,
      name: z.string(),
      version: z.number().int(),
      revenueThresholdCents: centsSchema.nullable(),
      thresholdExceeded: z.boolean(),
      lines: z.array(
        z.object({
          code: z.string(),
          label: z.string(),
          direction: ledgerDirectionSchema,
          totalCents: signedTotalSchema,
        }),
      ),
      unmappedCategoryIds: z.array(idSchema),
    })
    .nullable(),
});
export type AnnualReport = z.infer<typeof annualReportSchema>;
export const itemsOf = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });

export const transferInputSchema = z
  .object({
    fromAccountId: idSchema,
    toAccountId: idSchema,
    amountCents: positiveCentsSchema,
    bookingDate: z.iso.date(),
    description: z.string().trim().min(1).max(300),
  })
  .strict()
  .refine((v) => v.fromAccountId !== v.toAccountId, { message: 'ledgerDifferentAccounts' });
export type TransferInput = z.infer<typeof transferInputSchema>;
export const transferResponseSchema = z.object({
  id: idSchema,
  fiscalYear: fiscalYearSchema,
  fromAccountId: idSchema,
  toAccountId: idSchema,
  amountCents: positiveCentsSchema,
  bookingDate: z.iso.date(),
  description: z.string(),
  reversesTransferId: idSchema.nullable(),
  createdAt: z.string(),
});
export type LedgerTransfer = z.infer<typeof transferResponseSchema>;
export const backfillInputSchema = z
  .object({
    accountId: idSchema,
    categoryId: idSchema,
    fiscalYear: fiscalYearSchema,
    method: z.enum(['cash', 'bank_transfer', 'other']),
  })
  .strict();
export const backfillResponseSchema = z.object({
  booked: z.number().int(),
  remaining: z.number().int(),
});
export const etsMappingInputSchema = z
  .object({
    effectiveFrom: z.iso.date(),
    position: z.string().min(1).max(30),
  })
  .strict();
export const etsMappingResponseSchema = etsMappingInputSchema
  .extend({
    id: idSchema,
    categoryId: idSchema,
    definitionVersion: z.string(),
    createdAt: z.string(),
  })
  .strip();
export const financeDashboardSchema = z.object({
  fiscalYear: fiscalYearSchema,
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
  totalCents: signedTotalSchema,
  bankCents: signedTotalSchema,
  cashCents: signedTotalSchema,
  incomeCents: signedTotalSchema,
  expenseCents: signedTotalSchema,
  openFeesCents: signedTotalSchema,
  recent: z.array(cashbookEntryResponseSchema),
  trend: z.array(
    z.object({
      month: z.string(),
      incomeCents: signedTotalSchema,
      expenseCents: signedTotalSchema,
    }),
  ),
});
export type FinanceDashboard = z.infer<typeof financeDashboardSchema>;
