import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  timestamp,
  date,
  boolean,
  jsonb,
  unique,
  index,
  uniqueIndex,
  foreignKey,
  check,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { organizations, persons, organizationUserRoles, role } from './core';
import { user } from './auth';
import { eventOccurrences } from './events';
import { documents } from './documents';
import type { EventI18n } from './events';
import { created, updated, creator } from './columns';
export const volunteerType = pgEnum('volunteer_type', ['regular', 'occasional']);
export const engagementStatus = pgEnum('volunteer_engagement_status', [
  'active',
  'paused',
  'ended',
]);
export const assignmentRole = pgEnum('volunteer_assignment_role', ['helper', 'lead']);
export const assignmentStatus = pgEnum('volunteer_assignment_status', [
  'planned',
  'completed',
  'cancelled',
]);
export const timeEntryStatus = pgEnum('volunteer_time_status', [
  'draft',
  'submitted',
  'confirmed',
  'rejected',
]);
export const timeEntrySource = pgEnum('volunteer_time_source', ['manual', 'attendance']);
export const registerSection = pgEnum('volunteer_register_section', ['main', 'occasional']);
export const registerEntryType = pgEnum('volunteer_register_entry_type', [
  'admission',
  'exit',
  'correction',
]);
export const snapshotStatus = pgEnum('volunteer_snapshot_status', [
  'signature_pending',
  'signature_imported',
  'verified',
  'verification_failed',
]);
export const insuranceType = pgEnum('insurance_type', ['accident', 'illness', 'liability']);
export const insuredGroup = pgEnum('insured_group', ['regular', 'occasional', 'all', 'named']);
export const policyStatus = pgEnum('insurance_policy_status', [
  'draft',
  'active',
  'expired',
  'cancelled',
]);
export const complianceKind = pgEnum('compliance_kind', ['legal', 'recommendation', 'internal']);
export const complianceTopic = pgEnum('compliance_topic', [
  'runts_annual_report',
  'organ_change',
  'association_data',
  'board_term',
  'insurance',
  'register_snapshot',
  'document_review',
  'custom',
]);
export const deadlineStatus = pgEnum('compliance_deadline_status', [
  'open',
  'in_progress',
  'done',
  'not_applicable',
]);

