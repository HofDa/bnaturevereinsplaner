import { z } from 'zod';

const i18n = (max: number, min = 0) =>
  z
    .object({ de: z.string().trim().min(min).max(max), it: z.string().trim().min(min).max(max) })
    .strict();
const instant = z.iso.datetime({ offset: true });
export const MAX_SCHEDULE_SLOTS = 30;
export const scheduleAnswerSchema = z.enum(['yes', 'maybe', 'no']);
export type ScheduleAnswer = z.infer<typeof scheduleAnswerSchema>;

export const scheduleInputSchema = z
  .object({
    titleI18n: i18n(200, 1),
    descriptionI18n: i18n(5000).default({ de: '', it: '' }),
    location: z.string().trim().max(200).default(''),
    groupId: z.uuid().nullable().default(null),
    closesAt: instant.nullable().default(null),
    slots: z
      .array(z.object({ startAt: instant, endAt: instant }).strict())
      .min(2)
      .max(MAX_SCHEDULE_SLOTS),
  })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.slots.forEach((slot, i) => {
      if (Date.parse(slot.endAt) <= Date.parse(slot.startAt))
        ctx.addIssue({ code: 'custom', path: ['slots', i, 'endAt'], message: 'endBeforeStart' });
      const key = `${Date.parse(slot.startAt)}-${Date.parse(slot.endAt)}`;
      if (seen.has(key))
        ctx.addIssue({ code: 'custom', path: ['slots', i], message: 'scheduleDuplicateSlot' });
      seen.add(key);
    });
  });
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;
export const scheduleAnswersInputSchema = z
  .object({
    answers: z
      .array(z.object({ slotId: z.uuid(), answer: scheduleAnswerSchema }).strict())
      .min(1)
      .max(MAX_SCHEDULE_SLOTS),
  })
  .strict();
export const scheduleCloseSchema = z
  .object({ version: z.number().int().positive(), finalSlotId: z.uuid().nullable().default(null) })
  .strict();
export const scheduleEventInputSchema = z
  .object({
    categoryId: z.uuid(),
    visibility: z.enum(['internal', 'members', 'public']).default('members'),
    status: z.enum(['draft', 'published']).default('draft'),
  })
  .strict();
export const scheduleQuerySchema = z.object({
  state: z.enum(['open', 'closed']).default('open'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  groupId: z.uuid().optional(),
});

export const scheduleSlotSchema = z.object({
  id: z.uuid(),
  startAt: z.string(),
  endAt: z.string(),
  yes: z.number().int(),
  maybe: z.number().int(),
  no: z.number().int(),
  mine: scheduleAnswerSchema.nullable(),
});
export const scheduleSummarySchema = z.object({
  id: z.uuid(),
  titleI18n: i18n(200),
  groupId: z.uuid().nullable(),
  groupName: z.string().nullable(),
  location: z.string(),
  state: z.enum(['open', 'closed', 'archived']),
  isOpen: z.boolean(),
  closesAt: z.string().nullable(),
  slotCount: z.number().int(),
  participantCount: z.number().int(),
  answered: z.boolean(),
  finalSlot: z.object({ startAt: z.string(), endAt: z.string() }).nullable(),
  authorName: z.string(),
  createdAt: z.string(),
});
export type ScheduleSummary = z.infer<typeof scheduleSummarySchema>;
export const scheduleDetailSchema = scheduleSummarySchema.extend({
  descriptionI18n: i18n(5000),
  version: z.number().int(),
  slots: z.array(scheduleSlotSchema),
  /** Slot IDs with the most "yes", ties broken by "maybe"; empty without answers. */
  bestSlotIds: z.array(z.uuid()),
  finalSlotId: z.uuid().nullable(),
  /** Event created from the fixed slot, if any. */
  eventId: z.uuid().nullable(),
  participants: z.array(
    z.object({ name: z.string(), answers: z.record(z.string(), scheduleAnswerSchema) }),
  ),
  canManage: z.boolean(),
});
export type ScheduleDetail = z.infer<typeof scheduleDetailSchema>;

/** Best slots: most yes, then most maybe. */
export function bestSlots(slots: { id: string; yes: number; maybe: number }[]) {
  const top = slots.reduce(
    (best, s) =>
      s.yes > best.yes || (s.yes === best.yes && s.maybe > best.maybe)
        ? { yes: s.yes, maybe: s.maybe }
        : best,
    { yes: 0, maybe: 0 },
  );
  if (!top.yes && !top.maybe) return [];
  return slots.filter((s) => s.yes === top.yes && s.maybe === top.maybe).map((s) => s.id);
}
