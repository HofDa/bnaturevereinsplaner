import { it, expect, vi } from 'vitest';
import { createDatabase } from '../../packages/db/src';
it('handles an idle connection error without exposing connection details', async () => {
  const report = vi.fn();
  const { pool } = createDatabase('postgres://unused:secret@localhost/unused', report);
  try {
    expect(() =>
      pool.emit(
        'error',
        Object.assign(new Error('sensitive connection detail'), { code: '57P01' }),
      ),
    ).not.toThrow();
    expect(report).toHaveBeenCalledExactlyOnceWith('57P01');
  } finally {
    await pool.end();
  }
});
