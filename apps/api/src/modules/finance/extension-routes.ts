import { csvCell } from '@bnature/contracts';
import { z } from 'zod';
import type { FastifyReply } from 'fastify';
const sendBinary = (reply: FastifyReply, bytes: Buffer) => reply.send(bytes);
import { and, eq, sql, desc } from 'drizzle-orm';
import { schema as s } from '@bnature/db';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  idParams,
  financeWriteHeaders,
  transferInputSchema,
  transferResponseSchema,
  itemsOf,
  reversalInputSchema,
  annualReportQuerySchema,
  backfillInputSchema,
  backfillResponseSchema,
  etsMappingInputSchema,
  etsMappingResponseSchema,
  etsReportQuerySchema,
  etsReportSchema,
  cashbookEntryResponseSchema,
  ETS_POSITIONS,
  ETS_RULES,
  cashbookQuerySchema,
  financeDashboardSchema,
  formatMoney,
} from '@bnature/contracts';
import type { ModuleContext } from '../context';
import {
  getEntry,
  createTransfer,
  reverseTransfer,
  listTransfers,
  backfillPayments,
  listEntries,
  annualReport,
} from './ledger';
import { createMapping, listMappings, initializeFinance, etsReport } from './ets';
import { financeSummary, businessDate } from './service';
import { renderPdf, organizationName } from './pdf';
import { HttpError } from '../../middleware/access';

