import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  timestamp,
  boolean,
  jsonb,
  doublePrecision,
  unique,
  index,
  foreignKey,
  check,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { organizations, persons, organizationUserRoles } from './core';
import { user } from './auth';
import { created, updated } from './columns';
export type EventI18n = { de: string; it: string };
export const eventStatus = pgEnum('event_status', ['draft', 'published', 'cancelled', 'completed']);
export const eventVisibility = pgEnum('event_visibility', ['internal', 'members', 'public']);
export const registrationStatus = pgEnum('registration_status', [
  'registered',
  'waitlisted',
  'cancelled',
]);
export const attendanceStatus = pgEnum('attendance_status', [
  'unrecorded',
  'present',
  'absent',
  'excused',
]);
export const eventCategories = pgTable(
  'event_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    nameI18n: jsonb('name_i18n').$type<EventI18n>().notNull(),
    active: boolean('active').notNull().default(true),
    starterKey: text('starter_key'),
    version: integer('version').notNull().default(1),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique('event_categories_org_id').on(t.organizationId, t.id),
    unique('event_categories_starter').on(t.organizationId, t.starterKey),
    check(
      'event_category_names',
      sql`length(trim(${t.nameI18n}->>'de'))>0 and length(trim(${t.nameI18n}->>'it'))>0`,
    ),
  ],
);
export const eventSeries = pgTable(
  'event_series',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    recurrenceRule: text('recurrence_rule').notNull(),
    timezone: text('timezone').notNull(),
    startLocal: text('start_local').notNull(),
    endLocal: text('end_local').notNull(),
    template: jsonb('template').$type<Record<string, unknown>>().notNull(),
    cancellationReason: text('cancellation_reason').notNull().default(''),
    status: eventStatus('status').notNull().default('draft'),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [unique('event_series_org_id').on(t.organizationId, t.id)],
);
export const eventOccurrences = pgTable(
  'event_occurrences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    seriesId: uuid('series_id'),
    originalStartAt: timestamp('original_start_at', { withTimezone: true }),
    titleI18n: jsonb('title_i18n').$type<EventI18n>().notNull(),
    descriptionI18n: jsonb('description_i18n').$type<EventI18n>().notNull(),
    categoryId: uuid('category_id').notNull(),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    timezone: text('timezone').notNull().default('Europe/Rome'),
    location: text('location').notNull().default(''),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    organizerId: uuid('organizer_id').notNull(),
    project: text('project').notNull().default(''),
    cancellationReason: text('cancellation_reason').notNull().default(''),
    status: eventStatus('status').notNull().default('draft'),
    visibility: eventVisibility('visibility').notNull().default('internal'),
    registrationRequired: boolean('registration_required').notNull().default(true),
    capacity: integer('capacity'),
    registrationDeadline: timestamp('registration_deadline', { withTimezone: true }),
    waitlistEnabled: boolean('waitlist_enabled').notNull().default(false),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique('event_occurrences_org_id').on(t.organizationId, t.id),
    unique('event_occurrences_series_start').on(t.organizationId, t.seriesId, t.originalStartAt),
    foreignKey({
      columns: [t.organizationId, t.seriesId],
      foreignColumns: [eventSeries.organizationId, eventSeries.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.categoryId],
      foreignColumns: [eventCategories.organizationId, eventCategories.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.organizerId],
      foreignColumns: [organizationUserRoles.organizationId, organizationUserRoles.userId],
    }),
    index('event_occurrences_dates').on(t.organizationId, t.startAt, t.endAt),
    index('event_occurrences_organizer').on(t.organizationId, t.organizerId),
    check(
      'event_occurrence_dates',
      sql`${t.endAt}>${t.startAt} and (${t.registrationDeadline} is null or ${t.registrationDeadline}<=${t.startAt})`,
    ),
    check(
      'event_occurrence_capacity',
      sql`${t.capacity} is null or ${t.capacity} between 1 and 10000`,
    ),
    check(
      'event_coordinates',
      sql`(${t.latitude} is null and ${t.longitude} is null) or (${t.latitude} between -90 and 90 and ${t.longitude} between -180 and 180)`,
    ),
  ],
);
export const eventOccurrenceExceptions = pgTable(
  'event_occurrence_exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    seriesId: uuid('series_id').notNull(),
    occurrenceId: uuid('occurrence_id').notNull(),
    originalStartAt: timestamp('original_start_at', { withTimezone: true }).notNull(),
    exceptionType: text('exception_type').notNull(),
    overrideData: jsonb('override_data').$type<Record<string, unknown>>().notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: created(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.seriesId],
      foreignColumns: [eventSeries.organizationId, eventSeries.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.occurrenceId],
      foreignColumns: [eventOccurrences.organizationId, eventOccurrences.id],
    }),
    index('event_exceptions_series').on(t.organizationId, t.seriesId),
    check('event_exception_type', sql`${t.exceptionType} in ('skip','override')`),
  ],
);
export const eventRegistrations = pgTable(
  'event_registrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    eventOccurrenceId: uuid('event_occurrence_id').notNull(),
    personId: uuid('person_id').notNull(),
    status: registrationStatus('status').notNull(),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
    updatedAt: updated(),
  },
  (t) => [
    unique('event_registration_person').on(t.organizationId, t.eventOccurrenceId, t.personId),
    unique('event_registration_org_id').on(t.organizationId, t.id),
    unique('event_registration_occurrence_id').on(t.organizationId, t.eventOccurrenceId, t.id),
    foreignKey({
      columns: [t.organizationId, t.eventOccurrenceId],
      foreignColumns: [eventOccurrences.organizationId, eventOccurrences.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.personId],
      foreignColumns: [persons.organizationId, persons.id],
    }),
    index('event_waitlist_order').on(
      t.organizationId,
      t.eventOccurrenceId,
      t.status,
      t.registeredAt,
      t.id,
    ),
    check(
      'event_registration_cancelled',
      sql`(${t.status}='cancelled')=(${t.cancelledAt} is not null)`,
    ),
  ],
);
export const eventAttendances = pgTable(
  'event_attendances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    eventOccurrenceId: uuid('event_occurrence_id').notNull(),
    registrationId: uuid('registration_id').notNull(),
    status: attendanceStatus('status').notNull().default('unrecorded'),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    recordedBy: uuid('recorded_by').references(() => user.id),
    version: integer('version').notNull().default(0),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique('event_attendance_registration').on(t.organizationId, t.registrationId),
    foreignKey({
      columns: [t.organizationId, t.eventOccurrenceId, t.registrationId],
      foreignColumns: [
        eventRegistrations.organizationId,
        eventRegistrations.eventOccurrenceId,
        eventRegistrations.id,
      ],
    }),
    check('event_attendance_version', sql`${t.version}>=0`),
  ],
);
export const attendanceOperations = pgTable(
  'attendance_operations',
  {
    organizationId: uuid('organization_id').notNull(),
    operationId: uuid('operation_id').notNull(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => user.id),
    eventOccurrenceId: uuid('event_occurrence_id').notNull(),
    registrationId: uuid('registration_id').notNull(),
    requestedStatus: attendanceStatus('requested_status').notNull(),
    expectedVersion: integer('expected_version').notNull(),
    clientCreatedAt: timestamp('client_created_at', { withTimezone: true }).notNull(),
    requestHash: text('request_hash').notNull(),
    result: jsonb('result').$type<Record<string, unknown>>().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.operationId] }),
    foreignKey({
      columns: [t.organizationId, t.eventOccurrenceId, t.registrationId],
      foreignColumns: [
        eventRegistrations.organizationId,
        eventRegistrations.eventOccurrenceId,
        eventRegistrations.id,
      ],
    }),
  ],
);
export const attendanceHistory = pgTable(
  'attendance_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    registrationId: uuid('registration_id').notNull(),
    operationId: uuid('operation_id').notNull(),
    previousStatus: attendanceStatus('previous_status').notNull(),
    status: attendanceStatus('status').notNull(),
    version: integer('version').notNull(),
    recordedBy: uuid('recorded_by')
      .notNull()
      .references(() => user.id),
    clientCreatedAt: timestamp('client_created_at', { withTimezone: true }).notNull(),
    createdAt: created(),
  },
  (t) => [
    unique('attendance_history_version').on(t.organizationId, t.registrationId, t.version),
    foreignKey({
      columns: [t.organizationId, t.registrationId],
      foreignColumns: [eventRegistrations.organizationId, eventRegistrations.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.operationId],
      foreignColumns: [attendanceOperations.organizationId, attendanceOperations.operationId],
    }),
  ],
);
export const eventOperations = pgTable(
  'event_operations',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    operationId: uuid('operation_id').notNull(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => user.id),
    requestHash: text('request_hash').notNull(),
    response: jsonb('response').$type<Record<string, unknown>>().notNull(),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.operationId] })],
);
