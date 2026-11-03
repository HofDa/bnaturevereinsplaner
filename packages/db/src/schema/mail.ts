import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  date,
  jsonb,
  unique,
  index,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { organizations, persons } from './core';
import { user } from './auth';
import { membershipFeeAssessments } from './finance';
import { eventOccurrences } from './events';
import { complianceDeadlines } from './volunteers';

type I18n = { de: string; it: string };
export type MailKindValue =
  | 'fee_reminder'
  | 'event_invitation'
  | 'deadline_reminder'
  | 'newsletter'
  | 'account_invitation'
  | 'password_reset'
  | 'test'
  | 'community_digest';

export const mailSettings = pgTable(
  'mail_settings',
  {
    organizationId: uuid('organization_id')
      .primaryKey()
      .references(() => organizations.id),
    automaticFeeReminders: boolean('automatic_fee_reminders').notNull().default(false),
    reminderIntervalDays: integer('reminder_interval_days').notNull().default(14),
    automaticDeadlineReminders: boolean('automatic_deadline_reminders').notNull().default(false),
    enabledBy: uuid('enabled_by')
      .notNull()
      .references(() => user.id),
    lastRunOn: date('last_run_on'),
    deadlineLastRunOn: date('deadline_last_run_on'),
  },
  (t) => [check('mail_reminder_interval', sql`${t.reminderIntervalDays} between 7 and 90`)],
);

// Newsletter drafts are composed server-side; the send flow only references them by ID.
export const mailNewsletters = pgTable(
  'mail_newsletters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    subjectI18n: jsonb('subject_i18n').$type<I18n>().notNull(),
    bodyI18n: jsonb('body_i18n').$type<I18n>().notNull(),
    // Empty list: all active members.
    groupIds: jsonb('group_ids').$type<string[]>().notNull().default([]),
    status: text('status').$type<'draft' | 'sent' | 'withdrawn'>().notNull().default('draft'),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [
    unique('mail_newsletters_org_id').on(t.organizationId, t.id),
    index('mail_newsletters_org_idx').on(t.organizationId, t.createdAt),
    check('mail_newsletter_status', sql`${t.status} in ('draft','sent','withdrawn')`),
    check('mail_newsletter_sent', sql`(${t.status}='sent')=(${t.sentAt} is not null)`),
  ],
);

export const mailMessages = pgTable(
  'mail_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    kind: text('kind').$type<MailKindValue>().notNull(),
    personId: uuid('person_id'),
    userId: uuid('user_id').references(() => user.id),
    assessmentId: uuid('assessment_id'),
    eventId: uuid('event_id'),
    deadlineId: uuid('deadline_id'),
    newsletterId: uuid('newsletter_id'),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => user.id),
    recipient: text('recipient').notNull(),
    language: text('language').$type<'de' | 'it'>().notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    // Encrypted one-time link (account invitation, password reset); removed once handled.
    secretCiphertext: text('secret_ciphertext'),
    dedupeKey: text('dedupe_key').notNull(),
    state: text('state')
      .$type<'queued' | 'sending' | 'sent' | 'failed' | 'uncertain' | 'cancelled'>()
      .notNull()
      .default('queued'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    errorCode: text('error_code'),
    resolvedBy: uuid('resolved_by').references(() => user.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolution: text('resolution').$type<'retry' | 'mark_sent' | 'dismiss'>(),
    resolutionNote: text('resolution_note').notNull().default(''),
  },
  (t) => [
    unique('mail_messages_org_dedupe').on(t.organizationId, t.dedupeKey),
    index('mail_messages_queue_idx').on(t.state, t.createdAt),
    index('mail_messages_org_idx').on(t.organizationId, t.createdAt),
    index('mail_messages_user_idx').on(t.userId, t.kind, t.createdAt),
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
    foreignKey({
      columns: [t.organizationId, t.deadlineId],
      foreignColumns: [complianceDeadlines.organizationId, complianceDeadlines.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.newsletterId],
      foreignColumns: [mailNewsletters.organizationId, mailNewsletters.id],
    }),
    check(
      'mail_message_kind',
      sql`${t.kind} in ('fee_reminder','event_invitation','deadline_reminder','newsletter','account_invitation','password_reset','test','community_digest')`,
    ),
    // Exactly the source columns of each kind are set.
    check(
      'mail_message_source',
      sql`case ${t.kind}
        when 'fee_reminder' then ${t.personId} is not null and ${t.assessmentId} is not null and num_nonnulls(${t.userId}, ${t.eventId}, ${t.deadlineId}, ${t.newsletterId}) = 0
        when 'event_invitation' then ${t.personId} is not null and ${t.eventId} is not null and num_nonnulls(${t.userId}, ${t.assessmentId}, ${t.deadlineId}, ${t.newsletterId}) = 0
        when 'deadline_reminder' then ${t.userId} is not null and ${t.deadlineId} is not null and num_nonnulls(${t.personId}, ${t.assessmentId}, ${t.eventId}, ${t.newsletterId}) = 0
        when 'newsletter' then ${t.personId} is not null and ${t.newsletterId} is not null and num_nonnulls(${t.userId}, ${t.assessmentId}, ${t.eventId}, ${t.deadlineId}) = 0
        else ${t.userId} is not null and num_nonnulls(${t.personId}, ${t.assessmentId}, ${t.eventId}, ${t.deadlineId}, ${t.newsletterId}) = 0
      end`,
    ),
    check(
      'mail_message_secret',
      sql`${t.secretCiphertext} is null or ${t.kind} in ('account_invitation','password_reset')`,
    ),
    check(
      'mail_message_state',
      sql`${t.state} in ('queued','sending','sent','failed','uncertain','cancelled')`,
    ),
    check(
      'mail_message_resolution',
      sql`(${t.resolution} is null) = (${t.resolvedAt} is null and ${t.resolvedBy} is null) and (${t.resolution} is null or ${t.resolution} in ('retry','mark_sent','dismiss'))`,
    ),
    check('mail_message_language', sql`${t.language} in ('de','it')`),
    check(
      'mail_message_subject',
      sql`length(${t.subject}) between 1 and 500 and ${t.subject} !~ E'[\\r\\n]'`,
    ),
  ],
);
