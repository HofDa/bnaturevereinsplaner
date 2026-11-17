// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { z } from 'zod';
import '../../apps/web/src/lib/i18n';
import { Field } from '../../apps/web/src/components/ui';
import { DataForm } from '../../apps/web/src/components/data-form';
import { applyTheme, readTheme } from '../../apps/web/src/lib/theme';
import { setLanguage } from '../../apps/web/src/lib/i18n';

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  applyTheme('light');
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  await setLanguage('de');
});

it('applies theme and language even when browser storage throws', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('Blocked', 'SecurityError');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Full', 'QuotaExceededError');
  });
  expect(() => applyTheme('dark')).not.toThrow();
  expect(document.documentElement).toHaveClass('dark');
  expect(readTheme()).toBe('dark');
  await expect(setLanguage('it')).resolves.toBeUndefined();
  expect(document.documentElement).toHaveAttribute('lang', 'it');
});

it('falls back to system for invalid saved themes', () => {
  localStorage.setItem('bnature-theme', 'invalid');
  expect(readTheme()).toBe('system');
});

it('associates field errors with selects and clears invalid state after correction', () => {
  const { rerender } = render(
    <Field label="Choice" error="Choose a value" hint="Required">
      <select>
        <option value="">Select</option>
      </select>
    </Field>,
  );
  const control = screen.getByRole('combobox', { name: 'Choice' });
  expect(control).toHaveAttribute('aria-invalid', 'true');
  expect(control).toHaveAccessibleDescription('Required Choose a value');
  rerender(
    <Field label="Choice" hint="Required">
      <select>
        <option value="a">Valid</option>
      </select>
    </Field>,
  );
  expect(control).not.toHaveAttribute('aria-invalid');
  expect(control).toHaveAccessibleDescription('Required');
});

it('focuses the first invalid control without submitting invalid data', async () => {
  const onSubmit = vi.fn();
  render(
    <DataForm
      schema={z.object({ choice: z.literal('valid') })}
      fields={[
        {
          name: 'choice',
          label: 'Choice',
          type: 'select',
          options: [
            { value: '', label: 'Select' },
            { value: 'valid', label: 'Valid' },
          ],
        },
      ]}
      onSubmit={onSubmit}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  expect(screen.getByRole('combobox', { name: 'Choice' })).toHaveFocus();
  expect(screen.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true');
  expect(onSubmit).not.toHaveBeenCalled();
  await userEvent.selectOptions(screen.getByRole('combobox'), 'valid');
  await userEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ choice: 'valid' });
  expect(screen.getByRole('combobox')).not.toHaveAttribute('aria-invalid');
});

it('keeps a newly chosen theme when reads work but storage is full', () => {
  localStorage.setItem('bnature-theme', 'light');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Full', 'QuotaExceededError');
  });
  applyTheme('dark');
  expect(readTheme()).toBe('dark');
  expect(document.documentElement).toHaveClass('dark');
});
