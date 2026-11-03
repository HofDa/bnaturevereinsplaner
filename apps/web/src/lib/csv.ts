import { memberInputSchema, type MemberInput, type MemberField } from '@bnature/contracts';
import { matchField, parseFieldValue } from './member-fields';
export const csvColumns = Object.keys(memberInputSchema.shape) as (keyof MemberInput)[];
/** `extraHeaders` are additional accepted column names, e.g. custom field labels. */
export function parseCsv(text: string, extraHeaders: string[] = []): Record<string, string>[] {
  if (new TextEncoder().encode(text).length > 2_000_000) throw new Error('csvLimit');
  const source = text.replace(/^\uFEFF/, '');
  const firstLine = source.split(/\r?\n/)[0] ?? '';
  const delimiter = firstLine.includes(';') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
    } else if (c === '"') {
      if (field || closed) throw new Error('csvError');
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
      closed = false;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      field = '';
      closed = false;
    } else {
      if (closed) throw new Error('csvError');
      field += c;
    }
  }
  if (quoted) throw new Error('csvError');
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  const headers = rows.shift()?.map((h) => h.trim()) ?? [];
  if (
    !headers.length ||
    new Set(headers).size !== headers.length ||
    headers.some(
      (h) =>
        !csvColumns.includes(h as keyof MemberInput) &&
        !extraHeaders.some((x) => x.toLowerCase() === h.toLowerCase()),
    ) ||
    !['firstName', 'lastName', 'membershipNumber', 'joinedAt'].every((k) => headers.includes(k))
  )
    throw new Error('csvError');
  if (rows.length > 1000) throw new Error('csvLimit');
  return rows.map((r) => {
    if (r.length !== headers.length) throw new Error('csvError');
    return Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']));
  });
}
export type CsvPreview = {
  line: number;
  name: string;
  data: MemberInput | null;
  errors: string[];
  /** Custom field values to store after the member was created. */
  fieldValues: Record<string, string | number | boolean>;
  imported?: boolean;
};
// Exported consent columns are informational; consents are recorded with date on the member page.
export const consentCsvHeaders = [
  'Einwilligung Datenverarbeitung',
  'Einwilligung Fotos',
  'Consenso trattamento dati',
  'Consenso foto',
];
const ignored = (header: string) =>
  consentCsvHeaders.some((h) => h.toLowerCase() === header.trim().toLowerCase());
export function previewCsv(text: string, fields: MemberField[] = []): CsvPreview[] {
  const seen = new Set<string>();
  const labels = fields.filter((f) => f.active).flatMap((f) => [f.labelI18n.de, f.labelI18n.it]);
  return parseCsv(text, [...labels, ...consentCsvHeaders]).map((row, i) => {
    const input: Record<string, string> = {};
    const fieldValues: Record<string, string | number | boolean> = {};
    const fieldErrors: string[] = [];
    for (const [header, raw] of Object.entries(row)) {
      if (ignored(header)) continue;
      const field = csvColumns.includes(header as keyof MemberInput)
        ? undefined
        : matchField(fields, header);
      if (!field) {
        input[header] = raw;
        continue;
      }
      const parsedValue = parseFieldValue(field, raw);
      if (parsedValue === undefined) fieldErrors.push(`${header}: memberFieldInvalid`);
      else if (parsedValue !== null) fieldValues[field.id] = parsedValue;
    }
    const parsed = memberInputSchema.safeParse({
      ...input,
      dateOfBirth: input.dateOfBirth || null,
      endedAt: input.endedAt || null,
    });
    const errors = [
      ...(parsed.success
        ? []
        : parsed.error.issues.map((v) => `${v.path.join('.')}: ${v.message}`)),
      ...fieldErrors,
    ];
    if (seen.has(row.membershipNumber ?? '')) errors.push('membershipNumber: duplicate');
    seen.add(row.membershipNumber ?? '');
    return {
      line: i + 2,
      name: `${row.firstName ?? ''} ${row.lastName ?? ''}`,
      data: parsed.success && errors.length === 0 ? parsed.data : null,
      errors,
      fieldValues,
    };
  });
}
export function encodeCsv(
  rows: Record<string, unknown>[],
  columns: readonly string[] = csvColumns,
): string {
  const cell = (v: unknown) => {
    let value = v == null ? '' : String(v);
    if (/^[\s]*[=+@\-\t\r]/.test(value)) value = "'" + value;
    return '"' + value.replaceAll('"', '""') + '"';
  };
  return (
    '\uFEFF' +
    [
      columns.map(cell).join(';'),
      ...rows.map((row) => columns.map((key) => cell(row[key])).join(';')),
    ].join('\r\n')
  );
}
export function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
