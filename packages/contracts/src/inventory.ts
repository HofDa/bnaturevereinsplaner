import { z } from 'zod';
import { idSchema } from './common';

const date = z.iso.date();
const text = (max: number) => z.string().trim().max(max);
export const inventoryConditionSchema = z.enum(['new', 'good', 'worn', 'damaged', 'defective']);
export type InventoryCondition = z.infer<typeof inventoryConditionSchema>;
export const inventoryItemStatusSchema = z.enum(['active', 'retired']);

const itemFields = {
  inventoryNumber: text(40),
  name: text(200).min(1),
  category: text(80),
  description: text(2000),
  location: text(200),
  condition: inventoryConditionSchema,
  quantity: z.number().int().min(1).max(100_000),
  purchasedOn: date.nullable(),
  valueCents: z.number().int().min(0).max(2_000_000_000).nullable(),
  notes: text(2000),
};
export const inventoryItemInputSchema = z
  .object({
    ...itemFields,
    inventoryNumber: itemFields.inventoryNumber.default(''),
    category: itemFields.category.default(''),
    description: itemFields.description.default(''),
    location: itemFields.location.default(''),
    condition: itemFields.condition.default('good'),
    quantity: itemFields.quantity.default(1),
    purchasedOn: itemFields.purchasedOn.default(null),
    valueCents: itemFields.valueCents.default(null),
    notes: itemFields.notes.default(''),
  })
  .strict();
export type InventoryItemInput = z.infer<typeof inventoryItemInputSchema>;
export const inventoryItemPatchSchema = z
  .object({
    version: z.number().int().min(1),
    inventoryNumber: itemFields.inventoryNumber.optional(),
    name: itemFields.name.optional(),
    category: itemFields.category.optional(),
    description: itemFields.description.optional(),
    location: itemFields.location.optional(),
    condition: itemFields.condition.optional(),
    quantity: itemFields.quantity.optional(),
    purchasedOn: itemFields.purchasedOn.optional(),
    valueCents: itemFields.valueCents.optional(),
    notes: itemFields.notes.optional(),
  })
  .strict();
export const inventoryRetireSchema = z
  .object({
    version: z.number().int().min(1),
    retiredOn: date,
    reason: text(500).min(3),
  })
  .strict();
export const inventoryItemSchema = z.object({
  id: idSchema,
  inventoryNumber: z.string(),
  name: z.string(),
  category: z.string(),
  description: z.string(),
  location: z.string(),
  condition: inventoryConditionSchema,
  quantity: z.number().int(),
  purchasedOn: z.string().nullable(),
  valueCents: z.number().int().nullable(),
  notes: z.string(),
  status: inventoryItemStatusSchema,
  retiredOn: z.string().nullable(),
  retiredReason: z.string(),
  lentQuantity: z.number().int(),
  availableQuantity: z.number().int(),
  overdueLoans: z.number().int(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type InventoryItem = z.infer<typeof inventoryItemSchema>;
export const inventoryItemQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).default(''),
  category: z.string().trim().max(80).default(''),
  condition: inventoryConditionSchema.optional(),
  status: z.enum(['active', 'retired', 'all']).default('active'),
  availability: z.enum(['all', 'available', 'lent', 'overdue']).default('all'),
});
export type InventoryItemQuery = z.infer<typeof inventoryItemQuerySchema>;

export const inventoryLoanInputSchema = z
  .object({
    itemId: idSchema,
    personId: idSchema,
    quantity: z.number().int().min(1).max(100_000).default(1),
    issuedOn: date,
    dueOn: date,
    // Defaults to the item's current condition.
    issueCondition: inventoryConditionSchema.optional(),
    notes: text(1000).default(''),
  })
  .strict()
  .refine((v) => v.dueOn >= v.issuedOn, { path: ['dueOn'], message: 'endBeforeStart' });
export type InventoryLoanInput = z.infer<typeof inventoryLoanInputSchema>;
export const inventoryLoanReturnSchema = z
  .object({
    version: z.number().int().min(1),
    returnedOn: date,
    returnCondition: inventoryConditionSchema,
    returnNotes: text(1000).default(''),
  })
  .strict();
export const inventoryLoanExtendSchema = z
  .object({
    version: z.number().int().min(1),
    dueOn: date,
    notes: text(1000).optional(),
  })
  .strict();
export const inventoryLoanSchema = z.object({
  id: idSchema,
  itemId: idSchema,
  itemName: z.string(),
  inventoryNumber: z.string(),
  personId: idSchema,
  borrowerName: z.string(),
  borrowerEmail: z.string(),
  borrowerIsMember: z.boolean(),
  quantity: z.number().int(),
  issuedOn: z.string(),
  dueOn: z.string(),
  issueCondition: inventoryConditionSchema,
  notes: z.string(),
  returnedOn: z.string().nullable(),
  returnCondition: inventoryConditionSchema.nullable(),
  returnNotes: z.string(),
  overdue: z.boolean(),
  daysOverdue: z.number().int(),
  version: z.number().int(),
  createdAt: z.string(),
});
export type InventoryLoan = z.infer<typeof inventoryLoanSchema>;
export const inventoryLoanQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  state: z.enum(['open', 'overdue', 'returned', 'all']).default('open'),
  itemId: idSchema.optional(),
  personId: idSchema.optional(),
  search: z.string().trim().max(100).default(''),
});
export type InventoryLoanQuery = z.infer<typeof inventoryLoanQuerySchema>;
export const inventorySummarySchema = z.object({
  items: z.number().int(),
  pieces: z.number().int(),
  lentPieces: z.number().int(),
  openLoans: z.number().int(),
  overdueLoans: z.number().int(),
  needsAttention: z.number().int(),
  valueCents: z.number().int(),
  categories: z.array(z.string()),
});
export const inventoryExportQuerySchema = z.object({
  status: z.enum(['active', 'retired', 'all']).default('active'),
  language: z.enum(['de', 'it']).default('de'),
});
