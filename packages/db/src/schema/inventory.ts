import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  date,
  unique,
  uniqueIndex,
  index,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { organizations, persons } from './core';
import { user } from './auth';
import { created, updated, creator } from './columns';

export const inventoryCondition = pgEnum('inventory_condition', [
  'new',
  'good',
  'worn',
  'damaged',
  'defective',
]);
export const inventoryItemStatus = pgEnum('inventory_item_status', ['active', 'retired']);

// One row per item or per batch of identical items (e.g. 20 safety vests).
export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    inventoryNumber: text('inventory_number').notNull().default(''),
    name: text('name').notNull(),
    category: text('category').notNull().default(''),
    description: text('description').notNull().default(''),
    location: text('location').notNull().default(''),
    condition: inventoryCondition('condition').notNull().default('good'),
    quantity: integer('quantity').notNull().default(1),
    purchasedOn: date('purchased_on'),
    valueCents: integer('value_cents'),
    notes: text('notes').notNull().default(''),
    status: inventoryItemStatus('status').notNull().default('active'),
    retiredOn: date('retired_on'),
    retiredReason: text('retired_reason').notNull().default(''),
    version: integer('version').notNull().default(1),
    createdBy: creator(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique('inventory_items_org_id').on(t.organizationId, t.id),
    uniqueIndex('inventory_items_number')
      .on(t.organizationId, t.inventoryNumber)
      .where(sql`${t.inventoryNumber} <> ''`),
    index('inventory_items_org_name').on(t.organizationId, t.status, t.name),
    check('inventory_item_name', sql`length(trim(${t.name})) between 1 and 200`),
    check('inventory_item_quantity', sql`${t.quantity} between 1 and 100000`),
    check('inventory_item_value', sql`${t.valueCents} is null or ${t.valueCents} >= 0`),
    check('inventory_item_retired', sql`(${t.status}='retired') = (${t.retiredOn} is not null)`),
  ],
);

export const inventoryLoans = pgTable(
  'inventory_loans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    itemId: uuid('item_id').notNull(),
    // Borrowers are persons: members, volunteers or registered guests.
    personId: uuid('person_id').notNull(),
    quantity: integer('quantity').notNull().default(1),
    issuedOn: date('issued_on').notNull(),
    dueOn: date('due_on').notNull(),
    issueCondition: inventoryCondition('issue_condition').notNull(),
    notes: text('notes').notNull().default(''),
    returnedOn: date('returned_on'),
    returnCondition: inventoryCondition('return_condition'),
    returnNotes: text('return_notes').notNull().default(''),
    returnedBy: uuid('returned_by').references(() => user.id),
    version: integer('version').notNull().default(1),
    createdBy: creator(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique('inventory_loans_org_id').on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.itemId],
      foreignColumns: [inventoryItems.organizationId, inventoryItems.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.personId],
      foreignColumns: [persons.organizationId, persons.id],
    }),
    index('inventory_loans_item').on(t.organizationId, t.itemId, t.returnedOn),
    index('inventory_loans_person').on(t.organizationId, t.personId, t.returnedOn),
    index('inventory_loans_due').on(t.organizationId, t.dueOn),
    check('inventory_loan_quantity', sql`${t.quantity} between 1 and 100000`),
    check('inventory_loan_due', sql`${t.dueOn} >= ${t.issuedOn}`),
    check(
      'inventory_loan_return',
      sql`(${t.returnedOn} is null) = (${t.returnCondition} is null) and (${t.returnedOn} is null) = (${t.returnedBy} is null) and (${t.returnedOn} is null or ${t.returnedOn} >= ${t.issuedOn})`,
    ),
  ],
);
