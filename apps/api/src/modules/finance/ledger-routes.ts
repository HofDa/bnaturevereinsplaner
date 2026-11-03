import { replay, sendPdf } from '../http';
import { registerFinanceExtensions } from './extension-routes';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  idParams,
  financeWriteHeaders,
  financePageSchema,
  paymentResponseSchema,
  bookingInputSchema,
  paymentReversalInputSchema,
  accountInputSchema,
  accountPatchSchema,
  accountResponseSchema,
  categoryInputSchema,
  categoryPatchSchema,
  categoryResponseSchema,
  fiscalYearInputSchema,
  fiscalYearResponseSchema,
  yearParams,
  cashbookEntryInputSchema,
  cashbookEntryResponseSchema,
  cashbookQuerySchema,
  reversalInputSchema,
  reportTemplateInputSchema,
  reportTemplateVersionInputSchema,
  reportTemplateResponseSchema,
  templateKeyParams,
  annualReportQuerySchema,
  annualReportSchema,
  itemsOf,
} from '@bnature/contracts';
import type { ModuleContext } from '../context';
import {
  listAccounts,
  createAccount,
  updateAccount,
  listCategories,
  createCategory,
  updateCategory,
  listFiscalYears,
  openFiscalYear,
  closeFiscalYear,
  listEntries,
  getEntry,
  createEntry,
  reverseEntry,
  bookExistingPayment,
  reversePayment,
  listTemplates,
  listTemplateVersions,
  createTemplate,
  createTemplateVersion,
  annualReport,
} from './ledger';
import { annualReportPdf } from './pdf';

