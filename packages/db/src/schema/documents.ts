import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  timestamp,
  boolean,
  unique,
  index,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { organizations, memberships } from './core';
import { user } from './auth';
import { cashbookEntries } from './ledger';
export const documentCategory = pgEnum('document_category', [
  'receipt',
  'contract',
  'minutes',
  'statute',
  'correspondence',
  'other',
]);
export const documentMediaType = pgEnum('document_media_type', [
  'application/pdf',
  'image/png',
  'image/jpeg',
]);
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    title: text('title').notNull(),
    category: documentCategory('category').notNull(),
    description: text('description').notNull().default(''),
    archived: boolean('archived').notNull().default(false),
    cashbookEntryId: uuid('cashbook_entry_id'),
    membershipId: uuid('membership_id'),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('documents_org_id_unique').on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.cashbookEntryId],
      foreignColumns: [cashbookEntries.organizationId, cashbookEntries.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.membershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }),
    index('documents_org_archived_idx').on(t.organizationId, t.archived, t.createdAt),
    index('documents_cashbook_idx').on(t.organizationId, t.cashbookEntryId),
    index('documents_membership_idx').on(t.organizationId, t.membershipId),
    check('document_title_valid', sql`length(trim(${t.title})) between 1 and 200`),
    check('document_version_valid', sql`${t.version}>0`),
  ],
);
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const documentVersions = pgTable(
  'document_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    documentId: uuid('document_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    filename: text('filename').notNull(),
    mediaType: documentMediaType('media_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    // Server-generated file name inside the private storage directory; never derived from input.
    storageKey: uuid('storage_key').notNull().unique(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('document_versions_number_unique').on(t.organizationId, t.documentId, t.versionNumber),
    foreignKey({
      columns: [t.organizationId, t.documentId],
      foreignColumns: [documents.organizationId, documents.id],
    }),
    check('document_version_number_valid', sql`${t.versionNumber}>0`),
    check(
      'document_size_valid',
      sql`${t.sizeBytes} between 1 and ${sql.raw(String(MAX_DOCUMENT_BYTES))}`,
    ),
    check('document_sha256_valid', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check('document_filename_valid', sql`length(${t.filename}) between 1 and 200`),
  ],
);
