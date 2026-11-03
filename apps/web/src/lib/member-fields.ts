import type { MemberField } from '@bnature/contracts';

export const fieldLabel = (field: MemberField, language: string) =>
  field.labelI18n[language.startsWith('it') ? 'it' : 'de'];

/** Finds a custom field by its German or Italian label (case-insensitive). */
export function matchField(fields: MemberField[], header: string) {
  const h = header.trim().toLowerCase();
  return fields.find(
    (f) => f.active && (f.labelI18n.de.toLowerCase() === h || f.labelI18n.it.toLowerCase() === h),
  );
}

const yes = ['ja', 'j', 'yes', 'y', 'true', '1', 'x', 'sì', 'si'];
const no = ['nein', 'n', 'no', 'false', '0'];

/**
 * Parses a CSV cell for a custom field: `null` for an empty cell, `undefined` when invalid.
 * Dates accept YYYY-MM-DD and DD.MM.YYYY; numbers accept a decimal comma.
 */
export function parseFieldValue(
  field: MemberField,
  raw: string,
): string | number | boolean | null | undefined {
  const value = raw.trim();
  if (!value) return null;
  switch (field.type) {
    case 'text':
      return value.slice(0, 500);
    case 'number': {
      const n = Number(value.replace(/\s/g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : undefined;
    }
    case 'boolean':
      return yes.includes(value.toLowerCase())
        ? true
        : no.includes(value.toLowerCase())
          ? false
          : undefined;
    case 'date': {
      const iso = /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? value
        : /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.test(value)
          ? value.replace(
              /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/,
              (_, d, m, y) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`,
            )
          : null;
      return iso && !Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? iso : undefined;
    }
    case 'select':
      return field.options.find((o) => o.toLowerCase() === value.toLowerCase());
  }
}

/** Text for list and CSV export. */
export function formatFieldValue(
  field: MemberField,
  value: string | number | boolean | undefined,
  yesNo: [string, string],
  language: string,
) {
  if (value === undefined || value === '') return '';
  if (field.type === 'boolean') return value ? yesNo[0] : yesNo[1];
  if (field.type === 'number' && typeof value === 'number') return value.toLocaleString(language);
  if (field.type === 'date' && typeof value === 'string')
    return new Date(`${value}T12:00:00Z`).toLocaleDateString(language, { timeZone: 'UTC' });
  return String(value);
}
