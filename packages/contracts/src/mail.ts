import { z } from 'zod';

export const mailKindSchema = z.enum([
  'fee_reminder',
  'event_invitation',
  'deadline_reminder',
  'newsletter',
  'account_invitation',
  'password_reset',
  'test',
]);
export type MailKind = z.infer<typeof mailKindSchema>;
// Kinds that can be prepared through the preview/confirm flow.
export const mailRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fee_reminder') }).strict(),
  z.object({ kind: z.literal('event_invitation'), eventId: z.uuid() }).strict(),
  z.object({ kind: z.literal('deadline_reminder') }).strict(),
  z.object({ kind: z.literal('newsletter'), newsletterId: z.uuid() }).strict(),
]);
export type MailRequest = z.infer<typeof mailRequestSchema>;
export const mailSendSchema = z
  .object({ request: mailRequestSchema, previewHash: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export const mailSettingsInputSchema = z
  .object({
    automaticFeeReminders: z.boolean(),
    reminderIntervalDays: z.number().int().min(7).max(90),
    automaticDeadlineReminders: z.boolean().default(false),
  })
  .strict();
export const mailSettingsSchema = mailSettingsInputSchema.extend({
  lastRunOn: z.string().nullable(),
  deadlineLastRunOn: z.string().nullable(),
});
export type MailSettings = z.infer<typeof mailSettingsSchema>;
export const mailPreviewItemSchema = z.object({
  personId: z.uuid().nullable(),
  userId: z.uuid().nullable(),
  sourceId: z.uuid(),
  recipient: z.email(),
  name: z.string(),
  language: z.enum(['de', 'it']),
  subject: z.string(),
  text: z.string(),
});
export type MailPreviewItem = z.infer<typeof mailPreviewItemSchema>;
export const mailPreviewSchema = z.object({
  request: mailRequestSchema,
  hash: z.string(),
  items: z.array(mailPreviewItemSchema),
  skipped: z.object({
    invalidEmail: z.number(),
    noAccount: z.number(),
    recentlyContacted: z.number(),
    optedOut: z.number().default(0),
  }),
});
export type MailPreview = z.infer<typeof mailPreviewSchema>;
export const mailStateSchema = z.enum([
  'queued',
  'sending',
  'sent',
  'failed',
  'uncertain',
  'cancelled',
]);
export type MailState = z.infer<typeof mailStateSchema>;
export const mailResolutionSchema = z.enum(['retry', 'mark_sent', 'dismiss']);
export const mailMessageSchema = z.object({
  id: z.uuid(),
  kind: mailKindSchema,
  recipient: z.string(),
  subject: z.string(),
  text: z.string(),
  state: mailStateSchema,
  attempts: z.number().int(),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
  errorCode: z.string().nullable(),
  resolution: mailResolutionSchema.nullable(),
  resolutionNote: z.string(),
  resolvedAt: z.string().nullable(),
});
export type MailMessage = z.infer<typeof mailMessageSchema>;
export const mailResolveSchema = z
  .object({
    action: mailResolutionSchema,
    note: z.string().trim().max(500).default(''),
    // For uncertain handoffs the sender must confirm the provider log shows no delivery.
    checkedProvider: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action !== 'retry' && value.note.length < 3)
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'noteRequired' });
  });
export const mailStatusSchema = z.object({
  mode: z.enum(['disabled', 'local', 'smtp']),
  // Only shown to administrators; never includes credentials.
  sender: z.string().nullable(),
  host: z.string().nullable(),
});
export const mailEnqueueResultSchema = z.object({ queued: z.number().int(), batchId: z.uuid() });

const i18nText = (max: number) =>
  z.object({ de: z.string().trim().min(1).max(max), it: z.string().trim().min(1).max(max) });
export const newsletterInputSchema = z
  .object({
    subjectI18n: i18nText(200).refine((v) => !/[\r\n]/.test(v.de + v.it), 'singleLine'),
    bodyI18n: i18nText(20_000),
    groupIds: z.array(z.uuid()).max(50).default([]),
  })
  .strict();
export type NewsletterInput = z.infer<typeof newsletterInputSchema>;
export const newsletterSchema = newsletterInputSchema.extend({
  id: z.uuid(),
  status: z.enum(['draft', 'sent', 'withdrawn']),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  sentAt: z.string().nullable(),
});
export type Newsletter = z.infer<typeof newsletterSchema>;
export const newsletterUpdateSchema = newsletterInputSchema.extend({ version: z.number().int() });
