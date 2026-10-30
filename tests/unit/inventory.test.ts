import { describe, it, expect } from 'vitest';
import {
  inventoryItemInputSchema,
  inventoryItemPatchSchema,
  inventoryLoanInputSchema,
  inventoryRetireSchema,
  can,
} from '../../packages/contracts/src';

const id = '6f1d3f3e-1b5a-4c5e-9d3a-2f0a8b7c6d5e';
describe('inventory contracts', () => {
  it('applies defaults and rejects unknown or invalid fields', () => {
    expect(inventoryItemInputSchema.parse({ name: ' Leiter ' })).toMatchObject({
      name: 'Leiter',
      quantity: 1,
      condition: 'good',
      inventoryNumber: '',
      valueCents: null,
    });
    expect(inventoryItemInputSchema.safeParse({ name: 'x', quantity: 0 }).success).toBe(false);
    expect(inventoryItemInputSchema.safeParse({ name: 'x', valueCents: -1 }).success).toBe(false);
    expect(inventoryItemInputSchema.safeParse({ name: 'x', owner: 'y' }).success).toBe(false);
    expect(inventoryItemInputSchema.safeParse({ name: 'x', condition: 'broken' }).success).toBe(
      false,
    );
  });

  it('keeps patches partial so unsent values are not reset', () => {
    expect(inventoryItemPatchSchema.parse({ version: 3, location: 'Garage' })).toEqual({
      version: 3,
      location: 'Garage',
    });
    expect(inventoryItemPatchSchema.safeParse({ location: 'Garage' }).success).toBe(false);
  });

  it('requires a due date on or after the issue date and a retire reason', () => {
    const loan = { itemId: id, personId: id, issuedOn: '2026-05-10' };
    expect(inventoryLoanInputSchema.safeParse({ ...loan, dueOn: '2026-05-10' }).success).toBe(true);
    expect(inventoryLoanInputSchema.safeParse({ ...loan, dueOn: '2026-05-09' }).success).toBe(
      false,
    );
    expect(
      inventoryRetireSchema.safeParse({ version: 1, retiredOn: '2026-05-10', reason: ' ' }).success,
    ).toBe(false);
  });

  it('grants inventory rights by role', () => {
    expect(can('board', 'inventory:write')).toBe(true);
    expect(can('treasurer', 'inventory:read')).toBe(true);
    expect(can('treasurer', 'inventory:lend')).toBe(false);
    expect(can('project_lead', 'inventory:lend')).toBe(true);
    expect(can('project_lead', 'inventory:write')).toBe(false);
    expect(can('member', 'inventory:read')).toBe(false);
  });
});
