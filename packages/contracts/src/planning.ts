import { z } from 'zod';
import { idSchema } from './common';

const cents = z.number().int().min(0).max(100_000_000);
export const costColumnSchema = z
  .object({
    id: idSchema,
    label: z.string().trim().min(1).max(80),
  })
  .strict();
export const costRowSchema = z
  .object({
    id: idSchema,
    description: z.string().trim().min(1).max(200),
    category: z.string().trim().max(100),
    quantity: z.number().min(0).max(10_000).multipleOf(0.001),
    unit: z.string().trim().max(40),
    unitCostCents: cents,
    actualCents: cents,
    notes: z.string().trim().max(1000),
    custom: z.record(idSchema, z.string().max(200)),
  })
  .strict();
export const costPlanInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000),
    columns: z.array(costColumnSchema).max(10),
    rows: z.array(costRowSchema).max(200),
  })
  .strict()
  .superRefine((plan, ctx) => {
    for (const key of ['columns', 'rows'] as const) {
      if (new Set(plan[key].map((item) => item.id)).size !== plan[key].length)
        ctx.addIssue({ code: 'custom', path: [key], message: 'duplicate' });
    }
    if (new Set(plan.columns.map((c) => c.label.toLocaleLowerCase())).size !== plan.columns.length)
      ctx.addIssue({ code: 'custom', path: ['columns'], message: 'duplicate' });
    const ids = new Set(plan.columns.map((column) => column.id));
    plan.rows.forEach((row, index) => {
      if (Object.keys(row.custom).some((id) => !ids.has(id)))
        ctx.addIssue({
          code: 'custom',
          path: ['rows', index, 'custom'],
          message: 'invalidRelation',
        });
    });
  });
export const costPlanUpdateSchema = costPlanInputSchema.safeExtend({
  version: z.number().int().positive(),
});
export const costPlanSchema = costPlanInputSchema.safeExtend({
  id: idSchema,
  version: z.number().int().positive(),
  updatedAt: z.string(),
});
export type CostPlanInput = z.infer<typeof costPlanInputSchema>;
export type CostPlan = z.infer<typeof costPlanSchema>;
export type CostRow = z.infer<typeof costRowSchema>;
export function plannedCost(row: Pick<CostRow, 'quantity' | 'unitCostCents'>): number {
  // Multiply integer thousandths so half-cent values do not round down due to floating point.
  return Math.round((Math.round(row.quantity * 1000) * row.unitCostCents) / 1000);
}
export function costTotals(rows: CostRow[]) {
  const plannedCents = rows.reduce((sum, row) => sum + plannedCost(row), 0);
  const actualCents = rows.reduce((sum, row) => sum + row.actualCents, 0);
  return { plannedCents, actualCents, varianceCents: actualCents - plannedCents };
}
