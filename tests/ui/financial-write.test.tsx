// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { useFinancialWrite } from '../../apps/web/src/features/finance/client';
import { api } from '../../apps/web/src/lib/api';
vi.mock('../../apps/web/src/lib/api', () => ({ api: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const key = (call: number) =>
  (vi.mocked(api).mock.calls[call]![1]!.headers as Record<string, string>)['Idempotency-Key'];
describe('write operation lifecycle', () => {
  it('uses a new key for a new identical operation after success', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'saved' });
    const { result } = renderHook(useFinancialWrite);
    await result.current('/finance/transfers', { amountCents: 1000 });
    await result.current('/finance/transfers', { amountCents: 1000 });
    expect(key(0)).not.toBe(key(1));
  });
  it('retains the key after an uncertain failure and changes it for edited data', async () => {
    vi.mocked(api).mockRejectedValueOnce(new TypeError('Network failed')).mockResolvedValue({});
    const { result } = renderHook(useFinancialWrite);
    await expect(result.current('/finance/transfers', { amountCents: 1000 })).rejects.toThrow();
    await result.current('/finance/transfers', { amountCents: 1000 });
    expect(key(0)).toBe(key(1));
    vi.mocked(api).mockRejectedValueOnce(new TypeError('Network failed'));
    await expect(result.current('/finance/transfers', { amountCents: 1000 })).rejects.toThrow();
    await result.current('/finance/transfers', { amountCents: 2000 });
    expect(key(2)).not.toBe(key(3));
  });
  it('does not clear a newer failed attempt when an older request completes', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(api)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockRejectedValueOnce(new TypeError('Network failed'))
      .mockResolvedValue({});
    const { result } = renderHook(useFinancialWrite);
    const first = result.current('/first', {});
    await expect(result.current('/second', {})).rejects.toThrow();
    finish({});
    await first;
    await result.current('/second', {});
    expect(key(1)).toBe(key(2));
  });
});
