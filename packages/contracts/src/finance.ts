import { z } from 'zod';
import { idSchema, membershipTypeSchema, patchSchema, languageSchema } from './common';

export const MAX_CENTS = 1_000_000_000;
export const centsSchema = z.number().int().min(0).max(MAX_CENTS);
export const positiveCentsSchema = centsSchema.min(1);
export const fiscalYearSchema = z.number().int().min(1900).max(2200);
export const feeIntervalSchema = z.enum(['annual', 'once']);
export const paymentMethodSchema = z.enum(['cash', 'bank_transfer', 'other']);
export const feeStatusSchema = z.enum(['open', 'partial', 'paid', 'exempt']);
export const financeWriteHeaders = z.object({ 'idempotency-key': idSchema }).passthrough();
export const feePlanInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).default(''),
    amountCents: centsSchema,
    interval: feeIntervalSchema,
    membershipType: membershipTypeSchema.nullable().default(null),
    active: z.boolean().default(true),
  })
  .strict();
export const feePlanPatchSchema = patchSchema(feePlanInputSchema).extend({
  version: z.number().int().min(1),
});
export const feePlanResponseSchema = feePlanInputSchema
  .extend({
    id: idSchema,
    currency: z.literal('EUR'),
    version: z.number().int().min(1),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strip();
export type FeePlanInput = z.infer<typeof feePlanInputSchema>;
export type FeePlanPatch = z.infer<typeof feePlanPatchSchema>;
export type FeePlan = z.infer<typeof feePlanResponseSchema>;

export const assessmentInputSchema = z
  .object({
    membershipId: idSchema,
    planId: idSchema,
    fiscalYear: fiscalYearSchema,
    dueDate: z.iso.date(),
    individualAmountCents: centsSchema.nullable().default(null),
    reductionCents: centsSchema.default(0),
    exempt: z.boolean().default(false),
    adjustmentReason: z.string().trim().max(500).default(''),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      (v.individualAmountCents !== null || v.reductionCents > 0 || v.exempt) &&
      !v.adjustmentReason
    )
      ctx.addIssue({
        code: 'custom',
        path: ['adjustmentReason'],
        message: 'financeReasonRequired',
      });
    if (v.exempt && v.reductionCents > 0)
      ctx.addIssue({
        code: 'custom',
        path: ['reductionCents'],
        message: 'financeExemptionReduction',
      });
  });
export type AssessmentInput = z.infer<typeof assessmentInputSchema>;
export const assessmentResponseSchema = z.object({
  id: idSchema,
  membershipId: idSchema,
  planId: idSchema,
  fiscalYear: fiscalYearSchema,
  dueDate: z.iso.date(),
  memberName: z.string(),
  membershipNumber: z.string(),
  planName: z.string(),
  interval: feeIntervalSchema,
  planAmountCents: centsSchema,
  baseAmountCents: centsSchema,
  reductionCents: centsSchema,
  exempt: z.boolean(),
  adjustmentReason: z.string(),
  amountCents: centsSchema,
  paidCents: centsSchema,
  openCents: centsSchema,
  status: feeStatusSchema,
  overdue: z.boolean(),
  currency: z.literal('EUR'),
  createdAt: z.string(),
});
export type FeeAssessment = z.infer<typeof assessmentResponseSchema>;
export const allocationInputSchema = z
  .object({ assessmentId: idSchema, amountCents: positiveCentsSchema })
  .strict();
export const paymentInputSchema = z
  .object({
    payerName: z.string().trim().min(1).max(160),
    paidOn: z.iso.date(),
    method: paymentMethodSchema,
    reference: z.string().trim().max(120).default(''),
    notes: z.string().trim().max(500).default(''),
    amountCents: positiveCentsSchema,
    allocations: z.array(allocationInputSchema).min(1).max(100),
  })
  .strict()
  .superRefine((v, ctx) => {
    const ids = v.allocations.map((a) => a.assessmentId);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: 'custom',
        path: ['allocations'],
        message: 'financeDuplicateAllocation',
      });
    const total = v.allocations.reduce((sum, a) => sum + BigInt(a.amountCents), 0n);
    if (total !== BigInt(v.amountCents))
      ctx.addIssue({ code: 'custom', path: ['amountCents'], message: 'financeAllocationSum' });
  });
