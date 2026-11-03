import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max);
const i18nLabel = z.object({ de: text(80).min(1), it: text(80).min(1) }).strict();

export const memberFieldTypeSchema = z.enum(['text', 'number', 'date', 'boolean', 'select']);
export type MemberFieldType = z.infer<typeof memberFieldTypeSchema>;
export const MAX_MEMBER_FIELDS = 50;
const options = z.array(text(80).min(1)).max(30);

export const memberFieldInputSchema = z
  .object({
    labelI18n: i18nLabel,
    type: memberFieldTypeSchema,
    options: options.default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.type === 'select' && v.options.length < 2)
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'memberFieldOptionsRequired' });
    if (v.type !== 'select' && v.options.length)
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'memberFieldOptionsOnlySelect' });
    if (new Set(v.options).size !== v.options.length)
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'memberFieldOptionsUnique' });
  });
export const memberFieldPatchSchema = z
  .object({
    labelI18n: i18nLabel.optional(),
    options: options.optional(),
    active: z.boolean().optional(),
    position: z.number().int().min(0).max(1000).optional(),
  })
  .strict();
export const memberFieldSchema = z.object({
  id: z.uuid(),
  labelI18n: z.object({ de: z.string(), it: z.string() }),
  type: memberFieldTypeSchema,
  options: z.array(z.string()),
  position: z.number().int(),
  active: z.boolean(),
});
export type MemberField = z.infer<typeof memberFieldSchema>;

export const memberFieldValueSchema = z.union([z.string().max(500), z.number(), z.boolean()]);
export const memberFieldValuesInputSchema = z
  .object({ values: z.record(z.uuid(), memberFieldValueSchema.nullable()) })
  .strict();

export const consentKindSchema = z.enum(['data_processing', 'photos']);
export type ConsentKind = z.infer<typeof consentKindSchema>;
export const consentInputSchema = z
  .object({
    kind: consentKindSchema,
    granted: z.boolean(),
    decidedOn: z.iso.date(),
    /** Who declared it: empty for the member personally, otherwise e.g. a guardian's name. */
    givenBy: text(120).default(''),
    note: text(500).default(''),
  })
  .strict();
export const consentSchema = z.object({
  id: z.uuid(),
  kind: consentKindSchema,
  granted: z.boolean(),
  decidedOn: z.string(),
  givenBy: z.string(),
  note: z.string(),
  recordedBy: z.string(),
  recordedAt: z.string(),
});
export type Consent = z.infer<typeof consentSchema>;

export const guardianInputSchema = z
  .object({
    name: text(120).min(1),
    relationship: text(60).default(''),
    email: z.union([z.literal(''), z.email().max(254)]).default(''),
    phone: text(40).default(''),
  })
  .strict();
/** Partial update without defaults, so omitted fields keep their stored value. */
export const guardianPatchSchema = z
  .object({
    name: text(120).min(1),
    relationship: text(60),
    email: z.union([z.literal(''), z.email().max(254)]),
    phone: text(40),
  })
  .partial()
  .strict();
export const guardianSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  relationship: z.string(),
  email: z.string(),
  phone: z.string(),
});
export type Guardian = z.infer<typeof guardianSchema>;

export const memberExtrasSchema = z.object({
  isMinor: z.boolean(),
  fields: z.array(z.object({ field: memberFieldSchema, value: memberFieldValueSchema.nullable() })),
  /** Latest decision per kind (null: never recorded). */
  consents: z.object({
    data_processing: consentSchema.nullable(),
    photos: consentSchema.nullable(),
  }),
  consentHistory: z.array(consentSchema),
  guardians: z.array(guardianSchema),
});
export type MemberExtras = z.infer<typeof memberExtrasSchema>;

/** Age in full years on `today` (both YYYY-MM-DD). */
export function ageOn(dateOfBirth: string, today: string) {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}
