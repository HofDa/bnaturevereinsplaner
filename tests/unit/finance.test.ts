import { describe, it, expect } from 'vitest';
import {
  parseEuroCents,
  formatMoney,
  moneyInputValue,
  paymentInputSchema,
  assessmentInputSchema,
  feePlanPatchSchema,
  can,
} from '../../packages/contracts/src';
import { assessmentState } from '../../apps/api/src/modules/finance/service';
import { canonicalJson } from '../../apps/api/src/modules/finance/operations';
describe('exact monetary inputs', () => {
  it.each([
    ['0', 0],
    ['0,01', 1],
    ['0.29', 29],
    ['12,5', 1250],
    ['10000000.00', 1_000_000_000],
  ])('parses %s as integer cents', (text, cents) =>
    expect(parseEuroCents(String(text))).toBe(cents),
  );
  it.each([
    '-1',
    '1.001',
    '1e3',
    'NaN',
    'Infinity',
    '1 000',
    '1,234.50',
    '10000000.01',
    '',
    '.5',
    '0x10',
  ])('rejects ambiguous or excessive amount %s', (text) =>
    expect(() => parseEuroCents(text)).toThrow(),
  );
  it('formats aggregate values beyond the JS safe integer boundary exactly', () => {
    expect(formatMoney('9007199254740993', 'de')).toBe('90.071.992.547.409,93 €');
    expect(moneyInputValue(29)).toBe('0.29');
  });
  it('canonicalizes object keys for request hashing', () => {
    expect(canonicalJson({ b: 2, a: { z: 1, x: 0 } })).toBe(
      canonicalJson({ a: { x: 0, z: 1 }, b: 2 }),
    );
  });
});
describe('fee and allocation rules', () => {
  const id = crypto.randomUUID(),
    base = {
      payerName: 'Anna',
      paidOn: '2026-10-29',
      method: 'cash',
      amountCents: 1000,
      allocations: [{ assessmentId: id, amountCents: 1000 }],
    };
  it('requires an exact allocation sum', () => {
    expect(paymentInputSchema.safeParse({ ...base, amountCents: 999 }).success).toBe(false);
    expect(paymentInputSchema.safeParse(base).success).toBe(true);
  });
  it('rejects duplicate allocation targets, fractional cents and zero payments', () => {
    expect(
      paymentInputSchema.safeParse({
        ...base,
        allocations: [
          { assessmentId: id, amountCents: 500 },
          { assessmentId: id, amountCents: 500 },
        ],
      }).success,
    ).toBe(false);
    expect(paymentInputSchema.safeParse({ ...base, amountCents: 1000.1 }).success).toBe(false);
    expect(paymentInputSchema.safeParse({ ...base, amountCents: 0 }).success).toBe(false);
  });
  it('requires a reason for individual amounts, reductions and exemptions', () => {
    for (const patch of [{ exempt: true }, { reductionCents: 100 }, { individualAmountCents: 500 }])
      expect(
        assessmentInputSchema.safeParse({
          membershipId: id,
          planId: id,
          fiscalYear: 2026,
          dueDate: '2026-12-01',
          ...patch,
        }).success,
      ).toBe(false);
  });
  it('does not reset omitted tariff fields in a versioned patch', () => {
    expect(feePlanPatchSchema.parse({ version: 1, active: false })).toEqual({
      version: 1,
      active: false,
    });
  });
  it('derives partial, paid, exempt and overdue states', () => {
    expect(
      assessmentState(
        { amountCents: 1000, paidCents: 250, exempt: false, dueDate: '2026-01-01' },
        '2026-02-01',
      ),
    ).toEqual({ openCents: 750, status: 'partial', overdue: true });
    expect(
      assessmentState(
        { amountCents: 1000, paidCents: 1000, exempt: false, dueDate: '2026-01-01' },
        '2026-02-01',
      ).status,
    ).toBe('paid');
    expect(
      assessmentState(
        { amountCents: 0, paidCents: 0, exempt: true, dueDate: '2026-01-01' },
        '2026-02-01',
      ).status,
    ).toBe('exempt');
  });
  it('grants financial access explicitly', () => {
    expect(can('admin', 'finance:plans')).toBe(true);
    expect(can('treasurer', 'finance:write')).toBe(true);
    expect(can('treasurer', 'finance:plans')).toBe(false);
    for (const role of ['board', 'project_lead', 'member'] as const) {
      expect(can(role, 'finance:read')).toBe(false);
      expect(can(role, 'finance:write')).toBe(false);
    }
  });
});
