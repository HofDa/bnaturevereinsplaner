import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  jsonb,
  boolean,
  integer,
  timestamp,
  date,
  unique,
  primaryKey,
  index,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { organizations, persons } from './core';
import { user } from './auth';

// Club-defined extra member fields; deactivated instead of deleted so stored values keep meaning.
export const memberFieldDefinitions = pgTable(
  'member_field_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    labelI18n: jsonb('label_i18n').$type<{ de: string; it: string }>().notNull(),
    type: text('type').$type<'text' | 'number' | 'date' | 'boolean' | 'select'>().notNull(),
    options: jsonb('options').$type<string[]>().notNull().default([]),
    position: integer('position').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('member_field_definitions_org_id').on(t.organizationId, t.id),
    index('member_field_definitions_org_idx').on(t.organizationId, t.position),
    check('member_field_type', sql`${t.type} in ('text','number','date','boolean','select')`),
  ],
);

export const personFieldValues = pgTable(
  'person_field_values',
  {
    organizationId: uuid('organization_id').notNull(),
    personId: uuid('person_id').notNull(),
    fieldId: uuid('field_id').notNull(),
    value: jsonb('value').$type<string | number | boolean>().notNull(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => user.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.personId, t.fieldId] }),
    foreignKey({
      columns: [t.organizationId, t.personId],
      foreignColumns: [persons.organizationId, persons.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.fieldId],
      foreignColumns: [memberFieldDefinitions.organizationId, memberFieldDefinitions.id],
    }),
  ],
);

// Append-only consent evidence: the latest row per kind is the current state.
export const personConsents = pgTable(
  'person_consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    personId: uuid('person_id').notNull(),
    kind: text('kind').$type<'data_processing' | 'photos'>().notNull(),
    granted: boolean('granted').notNull(),
    decidedOn: date('decided_on').notNull(),
    givenBy: text('given_by').notNull().default(''),
    note: text('note').notNull().default(''),
    recordedBy: uuid('recorded_by')
      .notNull()
      .references(() => user.id),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.personId],
      foreignColumns: [persons.organizationId, persons.id],
    }),
    index('person_consents_person_idx').on(t.organizationId, t.personId, t.kind, t.recordedAt),
    check('person_consent_kind', sql`${t.kind} in ('data_processing','photos')`),
  ],
);

export const personGuardians = pgTable(
  'person_guardians',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    personId: uuid('person_id').notNull(),
    name: text('name').notNull(),
    relationship: text('relationship').notNull().default(''),
    email: text('email').notNull().default(''),
    phone: text('phone').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.personId],
      foreignColumns: [persons.organizationId, persons.id],
    }),
    index('person_guardians_person_idx').on(t.organizationId, t.personId),
    check('person_guardian_name', sql`length(trim(${t.name})) > 0`),
  ],
);
