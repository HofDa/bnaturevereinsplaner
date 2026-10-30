import { z } from 'zod';
import { idSchema, languageSchema, patchSchema } from './common';
export const eventStatusSchema = z.enum(['draft', 'published', 'cancelled', 'completed']);
export const eventVisibilitySchema = z.enum(['internal', 'members', 'public']);
export const attendanceStatusSchema = z.enum(['unrecorded', 'present', 'absent', 'excused']);
export const registrationStatusSchema = z.enum(['registered', 'waitlisted', 'cancelled']);
export const eventI18nSchema = z
  .object({ de: z.string().trim().min(1).max(200), it: z.string().trim().min(1).max(200) })
  .strict();
const zone = z
  .string()
  .max(100)
  .refine((v) => {
    try {
      new Intl.DateTimeFormat('de', { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, 'eventInvalidTimezone');
export const localDateTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/);
export const eventInputSchema = z
  .object({
    titleI18n: eventI18nSchema,
    descriptionI18n: z
      .object({ de: z.string().trim().max(10000), it: z.string().trim().max(10000) })
      .strict()
      .default({ de: '', it: '' }),
    categoryId: idSchema,
    startLocal: localDateTimeSchema,
    endLocal: localDateTimeSchema,
    timezone: zone.default('Europe/Rome'),
    location: z.string().trim().max(300).default(''),
    latitude: z.number().min(-90).max(90).nullable().default(null),
    longitude: z.number().min(-180).max(180).nullable().default(null),
    organizerId: idSchema.optional(),
    project: z.string().trim().max(160).default(''),
    status: eventStatusSchema.default('draft'),
    visibility: eventVisibilitySchema.default('internal'),
    registrationRequired: z.boolean().default(true),
    capacity: z.number().int().min(1).max(10000).nullable().default(null),
    registrationDeadline: z.iso.datetime({ offset: true }).nullable().default(null),
    waitlistEnabled: z.boolean().default(false),
  })
  .strict();
export type EventInput = z.infer<typeof eventInputSchema>;
export const eventPatchSchema = patchSchema(eventInputSchema).extend({
  version: z.number().int().positive(),
});
export type EventPatch = z.infer<typeof eventPatchSchema>;
export const eventResponseSchema = z.object({
  id: idSchema,
  seriesId: idSchema.nullable(),
  originalStartAt: z.string().nullable(),
  titleI18n: eventI18nSchema,
  descriptionI18n: z.object({ de: z.string(), it: z.string() }),
  categoryId: idSchema,
  categoryNameI18n: eventI18nSchema,
  startAt: z.string(),
  endAt: z.string(),
  timezone: z.string(),
  location: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  organizerId: idSchema,
  organizerName: z.string(),
  project: z.string(),
  cancellationReason: z.string().default(''),
  status: eventStatusSchema,
  visibility: eventVisibilitySchema,
  registrationRequired: z.boolean(),
  capacity: z.number().int().nullable(),
  registrationDeadline: z.string().nullable(),
  waitlistEnabled: z.boolean(),
  version: z.number().int(),
  createdBy: idSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  registeredCount: z.number().int(),
  waitlistedCount: z.number().int(),
  myRegistrationStatus: registrationStatusSchema.nullable(),
  canManage: z.boolean(),
});
export type EventOccurrence = z.infer<typeof eventResponseSchema>;
export const eventQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  search: z.string().trim().max(100).default(''),
  categoryId: idSchema.optional(),
  status: eventStatusSchema.optional(),
  project: z.string().max(160).optional(),
  mine: z.enum(['true', 'false']).default('false'),
});
export type EventQuery = z.infer<typeof eventQuerySchema>;
export const eventCategoryInputSchema = z
  .object({ nameI18n: eventI18nSchema, active: z.boolean().default(true) })
  .strict();
export const eventCategoryPatchSchema = patchSchema(eventCategoryInputSchema).extend({
  version: z.number().int().positive(),
});
export const eventCategoryResponseSchema = eventCategoryInputSchema
  .extend({ id: idSchema, version: z.number().int(), createdAt: z.string(), updatedAt: z.string() })
  .strip();
export type EventCategory = z.infer<typeof eventCategoryResponseSchema>;
export const seriesInputSchema = z
  .object({ event: eventInputSchema, recurrenceRule: z.string().trim().min(1).max(500) })
  .strict();
export const seriesPatchSchema = z
  .object({
    event: patchSchema(eventInputSchema).optional(),
    recurrenceRule: z.string().trim().min(1).max(500).optional(),
    reason: z.string().trim().min(1).max(500).optional(),
    version: z.number().int().positive(),
  })
  .strict();
export const seriesResponseSchema = z.object({
  id: idSchema,
  recurrenceRule: z.string(),
  timezone: z.string(),
  startLocal: z.string(),
  endLocal: z.string(),
  cancellationReason: z.string().default(''),
  status: eventStatusSchema,
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  occurrenceCount: z.number().int(),
});
export type EventSeries = z.infer<typeof seriesResponseSchema>;
export const eventCancelSchema = z
  .object({ version: z.number().int().positive(), reason: z.string().trim().min(1).max(500) })
  .strict();
export const registrationInputSchema = z
  .object({
    personId: idSchema.optional(),
    guest: z
      .object({
        firstName: z.string().trim().min(1).max(100),
        lastName: z.string().trim().min(1).max(100),
        email: z.union([z.email(), z.literal('')]).default(''),
      })
      .strict()
      .optional(),
    overrideDeadline: z.boolean().default(false),
  })
  .strict()
  .refine((v) => !(v.personId && v.guest), { message: 'eventChooseIdentity' });
export const registrationPatchSchema = z
  .object({ status: registrationStatusSchema, version: z.number().int().positive() })
  .strict();
export const registrationResponseSchema = z.object({
  id: idSchema,
  eventOccurrenceId: idSchema,
  personId: idSchema,
  displayName: z.string(),
  status: registrationStatusSchema,
  registeredAt: z.string(),
  cancelledAt: z.string().nullable(),
  version: z.number().int(),
  waitlistPosition: z.number().int().nullable(),
});
export type EventRegistration = z.infer<typeof registrationResponseSchema>;
export const attendanceRecordSchema = z.object({
  registrationId: idSchema,
  personId: idSchema,
  displayName: z.string(),
  registrationStatus: registrationStatusSchema,
  status: attendanceStatusSchema,
  version: z.number().int(),
  checkedInAt: z.string().nullable(),
  recordedBy: idSchema.nullable(),
  recordedByName: z.string().nullable().default(null),
  updatedAt: z.string(),
});
export type AttendanceRecord = z.infer<typeof attendanceRecordSchema>;
export const attendanceSnapshotSchema = z.object({
  organizationId: idSchema,
  eventOccurrenceId: idSchema,
  titleI18n: eventI18nSchema,
  startAt: z.string(),
  endAt: z.string(),
  timezone: z.string(),
  eventVersion: z.number().int(),
  preparedAt: z.string(),
  expiresAt: z.string(),
  participants: z
    .array(
      attendanceRecordSchema.omit({
        personId: true,
        recordedBy: true,
        recordedByName: true,
        updatedAt: true,
      }),
    )
    .max(10000),
});
export type AttendanceSnapshot = z.infer<typeof attendanceSnapshotSchema>;
export const attendanceOperationSchema = z
  .object({
    operationId: idSchema,
    organizationId: idSchema,
    eventOccurrenceId: idSchema,
    registrationId: idSchema,
    requestedStatus: attendanceStatusSchema,
    expectedVersion: z.number().int().min(0),
    clientCreatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type AttendanceOperation = z.infer<typeof attendanceOperationSchema>;
export const attendanceResultSchema = z.object({
  operationId: idSchema,
  status: z.enum(['applied', 'conflict', 'rejected']),
  replayed: z.boolean().default(false),
  code: z.string().optional(),
  record: attendanceRecordSchema.optional(),
});
export type AttendanceResult = z.infer<typeof attendanceResultSchema>;
export const attendanceSyncSchema = z
  .object({ operations: z.array(attendanceOperationSchema).min(1).max(100) })
  .strict();
export const attendancePutSchema = attendanceOperationSchema.omit({
  organizationId: true,
  eventOccurrenceId: true,
  registrationId: true,
});
export const attendanceHistorySchema = z.object({
  id: idSchema,
  registrationId: idSchema,
  operationId: idSchema,
  previousStatus: attendanceStatusSchema,
  status: attendanceStatusSchema,
  version: z.number().int(),
  recordedBy: idSchema,
  recordedByName: z.string().nullable().default(null),
  clientCreatedAt: z.string(),
  createdAt: z.string(),
});
export const eventPeopleQuerySchema = z.object({ search: z.string().trim().max(100).default('') });
export const eventPersonSchema = z.object({
  id: idSchema,
  displayName: z.string(),
  member: z.boolean(),
});
export const eventExportQuerySchema = z.object({
  format: z.enum(['pdf', 'csv']).default('pdf'),
  language: languageSchema.default('de'),
});
