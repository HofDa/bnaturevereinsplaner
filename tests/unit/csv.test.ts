import { describe, it, expect } from 'vitest';
import { encodeCsv, parseCsv, previewCsv } from '../../apps/web/src/lib/csv';
import { csvCell } from '../../packages/contracts/src/csv';
const header = 'firstName;lastName;membershipNumber;joinedAt';
describe('CSV processing', () => {
  it.each(['=1+1', '+2', '-2', '@SUM(A1)', '\t=1+1', '\r=1+1', '\n=1+1', '  =1+1', ' \t+2'])(
    'neutralizes formula/control-prefixed cells: %j',
    (value) => {
      expect(csvCell(value)).toBe(`"'${value}"`);
      expect(encodeCsv([{ value }], ['value'])).toContain(csvCell(value));
    },
  );
  it('keeps null, Unicode, delimiters and quotes consistent across exports', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell('Süd;"tirol"')).toBe('"Süd;""tirol"""');
  });
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