export function registerLedgerRoutes(context: ModuleContext) {
  registerFinanceExtensions(context);
  const { server, db, access } = context;
  const app = server.withTypeProvider<ZodTypeProvider>(),
    p = '/api/v1/finance',
    tags = ['Ledger'];
  app.get(
    `${p}/accounts`,
    { schema: { tags, response: { 200: itemsOf(accountResponseSchema) } } },
    async (req) => listAccounts(db, (await access(req, 'finance:read')).organizationId),
  );
  app.post(
    `${p}/accounts`,
    {
      schema: {
        tags,
        headers: financeWriteHeaders,
        body: accountInputSchema,
        response: { 201: accountResponseSchema },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'finance:write'),
        result = await createAccount(db, a, req.headers['idempotency-key'], req.body);
      return replay(reply, result, 201);
    },
  );
  app.patch(
    `${p}/accounts/:id`,
    {
      schema: {
        tags,
        params: idParams,
        headers: financeWriteHeaders,
        body: accountPatchSchema,
        response: { 200: accountResponseSchema },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'finance:write'),
        result = await updateAccount(
          db,
          a,
          req.headers['idempotency-key'],
          req.params.id,
          req.body,
        );
      return replay(reply, result);
    },
  );
  app.get(
    `${p}/categories`,
    { schema: { tags, response: { 200: itemsOf(categoryResponseSchema) } } },
    async (req) => listCategories(db, (await access(req, 'finance:read')).organizationId),
  );
  app.post(
    `${p}/categories`,
    {
      schema: {
        tags,
        headers: financeWriteHeaders,
        body: categoryInputSchema,
        response: { 201: categoryResponseSchema },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'finance:write'),
        result = await createCategory(db, a, req.headers['idempotency-key'], req.body);
      return replay(reply, result, 201);
    },
  );
  app.patch(
    `${p}/categories/:id`,
    {
      schema: {
        tags,
        params: idParams,
        headers: financeWriteHeaders,
        body: categoryPatchSchema,
        response: { 200: categoryResponseSchema },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'finance:write'),
        result = await updateCategory(
          db,
          a,
          req.headers['idempotency-key'],
          req.params.id,
          req.body,
        );
      return replay(reply, result);
    },
  );
  app.get(
    `${p}/fiscal-years`,
    { schema: { tags, response: { 200: itemsOf(fiscalYearResponseSchema) } } },
    async (req) => listFiscalYears(db, (await access(req, 'finance:read')).organizationId),
  );
  app.post(
    `${p}/fiscal-years`,
    {
      schema: {
        tags,
        description:
          'Opens a fiscal year with inclusive date boundaries (calendar year by default). Without openingBalances, balances are carried forward from the closed previous year.',
        headers: financeWriteHeaders,
        body: fiscalYearInputSchema,
        response: { 201: fiscalYearResponseSchema },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'finance:write'),
        result = await openFiscalYear(db, a, req.headers['idempotency-key'], req.body);
      return replay(reply, result, 201);
    },
  );
  app.post(
    `${p}/fiscal-years/:year/close`,
    {
      schema: {
        tags,
        description:
          'Irreversibly closes a fiscal year. Later corrections are booked in an open year.',
        params: yearParams,
        headers: financeWriteHeaders,
        body: z.object({ confirm: z.literal(true) }).strict(),
        response: { 200: fiscalYearResponseSchema },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'finance:close'),
        result = await closeFiscalYear(db, a, req.headers['idempotency-key'], req.params.year);
      return replay(reply, result);
    },
  );
  app.get(
    `${p}/cashbook`,
    {
      schema: {
        tags,
        querystring: cashbookQuerySchema,
        response: { 200: financePageSchema(cashbookEntryResponseSchema) },
      },
    },
    async (req) => listEntries(db, (await access(req, 'finance:read')).organizationId, req.query),
  );
  app.get(
    `${p}/cashbook/:id`,
    { schema: { tags, params: idParams, response: { 200: cashbookEntryResponseSchema } } },
    async (req) => getEntry(db, (await access(req, 'finance:read')).organizationId, req.params.id),
  );
  app.post(
    `${p}/cashbook`,
    {
      schema: {
        tags,
        description:
          'Posts an immutable income or expense entry. Membership fees are booked from payments instead.',
        headers: financeWriteHeaders,
        body: cashbookEntryInputSchema,
        response: { 201: cashbookEntryResponseSchema },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'finance:write'),
        result = await createEntry(db, a, req.headers['idempotency-key'], req.body);
      return replay(reply, result, 201);
    },
  );
  app.post(
    `${p}/cashbook/:id/reversal`,
    {
      schema: {
        tags,
        params: idParams,
        headers: financeWriteHeaders,
        body: reversalInputSchema,
        response: { 201: cashbookEntryResponseSchema },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'finance:write'),
        result = await reverseEntry(db, a, req.headers['idempotency-key'], req.params.id, req.body);
      return replay(reply, result, 201);
    },
  );
  app.post(
    '/api/v1/payments/:id/booking',
    {
      schema: {
        tags: ['Payments'],
        params: idParams,
        headers: financeWriteHeaders,
        body: bookingInputSchema,
        response: { 200: paymentResponseSchema },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'finance:write'),
        result = await bookExistingPayment(
          db,
          a,
          req.headers['idempotency-key'],
          req.params.id,
          req.body,
        );
      return replay(reply, result);
    },
  );
  app.post(
    '/api/v1/payments/:id/reversal',
    {
      schema: {
        tags: ['Payments'],
        description:
          'Reverses a payment: its allocations stop counting and a booked cashbook entry is reversed atomically.',
        params: idParams,
        headers: financeWriteHeaders,
        body: paymentReversalInputSchema,
        response: { 200: paymentResponseSchema },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'finance:write'),
        result = await reversePayment(
          db,
          a,
          req.headers['idempotency-key'],
          req.params.id,
          req.body,
        );
      return replay(reply, result);
    },
  );
  app.get(
    `${p}/report-templates`,
    { schema: { tags, response: { 200: itemsOf(reportTemplateResponseSchema) } } },
    async (req) => listTemplates(db, (await access(req, 'finance:read')).organizationId),
  );
  app.get(
    `${p}/report-templates/:key/versions`,
    {
      schema: {
        tags,
        params: templateKeyParams,
        response: { 200: itemsOf(reportTemplateResponseSchema) },
      },
    },
    async (req) =>
      listTemplateVersions(db, (await access(req, 'finance:read')).organizationId, req.params.key),
  );
  app.post(
    `${p}/report-templates`,
    {
      schema: {
        tags,
        description:
          'Organization-defined report structure. Not an official or certified template.',
        headers: financeWriteHeaders,
        body: reportTemplateInputSchema,
        response: { 201: reportTemplateResponseSchema },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'finance:write'),
        result = await createTemplate(db, a, req.headers['idempotency-key'], req.body);
      return replay(reply, result, 201);
    },
  );
  app.post(
    `${p}/report-templates/:key/versions`,
    {
      schema: {
        tags,
        params: templateKeyParams,
        headers: financeWriteHeaders,
        body: reportTemplateVersionInputSchema,
        response: { 201: reportTemplateResponseSchema },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'finance:write'),
        result = await createTemplateVersion(
          db,
          a,
          req.headers['idempotency-key'],
          req.params.key,
          req.body,
        );
      return replay(reply, result, 201);
    },
  );
  app.get(
    `${p}/reports/annual`,
    {
      schema: { tags, querystring: annualReportQuerySchema, response: { 200: annualReportSchema } },
    },
    async (req) =>
      annualReport(
        db,
        (await access(req, 'finance:read')).organizationId,
        req.query.fiscalYear,
        req.query.templateId,
      ),
  );
  app.get(
    `${p}/reports/annual/pdf`,
    {
      schema: {
        tags,
        description: 'Authorized annual income/expense report. No legal certification.',
        querystring: annualReportQuerySchema,
        produces: ['application/pdf'],
        response: { 200: z.string().meta({ format: 'binary' }) },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'finance:read'),
        pdf = await annualReportPdf(
          db,
          a.organizationId,
          req.query.fiscalYear,
          req.query.language,
          req.query.templateId,
        );
      return sendPdf(reply, pdf, `bnature-report-${req.query.fiscalYear}.pdf`);
    },
  );
}
