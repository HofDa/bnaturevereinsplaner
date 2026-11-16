import { pgTable, uuid, text, integer, timestamp, unique, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Unexpected failures of the browser app and the API, one row per distinct problem with a
// counter instead of one row per occurrence. Installation-wide: a crash is not club data.
export const errorReports = pgTable(
  'error_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').$type<'web' | 'api'>().notNull(),
    // Hash of error name and top stack frames: the same bug maps to the same row.
    fingerprint: text('fingerprint').notNull(),
    name: text('name').notNull(),
    message: text('message').notNull(),
    stack: text('stack').notNull().default(''),
    // Route pattern (API) or page path without query (web); never contains form input.
    location: text('location').notNull().default(''),
    release: text('release').notNull().default(''),
    userAgent: text('user_agent').notNull().default(''),
    occurrences: integer('occurrences').notNull().default(1),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('error_reports_fingerprint').on(t.source, t.fingerprint),
    index('error_reports_last_seen').on(t.lastSeenAt),
    check('error_reports_source', sql`${t.source} in ('web','api')`),
  ],
);