export type PaymentInput = z.infer<typeof paymentInputSchema>;
export const allocationResponseSchema = allocationInputSchema.extend({
  memberName: z.string(),
  membershipNumber: z.string(),
  planName: z.string(),
  fiscalYear: fiscalYearSchema,
});
export const paymentResponseSchema = z.object({
  id: idSchema,
  receiptNumber: z.number().int().positive(),
  payerName: z.string(),
  paidOn: z.iso.date(),
  method: paymentMethodSchema,
  reference: z.string(),
  notes: z.string(),
  amountCents: positiveCentsSchema,
  currency: z.literal('EUR'),
  createdAt: z.string(),
  allocations: z.array(allocationResponseSchema),
});
export type Payment = z.infer<typeof paymentResponseSchema>;
export const assessmentDetailSchema = assessmentResponseSchema.extend({
  payments: z.array(
    z.object({
      paymentId: idSchema,
      receiptNumber: z.number().int(),
      paidOn: z.iso.date(),
      method: paymentMethodSchema,
      amountCents: positiveCentsSchema,
    }),
  ),
});
export type AssessmentDetail = z.infer<typeof assessmentDetailSchema>;
export const financeListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).default(''),
  direction: z.enum(['asc', 'desc']).default('desc'),
  sort: z.enum(['name', 'createdAt', 'dueDate', 'paidOn', 'amountCents']).default('createdAt'),
  fiscalYear: z.coerce.number().int().min(1900).max(2200).optional(),
  status: z.enum(['open', 'partial', 'paid', 'exempt', 'overdue', 'outstanding']).optional(),
  membershipId: idSchema.optional(),
  planId: idSchema.optional(),
  active: z.enum(['true', 'false']).optional(),
  membershipType: membershipTypeSchema.optional(),
});
export type FinanceListQuery = z.infer<typeof financeListQuerySchema>;
export const financeSummaryQuerySchema = z.object({
  fiscalYear: z.coerce.number().int().min(1900).max(2200).optional(),
});
const totalCents = z.string().regex(/^\d+$/);
export const financeSummarySchema = z.object({
  assessedCents: totalCents,
  paidCents: totalCents,
  openCents: totalCents,
  overdueCents: totalCents,
  assessmentCount: z.number().int(),
  openCount: z.number().int(),
  paidCount: z.number().int(),
  exemptCount: z.number().int(),
  currency: z.literal('EUR'),
});
export type FinanceSummary = z.infer<typeof financeSummarySchema>;
export const reminderResponseSchema = z.object({
  id: idSchema,
  assessmentId: idSchema,
  sequence: z.number().int().positive(),
  openCents: positiveCentsSchema,
  createdAt: z.string(),
  status: z.literal('prepared'),
});
export type FeeReminder = z.infer<typeof reminderResponseSchema>;
export const pdfQuerySchema = z.object({ language: languageSchema.default('de') });
export const financePageSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  });

// Currency input is parsed as decimal text: no parseFloat, rounding or monetary float arithmetic.
export function parseEuroCents(value: string): number {
  const normalized = value.trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(normalized)) throw new Error('financeInvalidAmount');
  const [euros, fraction = ''] = normalized.replace(',', '.').split('.');
  const cents = BigInt(euros!) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents > BigInt(MAX_CENTS)) throw new Error('financeInvalidAmount');
  return Number(cents);
}
export const moneyTextSchema = z
  .string()
  .trim()
  .refine((v) => {
    try {
      parseEuroCents(v);
      return true;
    } catch {
      return false;
    }
  }, 'financeInvalidAmount');
export function moneyInputValue(cents: number): string {
  return `${BigInt(cents) / 100n}.${String(BigInt(cents) % 100n).padStart(2, '0')}`;
}
export function formatMoney(cents: number | string, language = 'de'): string {
  const value = BigInt(cents),
    negative = value < 0n,
    absolute = negative ? -value : value;
  const whole = new Intl.NumberFormat(language === 'it' ? 'it-IT' : 'de-IT', {
    maximumFractionDigits: 0,
  }).format(absolute / 100n);
  return `${negative ? '-' : ''}${whole},${String(absolute % 100n).padStart(2, '0')} €`;
}
