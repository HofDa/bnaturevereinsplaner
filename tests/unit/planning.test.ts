import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  can,
  costPlanInputSchema,
  costPlanSchema,
  costPlanUpdateSchema,
  costTotals,
  plannedCost,
  type CostPlanInput,
} from '../../packages/contracts/src';
import { costCsv, costExportRows } from '../../apps/api/src/modules/planning';
import { workbook } from '../../apps/api/src/services/xlsx';

const column = crypto.randomUUID();
const plan: CostPlanInput = {
  name: 'Wald & Wiesen',
  description: 'Planung\n2026',
  columns: [{ id: column, label: 'Lieferant' }],
  rows: [
    {
      id: crypto.randomUUID(),
      description: '=HYPERLINK("unsafe")',
      category: 'Material',
      quantity: 2.5,
      unit: 'kg',
      unitCostCents: 1235,
      actualCents: 3200,
      notes: 'Grün; Südtirol',
      custom: { [column]: 'Bio <Hof>' },
    },
  ],
};
describe('cost planning', () => {
  it('rounds planned line costs to cents before calculating totals', () => {
    expect(plannedCost(plan.rows[0]!)).toBe(3088);
    expect(plannedCost({ quantity: 1.255, unitCostCents: 100 })).toBe(126);
    expect(
      costTotals([
        ...plan.rows,
        { ...plan.rows[0]!, quantity: 0.001, unitCostCents: 499, actualCents: 0 },
      ]),
    ).toEqual({ plannedCents: 3088, actualCents: 3200, varianceCents: 112 });
    expect(costTotals([])).toEqual({ plannedCents: 0, actualCents: 0, varianceCents: 0 });
  });
  it('accepts fractional quantities and versioned plans', () => {
    expect(costPlanInputSchema.parse(plan)).toEqual(plan);
    expect(costPlanUpdateSchema.parse({ ...plan, version: 1 }).version).toBe(1);
    expect(
      costPlanSchema.parse({
        ...plan,
        id: crypto.randomUUID(),
        version: 2,
        updatedAt: new Date().toISOString(),
      }).version,
    ).toBe(2);
  });
  it('rejects negative, excessive and imprecise amounts and quantities', () => {
    for (const patch of [
      { quantity: -1 },
      { quantity: 10_001 },
      { quantity: 0.0001 },
      { unitCostCents: 1.1 },
      { actualCents: -1 },
      { actualCents: Infinity },
      { unitCostCents: 100_000_001 },
    ]) {
      expect(
        costPlanInputSchema.safeParse({ ...plan, rows: [{ ...plan.rows[0], ...patch }] }).success,
      ).toBe(false);
    }
  });
  it('rejects duplicate IDs and column labels, missing names and orphan values', () => {
    for (const patch of [
      { rows: [...plan.rows, ...plan.rows] },
      { name: ' ' },
      { columns: [...plan.columns, ...plan.columns] },
      { columns: [...plan.columns, { id: crypto.randomUUID(), label: 'lieferant' }] },
      { columns: [] },
      { rows: [{ ...plan.rows[0], description: '' }] },
      { rows: Array.from({ length: 201 }, () => ({ ...plan.rows[0], id: crypto.randomUUID() })) },
    ])
      expect(costPlanInputSchema.safeParse({ ...plan, ...patch }).success).toBe(false);
    expect(
      costPlanInputSchema.safeParse({ ...plan, organizationId: crypto.randomUUID() }).success,
    ).toBe(false);
  });
  it('grants planning to organizers and treasurers, excluding regular members', () => {
    for (const role of ['admin', 'board', 'treasurer', 'project_lead'] as const) {
      expect(can(role, 'planning:read')).toBe(true);
      expect(can(role, 'planning:write')).toBe(true);
    }
    expect(can('member', 'planning:read')).toBe(false);
    expect(can('member', 'planning:write')).toBe(false);
  });
  it('exports localized CSV with totals, ordered custom columns and escaped formulas', () => {
    const rows = costExportRows(plan, 'it');
    expect(rows[4]).toEqual([
      'Voce',
      'Categoria',
      'Quantità',
      'Unità',
      'Costo unitario (EUR)',
      'Preventivo (EUR)',
      'Consuntivo (EUR)',
      'Scostamento (EUR)',
      'Note',
      'Lieferant',
    ]);
    expect(rows[5]!.slice(4, 8)).toEqual([12.35, 30.88, 32, 1.12]);
    expect(rows.at(-1)!.slice(5)).toEqual([30.88, 32, 1.12]);
    const csv = costCsv(rows);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"\'=HYPERLINK(""unsafe"")"');
    expect(csv).toContain('"30,88"');
    expect(csv).toContain('"Bio <Hof>"');
    // Negative numeric variances remain numbers, rather than formula-escaped text.
    expect(costCsv([[-1.25]])).toBe('\uFEFF"-1,25"');
  });
  it('produces a valid XLSX archive with typed numbers and literal text using an independent ZIP/XML reader', () => {
    const result = execFileSync(
      'python3',
      [
        '-c',
        `
import sys, io, zipfile, xml.etree.ElementTree as ET, json, base64
with zipfile.ZipFile(io.BytesIO(base64.b64decode(sys.argv[1]))) as archive:
 assert archive.testzip() is None
 for path in archive.namelist(): ET.fromstring(archive.read(path))
 ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
 sheet = ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
 cells = {c.attrib['r']: {'type': c.attrib.get('t', 'n'), 'value': ''.join(c.itertext())} for c in sheet.findall('.//s:c', ns)}
 print(json.dumps(cells))
`,
        workbook(costExportRows(plan, 'de')).toString('base64'),
      ],
      { timeout: 5000 },
    );
    const cells = JSON.parse(result.toString());
    expect(cells.A6).toEqual({ type: 'inlineStr', value: '=HYPERLINK("unsafe")' });
    expect(cells.F6).toEqual({ type: 'n', value: '30.88' });
    expect(cells.J6).toEqual({ type: 'inlineStr', value: 'Bio <Hof>' });
  });
});
