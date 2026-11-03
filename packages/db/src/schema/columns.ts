import { timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';

export const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
export const creator = () =>
  uuid('created_by')
    .notNull()
    .references(() => user.id);