const yearQuery = z.object({ fiscalYear: z.coerce.number().int().min(1900).max(2200) });
const binary = z.string().meta({ format: 'binary' });
export function registerFinanceExtensions({ server, db, access }: ModuleContext) {
  const app = server.withTypeProvider<ZodTypeProvider>(),
    p = '/api/v1/finance',
    tags = ['Ledger'];
  app.post(
    `${p}/initialize`,
    {
      schema: {
        tags,
        headers: financeWriteHeaders,
        body: z.object({ language: z.enum(['de', 'it']).default('de') }).strict(),
        response: { 200: z.object({ initialized: z.boolean() }) },
      },
    },
    async (req, reply) => {
      const r = await initializeFinance(
        db,
        await access(req, 'finance:write'),
        req.headers['idempotency-key'],
        req.body.language,
      );
      return reply.header('Idempotency-Replayed', String(r.replayed)).send(r.data);
    },
  );
  app.get(
    `${p}/cashbook/:id/history`,
    { schema: { tags, params: idParams, response: { 200: itemsOf(cashbookEntryResponseSchema) } } },
    async (req) => {
      const org = (await access(req, 'finance:read')).organizationId;
      return db.transaction(
        async (tx) => {
          const current = await getEntry(tx, org, req.params.id),
            original = current.reversesEntryId
              ? await getEntry(tx, org, current.reversesEntryId)
              : current;
          return {
            items: [
              original,
              ...(original.reversedByEntryId
                ? [await getEntry(tx, org, original.reversedByEntryId)]
                : []),
            ],
          };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    },
  );
  app.get(
    `${p}/transfers`,
    {
      schema: { tags, querystring: yearQuery, response: { 200: itemsOf(transferResponseSchema) } },
    },
    async (req) =>
      listTransfers(db, (await access(req, 'finance:read')).organizationId, req.query.fiscalYear),
  );
  app.post(
    `${p}/transfers`,
    {
      schema: {
        tags,
        headers: financeWriteHeaders,
        body: transferInputSchema,
        response: { 201: transferResponseSchema },
      },
    },
    async (req, reply) => {
      const r = await createTransfer(
        db,
        await access(req, 'finance:write'),
        req.headers['idempotency-key'],
        req.body,
      );
      return reply.code(201).header('Idempotency-Replayed', String(r.replayed)).send(r.data);
    },
  );
  app.post(
    `${p}/transfers/:id/reversal`,
    {
      schema: {
        tags,
        params: idParams,
        headers: financeWriteHeaders,
        body: reversalInputSchema,
        response: { 201: transferResponseSchema },
      },
    },
    async (req, reply) => {
      const r = await reverseTransfer(
        db,
        await access(req, 'finance:write'),
        req.headers['idempotency-key'],
        req.params.id,
        req.body,
      );
      return reply.code(201).header('Idempotency-Replayed', String(r.replayed)).send(r.data);
    },
  );
  app.post(
    `${p}/payments/backfill`,
    {
      schema: {
        tags,
        description:
          'Controlled backfill, at most 100 unbooked payments per operation. Repeat with a new key while remaining > 0.',
        headers: financeWriteHeaders,
        body: backfillInputSchema,
        response: { 200: backfillResponseSchema },
      },
    },
    async (req, reply) => {
      const r = await backfillPayments(
        db,
        await access(req, 'finance:write'),
        req.headers['idempotency-key'],
        req.body,
      );
      return reply.header('Idempotency-Replayed', String(r.replayed)).send(r.data);
    },
  );
  app.get(
    `${p}/ets-definitions`,
    {
      schema: {
        tags,
        response: {
          200: z.object({
            rules: z.unknown(),
            positions: z.array(
              z.object({
                code: z.string(),
                direction: z.enum(['income', 'expense']),
                de: z.string(),
                it: z.string(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      await access(req, 'finance:read');
      return { rules: ETS_RULES, positions: [...ETS_POSITIONS] };
    },
  );
  app.get(
    `${p}/categories/:id/ets-mappings`,
    { schema: { tags, params: idParams, response: { 200: itemsOf(etsMappingResponseSchema) } } },
    async (req) =>
      listMappings(db, (await access(req, 'finance:read')).organizationId, req.params.id),
  );
  app.post(
    `${p}/categories/:id/ets-mappings`,
    {
      schema: {
        tags,
        params: idParams,
        headers: financeWriteHeaders,
        body: etsMappingInputSchema,
        response: { 201: etsMappingResponseSchema },
      },
    },
    async (req, reply) => {
      const r = await createMapping(
        db,
        await access(req, 'finance:write'),
        req.headers['idempotency-key'],
        req.params.id,
        req.body,
      );
      return reply.code(201).header('Idempotency-Replayed', String(r.replayed)).send(r.data);
    },
  );
  app.get(
    `${p}/reports/ets`,
    { schema: { tags, querystring: etsReportQuerySchema, response: { 200: etsReportSchema } } },
    async (req) => etsReport(db, (await access(req, 'finance:read')).organizationId, req.query),
  );
  for (const format of ['pdf', 'csv'] as const)
    app.get(
      `${p}/reports/ets/${format}`,
      { schema: { tags, querystring: etsReportQuerySchema, response: { 200: binary } } },
      async (req, reply) => {
        const org = (await access(req, 'finance:read')).organizationId,
          r = await etsReport(db, org, req.query),
          it = req.query.language === 'it';
        const priorSum = (field: 'openingCents' | 'closingCents') =>
          r.priorFiscalYear === null
            ? null
            : String(r.priorAccounts.reduce((n, a) => n + BigInt(a[field]), 0n));
        const priorAccounts = new Map(r.priorAccounts.map((a) => [a.accountId, a]));
        const extras = [
          [
            'opening',
            it ? 'Saldo iniziale' : 'Anfangsbestand',
            r.openingCents,
            priorSum('openingCents'),
          ],
          ['closing', it ? 'Saldo finale' : 'Endbestand', r.closingCents, priorSum('closingCents')],
        ];
        extras.push(
          ...r.accounts.flatMap((a) => [
            [
              `account.${a.accountId}.opening`,
              `${a.name} · ${it ? 'iniziale' : 'Anfang'}`,
              a.openingCents,
              r.priorFiscalYear === null
                ? null
                : (priorAccounts.get(a.accountId)?.openingCents ?? '0'),
            ],
            [
              `account.${a.accountId}.closing`,
              `${a.name} · ${it ? 'finale' : 'Ende'}`,
              a.closingCents,
              r.priorFiscalYear === null
                ? null
                : (priorAccounts.get(a.accountId)?.closingCents ?? '0'),
            ],
          ]),
        );
        const checkLabels: Record<string, string> = it
          ? {
              balanced: 'Saldi riconciliati',
              mapped: 'Attribuzioni complete',
              payments_booked: 'Pagamenti contabilizzati',
              nonnegative_cash: 'Cassa non negativa',
              model_date: 'Applicabilità temporale',
              prior_year_available: 'Valori precedenti disponibili',
            }
          : {
              balanced: 'Bestände abgestimmt',
              mapped: 'Zuordnungen vollständig',
              payments_booked: 'Zahlungen verbucht',
              nonnegative_cash: 'Kasse nicht negativ',
              model_date: 'Zeitliche Anwendbarkeit',
              prior_year_available: 'Vorjahreswerte verfügbar',
            };
        const checks = r.checks.map((c) => `${c.ok ? 'OK' : '!'} ${checkLabels[c.code] ?? c.code}`);
        const lines = r.rows.map(
          (row) =>
            `${row.code} ${row.label}: +${formatMoney(row.incomeCents, req.query.language)} / -${formatMoney(row.expenseCents, req.query.language)} = ${formatMoney(row.resultCents, req.query.language)} | t-1 ${row.priorResultCents === null ? '?' : formatMoney(row.priorResultCents, req.query.language)}`,
        );
        const filename = `bnature-ETS-${r.model}-${r.fiscalYear}.${format}`;
        reply
          .header('Cache-Control', 'no-store')
          .header('Content-Disposition', `attachment; filename="${filename}"`);
        if (format === 'pdf')
          return sendBinary(
            reply.type('application/pdf'),
            await renderPdf(
              `ETS ${r.model} ${r.fiscalYear} · ${r.definitionVersion}`,
              await organizationName(db, org),
              [
                r.notice,
                `${it ? 'Modello' : 'Berichtsmodell'}: ${r.eligibility === 'within_limit' ? (it ? 'entro la soglia' : 'innerhalb der Schwelle') : r.eligibility === 'outside_limit' ? (it ? 'fuori soglia o periodo' : 'außerhalb Schwelle oder Zeitraum') : it ? 'da verificare' : 'zu prüfen'}`,
                ...lines,
                ...extras.map(
                  (x) =>
                    `${x[1]}: ${formatMoney(x[2]!, req.query.language)} | t-1 ${x[3] === null ? '?' : formatMoney(x[3]!, req.query.language)}`,
                ),
                ...checks,
                `${it ? 'Senza attribuzione' : 'Ohne Zuordnung'}: ${r.unmappedEntryIds.length}`,
              ],
              req.query.language,
              r.notice,
            ),
          );
        const data = [
          [
            'code',
            'label',
            'income_cents',
            'expense_cents',
            'result_cents',
            'prior_income_cents',
            'prior_expense_cents',
            'prior_result_cents',
          ],
          ...r.rows.map((row) => [
            row.code,
            row.label,
            row.incomeCents,
            row.expenseCents,
            row.resultCents,
            row.priorIncomeCents ?? '',
            row.priorExpenseCents ?? '',
            row.priorResultCents ?? '',
          ]),
          ...extras.map((x) => [x[0], x[1], '', '', x[2], '', '', x[3] ?? '']),
          ['definition', r.definitionVersion],
          ['eligibility', r.eligibility],
          ...r.checks.map((c) => [c.code, c.ok]),
          ...r.unmappedEntryIds.map((id) => ['unmapped', id]),
          ['notice', r.notice],
        ];
        return reply
          .type('text/csv; charset=utf-8')
          .send('\uFEFF' + data.map((row) => row.map(csvCell).join(';')).join('\r\n'));
      },
    );
  app.get(
    `${p}/cashbook-export/pdf`,
    {
      schema: {
        tags,
        querystring: cashbookQuerySchema.extend({ language: z.enum(['de', 'it']).default('de') }),
        response: { 200: binary },
      },
    },
    async (req, reply) => {
      const org = (await access(req, 'finance:read')).organizationId;
      return db.transaction(
        async (tx) => {
          const lines: string[] = [];
          let page = 1;
          while (true) {
            const r = await listEntries(tx, org, {
              ...req.query,
              page,
              pageSize: 100,
              order: 'asc',
            });
            lines.push(
              ...r.items.map(
                (e) =>
                  `${e.fiscalYear}/${e.entryNumber} | ${e.bookingDate} | ${e.accountName} | ${e.categoryName} | ${e.direction === 'expense' ? '-' : '+'}${formatMoney(e.amountCents, req.query.language)} | ${e.description} | ${e.project}`,
              ),
            );
            if (page * 100 >= r.total) break;
            if (++page > 100)
              throw new HttpError(422, 'EXPORT_TOO_LARGE', 'Export bitte nach Datum filtern.');
          }
          return sendBinary(
            reply
              .type('application/pdf')
              .header('Cache-Control', 'no-store')
              .header('Content-Disposition', 'attachment; filename="bnature-cashbook.pdf"'),
            await renderPdf(
              req.query.language === 'it' ? 'Libro cassa' : 'Kassabuch',
              await organizationName(tx, org),
              lines,
              req.query.language,
            ),
          );
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    },
  );
  app.get(
    `${p}/dashboard`,
    {
      schema: {
        tags,
        querystring: annualReportQuerySchema.partial(),
        response: { 200: financeDashboardSchema },
      },
    },
    async (req) => {
      const org = (await access(req, 'finance:read')).organizationId;
      return db.transaction(
        async (tx) => {
          const today = await businessDate(tx, org);
          const [year] = await tx
            .select()
            .from(s.fiscalYears)
            .where(
              and(
                eq(s.fiscalYears.organizationId, org),
                req.query.fiscalYear
                  ? eq(s.fiscalYears.year, req.query.fiscalYear)
                  : sql`${s.fiscalYears.startsOn}<=${today} and ${s.fiscalYears.endsOn}>=${today}`,
              ),
            )
            .orderBy(desc(s.fiscalYears.startsOn))
            .limit(1);
          if (!year) throw new HttpError(404, 'FISCAL_YEAR_NOT_FOUND', 'Geschäftsjahr anlegen.');
          const r = await annualReport(tx, org, year.year),
            fees = await financeSummary(tx, org),
            recent = await listEntries(tx, org, {
              fiscalYear: year.year,
              page: 1,
              pageSize: 8,
              search: '',
              order: 'desc',
            });
          const trend = (
            await tx.execute<{ month: string; incomeCents: string; expenseCents: string }>(
              sql`select to_char(booking_date,'YYYY-MM') as "month",coalesce(sum(amount_cents) filter(where direction='income'),0)::text "incomeCents",coalesce(sum(amount_cents) filter(where direction='expense'),0)::text "expenseCents" from cashbook_entries where organization_id=${org} and fiscal_year=${year.year} group by 1 order by 1`,
            )
          ).rows;
          const sum = (kind?: 'cash' | 'bank') =>
            String(
              r.accounts
                .filter((a) => !kind || a.kind === kind)
                .reduce((n, a) => n + BigInt(a.closingCents), 0n),
            );
          return {
            fiscalYear: year.year,
            startsOn: year.startsOn,
            endsOn: year.endsOn,
            totalCents: sum(),
            bankCents: sum('bank'),
            cashCents: sum('cash'),
            incomeCents: r.incomeCents,
            expenseCents: r.expenseCents,
            openFeesCents: fees.openCents,
            recent: recent.items,
            trend,
          };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    },
  );
}