// A. Operational volunteer management. Personal data stays in persons.
export const volunteerEngagements = pgTable(
  'volunteer_engagements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    personId: uuid('person_id').notNull(),
    volunteerType: volunteerType('volunteer_type').notNull(),
    status: engagementStatus('status').notNull().default('active'),
    startedOn: date('started_on').notNull(),
    endedOn: date('ended_on'),
    endReason: text('end_reason').notNull().default(''),
    focusAreas: jsonb('focus_areas').$type<string[]>().notNull().default([]),
    activity: text('activity').notNull().default(''),
    notes: text('notes').notNull().default(''),
    version: integer('version').notNull().default(1),
    createdBy: creator(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique('volunteer_engagements_org_id').on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.personId],
      foreignColumns: [persons.organizationId, persons.id],
    }),
    // At most one open engagement per person; re-entries start a new engagement.
    uniqueIndex('volunteer_engagements_open_person')
      .on(t.organizationId, t.personId)
      .where(sql`${t.endedOn} is null`),
    index('volunteer_engagements_org_status').on(t.organizationId, t.status, t.volunteerType),
    check('volunteer_engagement_dates', sql`${t.endedOn} is null or ${t.endedOn}>=${t.startedOn}`),
    check('volunteer_engagement_ended', sql`(${t.status}='ended')=(${t.endedOn} is not null)`),
    check('volunteer_engagement_focus', sql`jsonb_typeof(${t.focusAreas})='array'`),
  ],
);
export const volunteerEngagementHistory = pgTable(
  'volunteer_engagement_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    engagementId: uuid('engagement_id').notNull(),
    version: integer('version').notNull(),
    action: text('action').notNull(),
    // Field names and new values without register-relevant personal data.
    changes: jsonb('changes').$type<Record<string, unknown>>().notNull(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => user.id),
    createdAt: created(),
  },
  (t) => [
    unique('volunteer_engagement_history_version').on(t.organizationId, t.engagementId, t.version),
    foreignKey({
      columns: [t.organizationId, t.engagementId],
      foreignColumns: [volunteerEngagements.organizationId, volunteerEngagements.id],
    }),
  ],
);
export const volunteerAssignments = pgTable(
  'volunteer_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    engagementId: uuid('engagement_id').notNull(),
    eventOccurrenceId: uuid('event_occurrence_id'),
    role: assignmentRole('role').notNull().default('helper'),
    task: text('task').notNull(),
    plannedStart: timestamp('planned_start', { withTimezone: true }).notNull(),
    plannedEnd: timestamp('planned_end', { withTimezone: true }).notNull(),
    responsibleUserId: uuid('responsible_user_id'),
    project: text('project').notNull().default(''),
    status: assignmentStatus('status').notNull().default('planned'),
    version: integer('version').notNull().default(1),
    createdBy: creator(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique('volunteer_assignments_org_id').on(t.organizationId, t.id),
    unique('volunteer_assignments_engagement_id').on(t.organizationId, t.engagementId, t.id),
    foreignKey({
      columns: [t.organizationId, t.engagementId],
      foreignColumns: [volunteerEngagements.organizationId, volunteerEngagements.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.eventOccurrenceId],
      foreignColumns: [eventOccurrences.organizationId, eventOccurrences.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.responsibleUserId],
      foreignColumns: [organizationUserRoles.organizationId, organizationUserRoles.userId],
    }),
    uniqueIndex('volunteer_assignments_event_once')
      .on(t.organizationId, t.engagementId, t.eventOccurrenceId)
      .where(sql`${t.status}<>'cancelled' and ${t.eventOccurrenceId} is not null`),
    index('volunteer_assignments_dates').on(t.organizationId, t.plannedStart),
    index('volunteer_assignments_event').on(t.organizationId, t.eventOccurrenceId),
    check('volunteer_assignment_times', sql`${t.plannedEnd}>${t.plannedStart}`),
    check('volunteer_assignment_task', sql`length(trim(${t.task})) between 1 and 500`),
  ],
);
export const volunteerTimeEntries = pgTable(
  'volunteer_time_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    engagementId: uuid('engagement_id').notNull(),
    assignmentId: uuid('assignment_id'),
    actualStart: timestamp('actual_start', { withTimezone: true }).notNull(),
    actualEnd: timestamp('actual_end', { withTimezone: true }).notNull(),
    breakMinutes: integer('break_minutes').notNull().default(0),
    minutes: integer('minutes').notNull(),
    description: text('description').notNull().default(''),
    project: text('project').notNull().default(''),
    status: timeEntryStatus('status').notNull().default('draft'),
    source: timeEntrySource('source').notNull().default('manual'),
    confirmedBy: uuid('confirmed_by').references(() => user.id),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdBy: creator(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique('volunteer_time_entries_org_id').on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.engagementId],
      foreignColumns: [volunteerEngagements.organizationId, volunteerEngagements.id],
    }),
    // The assignment must belong to the same engagement.
    foreignKey({
      columns: [t.organizationId, t.engagementId, t.assignmentId],
      foreignColumns: [
        volunteerAssignments.organizationId,
        volunteerAssignments.engagementId,
        volunteerAssignments.id,
      ],
    }),
    uniqueIndex('volunteer_time_attendance_once')
      .on(t.organizationId, t.assignmentId)
      .where(sql`${t.source}='attendance' and ${t.status}<>'rejected'`),
    index('volunteer_time_engagement').on(t.organizationId, t.engagementId, t.actualStart),
    check('volunteer_time_order', sql`${t.actualEnd}>${t.actualStart}`),
    check('volunteer_time_length', sql`${t.actualEnd}-${t.actualStart}<=interval '24 hours'`),
    check(
      'volunteer_time_minutes',
      sql`${t.breakMinutes}>=0 and ${t.minutes}>0 and ${t.minutes}=floor(extract(epoch from (${t.actualEnd}-${t.actualStart}))/60)::int-${t.breakMinutes}`,
    ),
    check(
      'volunteer_time_confirmed',
      sql`(${t.status}='confirmed')=(${t.confirmedBy} is not null and ${t.confirmedAt} is not null)`,
    ),
  ],
);
export const volunteerTimeEntryHistory = pgTable(
  'volunteer_time_entry_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    timeEntryId: uuid('time_entry_id').notNull(),
    version: integer('version').notNull(),
    action: text('action').notNull(),
    reason: text('reason').notNull().default(''),
    previous: jsonb('previous').$type<Record<string, unknown>>().notNull(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => user.id),
    createdAt: created(),
  },
  (t) => [
    unique('volunteer_time_history_version').on(t.organizationId, t.timeEntryId, t.version),
    foreignKey({
      columns: [t.organizationId, t.timeEntryId],
      foreignColumns: [volunteerTimeEntries.organizationId, volunteerTimeEntries.id],
    }),
  ],
);

