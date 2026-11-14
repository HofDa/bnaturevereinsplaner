import { pgTable, uuid, text, integer, jsonb, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { CostPlanInput } from '../../../contracts/src/planning';
import { organizations } from './core';
import { created, updated, creator } from './columns';

export const costPlans = pgTable(
  'cost_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    columns: jsonb('columns').$type<CostPlanInput['columns']>().notNull().default([]),
    rows: jsonb('rows').$type<CostPlanInput['rows']>().notNull().default([]),
    version: integer('version').notNull().default(1),
    createdBy: creator(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    index('cost_plans_org').on(t.organizationId, t.name),
    check('cost_plan_name', sql`length(trim(${t.name})) between 1 and 200`),
    check('cost_plan_version', sql`${t.version} > 0`),
  ],
);
