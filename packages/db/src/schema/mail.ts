import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  date,
  unique,
  index,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { organizations, persons } from './core';
import { user } from './auth';
import { membershipFeeAssessments } from './finance';
import { eventOccurrences } from './events';

export const mailSettings = pgTable(
  'mail_settings',
  {
    organizationId: uuid('organization_id')
      .primaryKey()
      .references(() => organizations.id),
    automaticFeeReminders: boolean('automatic_fee_reminders').notNull().default(false),
    reminderIntervalDays: integer('reminder_interval_days').notNull().default(14),
    enabledBy: uuid('enabled_by')
      .notNull()
      .references(() => user.id),
    lastRunOn: date('last_run_on'),
  },
  (t) => [check('mail_reminder_interval', sql`${t.reminderIntervalDays} between 7 and 90`)],
);

export const mailMessages = pgTable(
  'mail_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    kind: text('kind').$type<'fee_reminder' | 'event_invitation'>().notNull(),
    personId: uuid('person_id').notNull(),
    assessmentId: uuid('assessment_id'),
    eventId: uuid('event_id'),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => user.id),
    recipient: text('recipient').notNull(),
    language: text('language').$type<'de' | 'it'>().notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    state: text('state')
      .$type<'queued' | 'sending' | 'sent' | 'failed' | 'uncertain' | 'cancelled'>()
      .notNull()
      .default('queued'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    errorCode: text('error_code'),
  },
  (t) => [
    unique('mail_messages_org_dedupe').on(t.organizationId, t.dedupeKey),
    index('mail_messages_queue_idx').on(t.state, t.createdAt),
    index('mail_messages_org_idx').on(t.organizationId, t.createdAt),
    foreignKey({
      columns: [t.organizationId, t.personId],
      foreignColumns: [persons.organizationId, persons.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.assessmentId],
      foreignColumns: [membershipFeeAssessments.organizationId, membershipFeeAssessments.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.eventId],
      foreignColumns: [eventOccurrences.organizationId, eventOccurrences.id],
    }),
    check('mail_message_kind', sql`${t.kind} in ('fee_reminder','event_invitation')`),
    check(
      'mail_message_source',
      sql`(${t.kind}='fee_reminder' and ${t.assessmentId} is not null and ${t.eventId} is null) or (${t.kind}='event_invitation' and ${t.assessmentId} is null and ${t.eventId} is not null)`,
    ),
    check(
      'mail_message_state',
      sql`${t.state} in ('queued','sending','sent','failed','uncertain','cancelled')`,
    ),
    check('mail_message_language', sql`${t.language} in ('de','it')`),
    check(
      'mail_message_subject',
      sql`length(${t.subject}) between 1 and 500 and ${t.subject} !~ E'[\\r\\n]'`,
    ),
  ],
);