// B. Statutory register: append-only, hash-chained per organization and section.
export const volunteerRegisterEntries = pgTable(
  'volunteer_register_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    section: registerSection('section').notNull(),
    entryNumber: integer('entry_number').notNull(),
    engagementId: uuid('engagement_id').notNull(),
    personId: uuid('person_id').notNull(),
    entryType: registerEntryType('entry_type').notNull(),
    effectiveDate: date('effective_date').notNull(),
    correctsEntryId: uuid('corrects_entry_id'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    reason: text('reason').notNull().default(''),
    previousHash: text('previous_hash'),
    entryHash: text('entry_hash').notNull(),
    recordedBy: uuid('recorded_by')
      .notNull()
      .references(() => user.id),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('volunteer_register_org_id').on(t.organizationId, t.id),
    unique('volunteer_register_number').on(t.organizationId, t.section, t.entryNumber),
    unique('volunteer_register_hash').on(t.entryHash),
    foreignKey({
      columns: [t.organizationId, t.engagementId],
      foreignColumns: [volunteerEngagements.organizationId, volunteerEngagements.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.personId],
      foreignColumns: [persons.organizationId, persons.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.correctsEntryId],
      foreignColumns: [t.organizationId, t.id],
    }),
    index('volunteer_register_engagement').on(t.organizationId, t.engagementId, t.entryNumber),
    check('volunteer_register_number_valid', sql`${t.entryNumber}>0`),
    check('volunteer_register_hash_valid', sql`${t.entryHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'volunteer_register_correction',
      sql`(${t.entryType}='correction')=(${t.correctsEntryId} is not null) and (${t.entryType}<>'correction' or length(trim(${t.reason}))>0)`,
    ),
  ],
);
export const volunteerRegisterSettings = pgTable(
  'volunteer_register_settings',
  {
    organizationId: uuid('organization_id')
      .primaryKey()
      .references(() => organizations.id),
    occasionalSection: boolean('occasional_section').notNull().default(true),
    signatureIntervalDays: integer('signature_interval_days').notNull().default(365),
    signatureProcedure: text('signature_procedure').notNull().default(''),
    insuranceRetentionYears: integer('insurance_retention_years').notNull().default(10),
    registerRetentionYears: integer('register_retention_years').notNull().default(10),
    expiryWarningDays: integer('expiry_warning_days').notNull().default(60),
    legalApprovalReference: text('legal_approval_reference').notNull().default(''),
    legalApprovedOn: date('legal_approved_on'),
    version: integer('version').notNull().default(1),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => user.id),
    updatedAt: updated(),
  },
  (t) => [
    check(
      'volunteer_register_retention',
      sql`${t.insuranceRetentionYears}>=10 and ${t.registerRetentionYears}>=10`,
    ),
    check('volunteer_register_interval', sql`${t.signatureIntervalDays} between 1 and 366`),
    check(
      'volunteer_register_approval',
      sql`${t.legalApprovedOn} is null or length(trim(${t.legalApprovalReference}))>0`,
    ),
  ],
);
// C. Finalized register states. Content columns never change after insert.
export const volunteerRegisterSnapshots = pgTable(
  'volunteer_register_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    snapshotNumber: integer('snapshot_number').notNull(),
    cutoffDate: date('cutoff_date').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull(),
    mainLastNumber: integer('main_last_number').notNull(),
    occasionalLastNumber: integer('occasional_last_number').notNull(),
    mainCount: integer('main_count').notNull(),
    occasionalCount: integer('occasional_count').notNull(),
    payloadSha256: text('payload_sha256').notNull(),
    sha256: text('sha256').notNull(),
    previousSnapshotId: uuid('previous_snapshot_id'),
    previousSha256: text('previous_sha256'),
    documentId: uuid('document_id').notNull(),
    status: snapshotStatus('status').notNull().default('signature_pending'),
    signedDocumentId: uuid('signed_document_id'),
    timestampDocumentId: uuid('timestamp_document_id'),
    technicalChecks: jsonb('technical_checks')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    verification: jsonb('verification').$type<Record<string, unknown>>().notNull().default({}),
    version: integer('version').notNull().default(1),
    createdBy: creator(),
    createdAt: created(),
  },
  (t) => [
    unique('volunteer_snapshots_org_id').on(t.organizationId, t.id),
    unique('volunteer_snapshots_number').on(t.organizationId, t.snapshotNumber),
    unique('volunteer_snapshots_previous').on(t.organizationId, t.previousSnapshotId),
    foreignKey({
      columns: [t.organizationId, t.previousSnapshotId],
      foreignColumns: [t.organizationId, t.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.documentId],
      foreignColumns: [documents.organizationId, documents.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.signedDocumentId],
      foreignColumns: [documents.organizationId, documents.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.timestampDocumentId],
      foreignColumns: [documents.organizationId, documents.id],
    }),
    check(
      'volunteer_snapshot_hashes',
      sql`${t.sha256} ~ '^[0-9a-f]{64}$' and ${t.payloadSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'volunteer_snapshot_chain',
      sql`(${t.snapshotNumber}=1 and ${t.previousSnapshotId} is null and ${t.previousSha256} is null) or (${t.snapshotNumber}>1 and ${t.previousSnapshotId} is not null and ${t.previousSha256} ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      'volunteer_snapshot_signed',
      sql`${t.status}='signature_pending' or ${t.signedDocumentId} is not null`,
    ),
  ],
);

export const insurancePolicies = pgTable(
  'insurance_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    insurer: text('insurer').notNull(),
    policyNumber: text('policy_number').notNull(),
    coverageTypes: insuranceType('coverage_types').array().notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    insuredGroup: insuredGroup('insured_group').notNull().default('all'),
    insuredGroupDescription: text('insured_group_description').notNull().default(''),
    status: policyStatus('status').notNull().default('active'),
    notes: text('notes').notNull().default(''),
    version: integer('version').notNull().default(1),
    createdBy: creator(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique('insurance_policies_org_id').on(t.organizationId, t.id),
    unique('insurance_policies_number').on(t.organizationId, t.insurer, t.policyNumber),
    index('insurance_policies_dates').on(t.organizationId, t.endsOn),
    check('insurance_policy_dates', sql`${t.endsOn}>=${t.startsOn}`),
    check(
      'insurance_policy_types',
      sql`cardinality(${t.coverageTypes}) between 1 and 3 and array_position(${t.coverageTypes}, null) is null`,
    ),
    check(
      'insurance_policy_text',
      sql`length(trim(${t.insurer})) between 1 and 200 and length(trim(${t.policyNumber})) between 1 and 100`,
    ),
  ],
);
export const insuranceCoverages = pgTable(
  'insurance_coverages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    policyId: uuid('policy_id').notNull(),
    engagementId: uuid('engagement_id').notNull(),
    coveredFrom: date('covered_from').notNull(),
    coveredTo: date('covered_to'),
    notes: text('notes').notNull().default(''),
    endReason: text('end_reason').notNull().default(''),
    createdBy: creator(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique('insurance_coverages_org_id').on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.policyId],
      foreignColumns: [insurancePolicies.organizationId, insurancePolicies.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.engagementId],
      foreignColumns: [volunteerEngagements.organizationId, volunteerEngagements.id],
    }),
    index('insurance_coverages_engagement').on(t.organizationId, t.engagementId),
    check(
      'insurance_coverage_dates',
      sql`${t.coveredTo} is null or ${t.coveredTo}>=${t.coveredFrom}`,
    ),
  ],
);
export const insurerNotifications = pgTable(
  'insurer_notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    policyId: uuid('policy_id').notNull(),
    notifiedOn: date('notified_on').notNull(),
    method: text('method').notNull(),
    listSha256: text('list_sha256').notNull(),
    notes: text('notes').notNull().default(''),
    createdBy: creator(),
    createdAt: created(),
  },
  (t) => [
    unique('insurer_notifications_org_id').on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.policyId],
      foreignColumns: [insurancePolicies.organizationId, insurancePolicies.id],
    }),
    check('insurer_notification_hash', sql`${t.listSha256} ~ '^[0-9a-f]{64}$'`),
  ],
);
export const insurerNotificationItems = pgTable(
  'insurer_notification_items',
  {
    organizationId: uuid('organization_id').notNull(),
    notificationId: uuid('notification_id').notNull(),
    engagementId: uuid('engagement_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.notificationId, t.engagementId] }),
    foreignKey({
      columns: [t.organizationId, t.notificationId],
      foreignColumns: [insurerNotifications.organizationId, insurerNotifications.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.engagementId],
      foreignColumns: [volunteerEngagements.organizationId, volunteerEngagements.id],
    }),
  ],
);

// Versioned rules: a change inserts a new version and closes the previous one.
export const complianceRules = pgTable(
  'compliance_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    ruleKey: text('rule_key').notNull(),
    version: integer('version').notNull(),
    kind: complianceKind('kind').notNull(),
    topic: complianceTopic('topic').notNull(),
    titleI18n: jsonb('title_i18n').$type<EventI18n>().notNull(),
    descriptionI18n: jsonb('description_i18n').$type<EventI18n>().notNull(),
    legalBasis: text('legal_basis').notNull().default(''),
    sourceUrl: text('source_url').notNull().default(''),
    responsibleRole: role('responsible_role'),
    calculation: jsonb('calculation').$type<Record<string, unknown>>().notNull(),
    reminderDays: jsonb('reminder_days').$type<number[]>().notNull().default([30, 7]),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    active: boolean('active').notNull().default(true),
    reviewNote: text('review_note').notNull().default(''),
    starter: boolean('starter').notNull().default(false),
    createdBy: creator(),
    createdAt: created(),
  },
  (t) => [
    unique('compliance_rules_org_id').on(t.organizationId, t.id),
    unique('compliance_rules_version').on(t.organizationId, t.ruleKey, t.version),
    uniqueIndex('compliance_rules_current')
      .on(t.organizationId, t.ruleKey)
      .where(sql`${t.validTo} is null`),
    check('compliance_rule_dates', sql`${t.validTo} is null or ${t.validTo}>=${t.validFrom}`),
    check('compliance_rule_legal', sql`${t.kind}<>'legal' or length(trim(${t.legalBasis}))>0`),
    check('compliance_rule_version', sql`${t.version}>0`),
  ],
);
export const complianceDeadlines = pgTable(
  'compliance_deadlines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    ruleId: uuid('rule_id'),
    ruleVersion: integer('rule_version'),
    kind: complianceKind('kind').notNull(),
    topic: complianceTopic('topic').notNull(),
    titleI18n: jsonb('title_i18n').$type<EventI18n>().notNull(),
    descriptionI18n: jsonb('description_i18n').$type<EventI18n>().notNull(),
    legalBasis: text('legal_basis').notNull().default(''),
    responsibleRole: role('responsible_role'),
    responsibleUserId: uuid('responsible_user_id'),
    sourceKey: text('source_key'),
    sourceLabel: text('source_label').notNull().default(''),
    dueDate: date('due_date').notNull(),
    reminderDays: jsonb('reminder_days').$type<number[]>().notNull().default([30, 7]),
    status: deadlineStatus('status').notNull().default('open'),
    completedOn: date('completed_on'),
    completedBy: uuid('completed_by').references(() => user.id),
    protocolNumber: text('protocol_number').notNull().default(''),
    version: integer('version').notNull().default(1),
    createdBy: creator(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique('compliance_deadlines_org_id').on(t.organizationId, t.id),
    // Generated deadlines are unique per rule key and source occurrence.
    unique('compliance_deadlines_source').on(t.organizationId, t.sourceKey),
    foreignKey({
      columns: [t.organizationId, t.ruleId],
      foreignColumns: [complianceRules.organizationId, complianceRules.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.responsibleUserId],
      foreignColumns: [organizationUserRoles.organizationId, organizationUserRoles.userId],
    }),
    index('compliance_deadlines_due').on(t.organizationId, t.status, t.dueDate),
    check(
      'compliance_deadline_done',
      sql`(${t.status}='done')=(${t.completedOn} is not null and ${t.completedBy} is not null)`,
    ),
    check('compliance_deadline_rule', sql`(${t.ruleId} is null)=(${t.ruleVersion} is null)`),
  ],
);
export const complianceEvidence = pgTable(
  'compliance_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    deadlineId: uuid('deadline_id').notNull(),
    documentId: uuid('document_id'),
    reference: text('reference').notNull().default(''),
    description: text('description').notNull().default(''),
    createdBy: creator(),
    createdAt: created(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.deadlineId],
      foreignColumns: [complianceDeadlines.organizationId, complianceDeadlines.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.documentId],
      foreignColumns: [documents.organizationId, documents.id],
    }),
    index('compliance_evidence_deadline').on(t.organizationId, t.deadlineId),
    check(
      'compliance_evidence_present',
      sql`${t.documentId} is not null or length(trim(${t.reference}))>0`,
    ),
  ],
);
export const complianceDeadlineHistory = pgTable(
  'compliance_deadline_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    deadlineId: uuid('deadline_id').notNull(),
    action: text('action').notNull(),
    fromStatus: deadlineStatus('from_status'),
    toStatus: deadlineStatus('to_status'),
    note: text('note').notNull().default(''),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => user.id),
    createdAt: created(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.deadlineId],
      foreignColumns: [complianceDeadlines.organizationId, complianceDeadlines.id],
    }),
    index('compliance_history_deadline').on(t.organizationId, t.deadlineId, t.createdAt),
  ],
);
