import { describe, it, expect } from 'vitest';
import { encodeCsv, parseCsv, previewCsv } from '../../apps/web/src/lib/csv';
import type { MemberField } from '../../packages/contracts/src';
const header = 'firstName;lastName;membershipNumber;joinedAt';
describe('CSV processing', () => {
  it('handles BOM, quotes, escaped quotes and multiline fields', () => {
    const rows = parseCsv(
      '\uFEFF' + header + '\r\n"Anna;Maria";"Test""Name\nZwei";001;2026-01-01\r\n',
    );
    expect(rows[0]?.firstName).toBe('Anna;Maria');
    expect(rows[0]?.lastName).toBe('Test"Name\nZwei');
  });
  it('validates rows individually and flags duplicates', () => {
    const rows = previewCsv(
      header + '\nAnna;Test;001;2026-01-01\nOtto;Test;001;2026-01-01\nX;Y;003;invalid',
    );
    expect(rows[0]?.data?.status).toBe('active');
    expect(rows[1]?.data).toBeNull();
    expect(rows[1]?.errors.join()).toContain('duplicate');
    expect(rows[2]?.data).toBeNull();
  });
  it.each([
    header + '\n"broken',
    header + '\na;b;c',
    header + '\na"b;c;d;2026-01-01',
    'firstName;firstName\na;b',
    'firstName;lastName;membershipNumber;joinedAt;role\na;b;c;2026-01-01;admin',
  ])('rejects malformed CSV', (value) => {
    expect(() => parseCsv(value)).toThrow();
  });
  it('protects spreadsheet formulas and escapes CSV quotes', () => {
    const csv = encodeCsv(
      [{ firstName: '=HYPERLINK("bad")', lastName: '\t+2' }],
      ['firstName', 'lastName'],
    );
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
    expect(csv).toContain("'\t+2");
  });
  it('exports and reimports valid members without changing fields', () => {
    const rows = [
      { firstName: 'Anna', lastName: 'Test', membershipNumber: '001', joinedAt: '2026-01-01' },
    ];
    const csv = encodeCsv(rows, Object.keys(rows[0]!));
    expect(previewCsv(csv)[0]?.data?.membershipNumber).toBe('001');
  });
  it('limits imports to 1000 rows', () => {
    expect(() => parseCsv(header + '\n' + 'a;b;1;2026-01-01\n'.repeat(1001))).toThrow('csvLimit');
  });
});

describe('custom fields in CSV import', () => {
  const field = (patch: Record<string, unknown>) =>
    ({
      id: crypto.randomUUID(),
      labelI18n: { de: 'Größe', it: 'Taglia' },
      type: 'select',
      options: ['S', 'M', 'L'],
      position: 0,
      active: true,
      ...patch,
    }) as MemberField;
  const size = field({});
  const vegan = field({ labelI18n: { de: 'Vegan', it: 'Vegano' }, type: 'boolean', options: [] });
  const since = field({ labelI18n: { de: 'Seit', it: 'Dal' }, type: 'date', options: [] });
  const base = 'firstName;lastName;membershipNumber;joinedAt';
  it('maps DE or IT labels to fields, parses values and ignores consent columns', () => {
    const [row] = previewCsv(
      `${base};taglia;Vegan;Seit;Einwilligung Fotos\nAnna;Muster;A-1;2026-01-01;m;ja;03.02.2024;Erteilt`,
      [size, vegan, since],
    );
    expect(row!.errors).toEqual([]);
    expect(row!.fieldValues).toEqual({
      [size.id]: 'M',
      [vegan.id]: true,
      [since.id]: '2024-02-03',
    });
  });
  it('reports invalid values and still rejects unknown columns', () => {
    const [row] = previewCsv(`${base};Größe;Vegan\nAnna;Muster;A-1;2026-01-01;XXL;vielleicht`, [
      size,
      vegan,
    ]);
    expect(row!.data).toBeNull();
    expect(row!.errors).toEqual(['Größe: memberFieldInvalid', 'Vegan: memberFieldInvalid']);
    expect(() => previewCsv(`${base};Unbekannt\nA;B;C;2026-01-01;x`, [size])).toThrow('csvError');
  });
  it('accepts empty cells and a decimal comma', () => {
    const count = field({ labelI18n: { de: 'Anzahl', it: 'Numero' }, type: 'number', options: [] });
    const [row] = previewCsv(`${base};Anzahl;Größe\nAnna;Muster;A-1;2026-01-01;2,5;`, [
      count,
      size,
    ]);
    expect(row!.fieldValues).toEqual({ [count.id]: 2.5 });
  });
});
