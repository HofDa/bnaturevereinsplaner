import { z } from 'zod';
import { idSchema } from './common';
import { roleSchema } from './roles';

const date = z.iso.date();
const i18n = (max = 300) =>
  z
    .object({ de: z.string().trim().min(1).max(max), it: z.string().trim().min(1).max(max) })
    .strict();
export const complianceKindSchema = z.enum(['legal', 'recommendation', 'internal']);
export type ComplianceKind = z.infer<typeof complianceKindSchema>;
export const complianceTopicSchema = z.enum([
  'runts_annual_report',
  'organ_change',
  'association_data',
  'board_term',
  'insurance',
  'register_snapshot',
  'document_review',
  'custom',
]);
export const deadlineStatusSchema = z.enum(['open', 'in_progress', 'done', 'not_applicable']);
export const deadlineBasisSchema = z.enum([
  'manual',
  'fiscal_year_end',
  'annual_date',
  'board_change',
  'board_mandate_end',
  'policy_end',
  'last_register_snapshot',
]);
export type DeadlineBasis = z.infer<typeof deadlineBasisSchema>;
export const calculationSchema = z
  .object({
    basis: deadlineBasisSchema,
    offsetDays: z.number().int().min(-730).max(730).default(0),
    month: z.number().int().min(1).max(12).optional(),
    day: z.number().int().min(1).max(31).optional(),
  })
  .strict()
  .refine((v) => v.basis !== 'annual_date' || (v.month !== undefined && v.day !== undefined), {
    path: ['month'],
    message: 'validation',
  });
export type DeadlineCalculation = z.infer<typeof calculationSchema>;
export const reminderDaysSchema = z.array(z.number().int().min(0).max(365)).max(5).default([30, 7]);
export const ruleInputSchema = z
  .object({
    ruleKey: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]{3,60}$/),
    kind: complianceKindSchema,
    topic: complianceTopicSchema,
    titleI18n: i18n(),
    descriptionI18n: i18n(4000),
    legalBasis: z.string().trim().max(500).default(''),
    sourceUrl: z.union([z.url().max(500), z.literal('')]).default(''),
    responsibleRole: roleSchema.nullable().default(null),
    calculation: calculationSchema,
    reminderDays: reminderDaysSchema,
    validFrom: date,
    active: z.boolean().default(true),
  })
  .strict()
  .refine((v) => v.kind !== 'legal' || !!v.legalBasis, {
    path: ['legalBasis'],
    message: 'legalBasisRequired',
  });
export type RuleInput = z.infer<typeof ruleInputSchema>;
export const ruleSchema = z.object({
  id: idSchema,
  ruleKey: z.string(),
  version: z.number().int(),
  kind: complianceKindSchema,
  topic: complianceTopicSchema,
  titleI18n: z.object({ de: z.string(), it: z.string() }),
  descriptionI18n: z.object({ de: z.string(), it: z.string() }),
  legalBasis: z.string(),
  sourceUrl: z.string(),
  responsibleRole: roleSchema.nullable(),
  calculation: z.record(z.string(), z.unknown()),
  reminderDays: z.array(z.number().int()),
  validFrom: z.string(),
  validTo: z.string().nullable(),
  active: z.boolean(),
  reviewNote: z.string(),
  createdAt: z.string(),
});
export type ComplianceRule = z.infer<typeof ruleSchema>;
export const deadlineInputSchema = z
  .object({
    ruleId: idSchema.nullable().default(null),
    kind: complianceKindSchema.default('internal'),
    topic: complianceTopicSchema.default('custom'),
    titleI18n: i18n(),
    descriptionI18n: z
      .object({ de: z.string().trim().max(4000), it: z.string().trim().max(4000) })
      .strict()
      .default({ de: '', it: '' }),
    legalBasis: z.string().trim().max(500).default(''),
    responsibleRole: roleSchema.nullable().default(null),
    responsibleUserId: idSchema.nullable().default(null),
    dueDate: date,
    reminderDays: reminderDaysSchema,
  })
  .strict();
export const deadlinePatchSchema = z
  .object({
    version: z.number().int().min(1),
    status: z.enum(['open', 'in_progress', 'not_applicable']).optional(),
    responsibleRole: roleSchema.nullable().optional(),
    responsibleUserId: idSchema.nullable().optional(),
    dueDate: date.optional(),
    reminderDays: z.array(z.number().int().min(0).max(365)).max(5).optional(),
    note: z.string().trim().max(1000).default(''),
  })
  .strict()
  .refine((v) => v.status !== 'not_applicable' || !!v.note, {
    path: ['note'],
    message: 'reasonRequired',
  });
export const deadlineCompleteSchema = z
  .object({
    version: z.number().int().min(1),
    completedOn: date,
    protocolNumber: z.string().trim().max(120).default(''),
    note: z.string().trim().max(1000).default(''),
  })
  .strict();
export const evidenceInputSchema = z
  .object({
    documentId: idSchema.nullable().default(null),
    reference: z.string().trim().max(200).default(''),
    description: z.string().trim().max(1000).default(''),
  })
  .strict()
  .refine((v) => !!v.documentId || !!v.reference, {
    path: ['reference'],
    message: 'evidenceRequired',
  });
export const evidenceSchema = z.object({
  id: idSchema,
  documentId: idSchema.nullable(),
  documentTitle: z.string().nullable(),
  reference: z.string(),
  description: z.string(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
});
export const deadlineSchema = z.object({
  id: idSchema,
  ruleId: idSchema.nullable(),
  ruleVersion: z.number().int().nullable(),
  kind: complianceKindSchema,
  topic: complianceTopicSchema,
  titleI18n: z.object({ de: z.string(), it: z.string() }),
  descriptionI18n: z.object({ de: z.string(), it: z.string() }),
  legalBasis: z.string(),
  responsibleRole: roleSchema.nullable(),
  responsibleUserId: idSchema.nullable(),
  responsibleName: z.string().nullable(),
  sourceLabel: z.string(),
  dueDate: z.string(),
  reminderDays: z.array(z.number().int()),
  nextReminder: z.string().nullable(),
  status: deadlineStatusSchema,
  overdue: z.boolean(),
  completedOn: z.string().nullable(),
  protocolNumber: z.string(),
  evidence: z.array(evidenceSchema),
  history: z.array(
    z.object({
      action: z.string(),
      fromStatus: z.string().nullable(),
      toStatus: z.string().nullable(),
      note: z.string(),
      actorName: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  version: z.number().int(),
});
export type ComplianceDeadline = z.infer<typeof deadlineSchema>;
export const deadlineQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  status: deadlineStatusSchema.optional(),
  kind: complianceKindSchema.optional(),
  from: date.optional(),
  to: date.optional(),
});
export const generateDeadlinesSchema = z
  .object({ from: date, to: date })
  .strict()
  .refine((v) => v.to >= v.from, { path: ['to'], message: 'endBeforeStart' })
  .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= 3 * 366 * 86400000, {
    path: ['to'],
    message: 'validation',
  });

export const addDays = (value: string, days: number) =>
  new Date(Date.parse(`${value}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
// Clamps invalid calendar days (e.g. 31.6.) to the month's last day.
export function annualDate(year: number, month: number, day: number) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}
export function dueDateFor(calculation: DeadlineCalculation, basisDate: string) {
  return addDays(basisDate, calculation.offsetDays);
}
export function nextReminder(dueDate: string, reminderDays: number[], today: string) {
  const dates = reminderDays
    .map((d) => addDays(dueDate, -d))
    .filter((d) => d >= today)
    .sort();
  return dates[0] ?? null;
}
