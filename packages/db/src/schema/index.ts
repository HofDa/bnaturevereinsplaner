import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  date,
  boolean,
  jsonb,
  unique,
  primaryKey,
  foreignKey,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
export * from './auth';
const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
const address = () => ({
  street: text('street').notNull().default(''),
  postalCode: text('postal_code').notNull().default(''),
  city: text('city').notNull().default(''),
  country: text('country').notNull().default('IT'),
});
export const language = pgEnum('language', ['de', 'it']);
export const organizationType = pgEnum('organization_type', ['ODV', 'APS', 'ETS', 'other']);
export const role = pgEnum('organization_role', [
  'admin',
  'board',
  'treasurer',
  'project_lead',
  'member',
]);
export const memberStatus = pgEnum('membership_status', [
  'active',
  'pending',
  'inactive',
  'resigned',
]);
export const memberType = pgEnum('membership_type', ['ordinary', 'supporting', 'honorary']);
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  fiscalCode: text('fiscal_code').notNull().default(''),
  organizationType: organizationType('organization_type').notNull().default('other'),
  ...address(),
  locale: language('locale').notNull().default('de'),
  timezone: text('timezone').notNull().default('Europe/Rome'),
  ...timestamps(),
});
export const persons = pgTable(
  'persons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    dateOfBirth: date('date_of_birth'),
    fiscalCode: text('fiscal_code').notNull().default(''),
    email: text('email').notNull().default(''),
    phone: text('phone').notNull().default(''),
    ...address(),
    preferredLanguage: language('preferred_language').notNull().default('de'),
    ...timestamps(),
  },
  (t) => [
    unique('persons_org_id_unique').on(t.organizationId, t.id),
    index('persons_org_name_idx').on(t.organizationId, t.lastName, t.firstName),
    check(
      'persons_names_not_empty',
      sql`length(trim(${t.firstName})) > 0 and length(trim(${t.lastName})) > 0`,
    ),
    index('persons_org_email_idx').on(t.organizationId, t.email),
  ],
);
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    personId: uuid('person_id').notNull(),
    membershipNumber: text('membership_number').notNull(),
    membershipType: memberType('membership_type').notNull().default('ordinary'),
    status: memberStatus('status').notNull().default('active'),
    joinedAt: date('joined_at').notNull(),
    endedAt: date('ended_at'),
    ...timestamps(),
  },
  (t) => [
    unique('memberships_org_number_unique').on(t.organizationId, t.membershipNumber),
    unique('memberships_org_person_unique').on(t.organizationId, t.personId),
    foreignKey({
      columns: [t.organizationId, t.personId],
      foreignColumns: [persons.organizationId, persons.id],
    }),
    index('memberships_org_status_idx').on(t.organizationId, t.status),
    index('memberships_org_joined_idx').on(t.organizationId, t.joinedAt),
    check('membership_dates_valid', sql`${t.endedAt} is null or ${t.endedAt} >= ${t.joinedAt}`),
    check('membership_active_no_end', sql`${t.status} <> 'active' or ${t.endedAt} is null`),
    check(
      'membership_resigned_has_end',
      sql`${t.status} <> 'resigned' or ${t.endedAt} is not null`,
    ),
  ],
);
export const organizationUserRoles = pgTable(
  'organization_user_roles',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: role('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.userId] }),
    index('roles_user_idx').on(t.userId),
  ],
);
export const personUserLinks = pgTable(
  'person_user_links',
  {
    organizationId: uuid('organization_id').notNull(),
    personId: uuid('person_id').notNull(),
    userId: uuid('user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.personId] }),
    unique('person_user_org_user_unique').on(t.organizationId, t.userId),
    foreignKey({
      columns: [t.organizationId, t.personId],
      foreignColumns: [persons.organizationId, persons.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.userId],
      foreignColumns: [organizationUserRoles.organizationId, organizationUserRoles.userId],
    }).onDelete('cascade'),
  ],
);
export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    active: boolean('active').notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    unique('groups_org_id_unique').on(t.organizationId, t.id),
    unique('groups_org_name_unique').on(t.organizationId, t.name),
    index('groups_org_active_idx').on(t.organizationId, t.active),
  ],
);
export const groupMembers = pgTable(
  'group_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    groupId: uuid('group_id').notNull(),
    personId: uuid('person_id').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('group_members_pair_unique').on(t.groupId, t.personId),
    foreignKey({
      columns: [t.organizationId, t.groupId],
      foreignColumns: [groups.organizationId, groups.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.personId],
      foreignColumns: [persons.organizationId, persons.id],
    }),
    index('group_members_person_idx').on(t.organizationId, t.personId),
  ],
);
export const boardMandates = pgTable(
  'board_mandates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    personId: uuid('person_id').notNull(),
    position: text('position').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date'),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.personId],
      foreignColumns: [persons.organizationId, persons.id],
    }),
    unique('board_mandate_unique').on(t.organizationId, t.personId, t.position, t.startDate),
    index('board_org_dates_idx').on(t.organizationId, t.startDate, t.endDate),
    check('board_dates_valid', sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`),
  ],
);
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    actorUserId: uuid('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
    changeMetadata: jsonb('change_metadata').$type<{ fields: string[] }>().notNull(),
  },
  (t) => [
    index('audit_org_timestamp_idx').on(t.organizationId, t.timestamp),
    index('audit_entity_idx').on(t.organizationId, t.entityType, t.entityId),
  ],
);
