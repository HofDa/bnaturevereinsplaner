import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { schema as s, type Executor } from '@bnature/db';
import {
  costPlanInputSchema,
  costPlanSchema,
  costPlanUpdateSchema,
  costTotals,
  plannedCost,
  csvCell,
  financeWriteHeaders,
  idParams,
  type CostPlanInput,
} from '@bnature/contracts';
import { HttpError, type Access } from '../middleware/access';
import { idempotentOperation } from '../services/operations';
import { audit } from '../services/audit';
import { workbook } from '../services/xlsx';
import type { ModuleContext } from './context';
import { attachment, idempotencyKey, replay } from './http';

const table = s.costPlans;
const scope = (a: Access, id: string) =>
  and(eq(table.organizationId, a.organizationId), eq(table.id, id));
const present = (row: typeof table.$inferSelect) =>
  costPlanSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    columns: row.columns,
    rows: row.rows,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  });
async function getPlan(db: Executor, a: Access, id: string) {
  const [row] = await db.select().from(table).where(scope(a, id));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Kostenplan nicht gefunden.');
  return present(row);
}
export function costExportRows(plan: CostPlanInput, language: 'de' | 'it'): (string | number)[][] {
  const it = language === 'it';
  const totals = costTotals(plan.rows);
  return [
    [it ? 'Progetto' : 'Projekt', plan.name],
    [it ? 'Descrizione' : 'Beschreibung', plan.description],
    [it ? 'Valuta' : 'Währung', 'EUR'],
    [],
    [
      ...(it
        ? [
            'Voce',
            'Categoria',
            'Quantità',
            'Unità',
            'Costo unitario (EUR)',
            'Preventivo (EUR)',
            'Consuntivo (EUR)',
            'Scostamento (EUR)',
            'Note',
          ]
        : [
            'Position',
            'Kategorie',
            'Menge',
            'Einheit',
            'Einzelpreis (EUR)',
            'Geplant (EUR)',
            'Ist (EUR)',
            'Abweichung (EUR)',
            'Notizen',
          ]),
      ...plan.columns.map((c) => c.label),
    ],
    ...plan.rows.map((row) => [
      row.description,
      row.category,
      row.quantity,
      row.unit,
      row.unitCostCents / 100,
      plannedCost(row) / 100,
      row.actualCents / 100,
      (row.actualCents - plannedCost(row)) / 100,
      row.notes,
      ...plan.columns.map((c) => row.custom[c.id] ?? ''),
    ]),
    [
      it ? 'Totale' : 'Gesamt',
      '',
      '',
      '',
      '',
      totals.plannedCents / 100,
      totals.actualCents / 100,
      totals.varianceCents / 100,
    ],
  ];
}
export function costCsv(rows: (string | number)[][]) {
  return (
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map((v) => (typeof v === 'number' ? `"${String(v).replace('.', ',')}"` : csvCell(v)))
          .join(';'),
      )
      .join('\r\n')
  );
}
export function registerPlanningRoutes({ server, db, access }: ModuleContext) {
  const app = server.withTypeProvider<ZodTypeProvider>();
  const p = '/api/v1/planning/costs',
    tags = ['Planning'];
  app.get(
    p,
    { schema: { tags, response: { 200: z.object({ items: z.array(costPlanSchema) }) } } },
    async (req) => {
      const a = await access(req, 'planning:read');
      return {
        items: (
          await db
            .select()
            .from(table)
            .where(eq(table.organizationId, a.organizationId))
            .orderBy(asc(table.name), asc(table.id))
        ).map(present),
      };
    },
  );
  app.get(
    `${p}/:id`,
    { schema: { tags, params: idParams, response: { 200: costPlanSchema } } },
    async (req) => getPlan(db, await access(req, 'planning:read'), req.params.id),
  );
  app.post(
    p,
    {
      bodyLimit: 2_000_000,
      schema: {
        tags,
        headers: financeWriteHeaders,
        body: costPlanInputSchema,
        response: { 201: costPlanSchema },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'planning:write');
      const result = await idempotentOperation(
        db,
        a,
        idempotencyKey(req),
        'cost-plan:create',
        req.body,
        'planning:write',
        async (tx) => {
          const [row] = await tx
            .insert(table)
            .values({ ...req.body, organizationId: a.organizationId, createdBy: a.userId })
            .returning();
          await audit(tx, a, 'create', 'cost_plan', row!.id, Object.keys(req.body));
          return { id: row!.id };
        },
      );
      return replay(reply, { ...result, data: await getPlan(db, a, result.data.id) }, 201);
    },
  );
  app.put(
    `${p}/:id`,
    {
      bodyLimit: 2_000_000,
      schema: {
        tags,
        params: idParams,
        headers: financeWriteHeaders,
        body: costPlanUpdateSchema,
        response: { 200: costPlanSchema },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'planning:write');
      const result = await idempotentOperation(
        db,
        a,
        idempotencyKey(req),
        `cost-plan:update:${req.params.id}`,
        req.body,
        'planning:write',
        async (tx) => {
          const current = await getPlan(tx, a, req.params.id);
          if (current.version !== req.body.version)
            throw new HttpError(
              409,
              'STALE_VERSION',
              'Kostenplan wurde zwischenzeitlich geändert.',
            );
          const { version, ...input } = req.body;
          await tx
            .update(table)
            .set({ ...input, version: version + 1, updatedAt: new Date() })
            .where(scope(a, current.id));
          await audit(tx, a, 'update', 'cost_plan', current.id, Object.keys(input));
          return { id: current.id };
        },
      );
      return replay(reply, { ...result, data: await getPlan(db, a, result.data.id) });
    },
  );
  app.get(
    `${p}/:id/export`,
    {
      schema: {
        tags,
        params: idParams,
        querystring: z.object({
          format: z.enum(['csv', 'xlsx']),
          language: z.enum(['de', 'it']).default('de'),
        }),
      },
    },
    async (req, reply) => {
      const plan = await getPlan(db, await access(req, 'planning:read'), req.params.id);
      const rows = costExportRows(plan, req.query.language),
        xlsx = req.query.format === 'xlsx';
      return reply
        .header('Content-Disposition', attachment(`cost-plan-${plan.id}.${req.query.format}`))
        .type(
          xlsx
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : 'text/csv; charset=utf-8',
        )
        .send(xlsx ? workbook(rows) : costCsv(rows));
    },
  );
}
