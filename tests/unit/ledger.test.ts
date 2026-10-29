import { describe, it, expect } from 'vitest';
import {
  accountInputSchema,
  categoryInputSchema,
  cashbookEntryInputSchema,
  fiscalYearInputSchema,
  reportTemplateInputSchema,
  paymentInputSchema,
  formatMoney,
  can,
} from '../../packages/contracts/src';

const id = () => crypto.randomUUID();
describe('ledger contracts', () => {
  it('normalizes IBANs and rejects malformed ones', () => {
    expect(
      accountInputSchema.parse({
        name: 'Bank',
        kind: 'bank',
        iban: 'it60 x054 2811 1010 0000 0123 456',
      }).iban,
    ).toBe('IT60X0542811101000000123456');
    expect(accountInputSchema.safeParse({ name: 'Bank', kind: 'bank', iban: '123' }).success).toBe(
      false,
    );
    expect(accountInputSchema.parse({ name: 'Kasse', kind: 'cash' }).iban).toBe('');
  });
  it('keeps fee and donation classifications on income categories', () => {
    expect(
      categoryInputSchema.safeParse({
        name: 'Spende',
        direction: 'income',
        classification: 'donation',
      }).success,
    ).toBe(true);
    expect(
      categoryInputSchema.safeParse({
        name: 'X',
        direction: 'expense',
        classification: 'membership_fee',
      }).success,
    ).toBe(false);
  });
  it('accepts only positive cent amounts and strict entry fields', () => {
    const base = {
      accountId: id(),
      categoryId: id(),
      bookingDate: '2026-01-02',
      documentDate: '2026-01-01',
      description: 'Miete',
    };
    expect(cashbookEntryInputSchema.safeParse({ ...base, amountCents: 1 }).success).toBe(true);
    for (const amountCents of [0, -5, 1.5, 1_000_000_001])
      expect(cashbookEntryInputSchema.safeParse({ ...base, amountCents }).success).toBe(false);
    expect(
      cashbookEntryInputSchema.safeParse({ ...base, amountCents: 1, direction: 'income' }).success,
    ).toBe(false);
    expect(
      cashbookEntryInputSchema.safeParse({ ...base, amountCents: 1, fiscalYear: 2020 }).success,
    ).toBe(false);
  });
  it('rejects duplicate opening balance accounts', () => {
    const account = id();
    expect(
      fiscalYearInputSchema.safeParse({
        year: 2026,
        openingBalances: [
          { accountId: account, amountCents: 1 },
          { accountId: account, amountCents: 2 },
        ],
      }).success,
    ).toBe(false);
    expect(fiscalYearInputSchema.safeParse({ year: 2026 }).success).toBe(true);
  });
  it('validates report template lines, mappings and validity ranges', () => {
    const category = id(),
      line = { code: 'A1', label: 'Quote', direction: 'income', categoryIds: [category] };
    expect(
      reportTemplateInputSchema.safeParse({ name: 'T', validFromYear: 2026, lines: [line] })
        .success,
    ).toBe(true);
    expect(
      reportTemplateInputSchema.safeParse({ name: 'T', validFromYear: 2026, lines: [line, line] })
        .success,
    ).toBe(false);
    expect(
      reportTemplateInputSchema.safeParse({
        name: 'T',
        validFromYear: 2026,
        lines: [line, { ...line, code: 'A2' }],
      }).success,
    ).toBe(false);
    expect(
      reportTemplateInputSchema.safeParse({
        name: 'T',
        validFromYear: 2026,
        validToYear: 2025,
        lines: [line],
      }).success,
    ).toBe(false);
  });
  it('keeps payment booking optional and strict', () => {
    const payment = {
      payerName: 'A',
      paidOn: '2026-01-01',
      method: 'cash',
      amountCents: 100,
      allocations: [{ assessmentId: id(), amountCents: 100 }],
    };
    expect(paymentInputSchema.parse(payment).booking).toBeNull();
    expect(paymentInputSchema.safeParse({ ...payment, booking: { accountId: id() } }).success).toBe(
      false,
    );
  });
  it('formats negative totals beyond the safe integer range', () => {
    expect(formatMoney('-900719925474099312', 'de')).toBe('-9.007.199.254.740.993,12 €');
  });
  it('limits fiscal year closing to administrators', () => {
    expect(can('admin', 'finance:close')).toBe(true);
    for (const role of ['treasurer', 'board', 'project_lead', 'member'] as const)
      expect(can(role, 'finance:close')).toBe(false);
  });
});
