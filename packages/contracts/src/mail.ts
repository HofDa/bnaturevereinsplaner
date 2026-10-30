import { z } from 'zod';

export const mailKindSchema = z.enum(['fee_reminder', 'event_invitation']);
export type MailKind = z.infer<typeof mailKindSchema>;
export const mailRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fee_reminder') }).strict(),
  z.object({ kind: z.literal('event_invitation'), eventId: z.uuid() }).strict(),
]);
export type MailRequest = z.infer<typeof mailRequestSchema>;
export const mailSendSchema = z
  .object({ request: mailRequestSchema, previewHash: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export const mailSettingsInputSchema = z
  .object({
    automaticFeeReminders: z.boolean(),
    reminderIntervalDays: z.number().int().min(7).max(90),
  })
  .strict();
export const mailSettingsSchema = mailSettingsInputSchema.extend({
  lastRunOn: z.string().nullable(),
});
export type MailSettings = z.infer<typeof mailSettingsSchema>;
export const mailPreviewItemSchema = z.object({
  personId: z.uuid(),
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
export const mailMessageSchema = z.object({
  id: z.uuid(),
  kind: mailKindSchema,
  recipient: z.string(),
  subject: z.string(),
  text: z.string(),
  state: mailStateSchema,
  createdAt: z.string(),
  sentAt: z.string().nullable(),
  errorCode: z.string().nullable(),
});
export type MailMessage = z.infer<typeof mailMessageSchema>;
export const mailStatusSchema = z.object({ mode: z.enum(['disabled', 'local', 'smtp']) });
export const mailEnqueueResultSchema = z.object({ queued: z.number().int(), batchId: z.uuid() });
