import { z } from 'zod';
import type { FastifyReply } from 'fastify';
function sendPdf(reply: FastifyReply, pdf: Buffer, filename: string) {
  return reply
    .type('application/pdf')
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .send(pdf);
}
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  idParams,
  feePlanInputSchema,
  feePlanPatchSchema,
  feePlanResponseSchema,
  assessmentInputSchema,
  assessmentResponseSchema,
  assessmentDetailSchema,
  paymentInputSchema,
  paymentResponseSchema,
  financeListQuerySchema,
  financeSummaryQuerySchema,
  financeSummarySchema,
  financePageSchema,
  financeWriteHeaders,
  pdfQuerySchema,
  reminderResponseSchema,
  assessmentBatchRequestSchema,
  assessmentBatchPreviewSchema,
  assessmentBatchConfirmSchema,
  assessmentBatchResultSchema,
} from '@bnature/contracts';
import type { ModuleContext } from '../context';
import { previewAssessmentBatch, createAssessmentBatch } from './batch';
import {
  createPlan,
  updatePlan,
  listPlans,
  getPlan,
  createAssessment,
  listAssessments,
  getAssessmentDetail,
  createPayment,
  getPayment,
  listPayments,
  financeSummary,
  createReminder,
} from './service';
import { paymentPdf, reminderPdf } from './pdf';

export function registerFinanceRoutes({ server, db, access }: ModuleContext) {
  const app = server.withTypeProvider<ZodTypeProvider>(),
    p = '/api/v1';
  app.get(
    `${p}/fee-plans`,
    {
      schema: {
        tags: ['Membership fees'],
        querystring: financeListQuerySchema,
        response: { 200: financePageSchema(feePlanResponseSchema) },
      },
    },
    async (req) => {
      const a = await access(req, 'finance:read');
      return listPlans(db, a.organizationId, req.query);
    },
  );
  app.get(
    `${p}/fee-plans/:id`,
    {
      schema: {
        tags: ['Membership fees'],
        params: idParams,
        response: { 200: feePlanResponseSchema },
      },
    },
    async (req) => {
      const a = await access(req, 'finance:read');
      return getPlan(db, a.organizationId, req.params.id);
    },
  );
  app.post(
    `${p}/fee-plans`,
    {
      schema: {
        tags: ['Membership fees'],
        headers: financeWriteHeaders,
        body: feePlanInputSchema,
        response: { 201: feePlanResponseSchema },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'finance:plans'),
        result = await createPlan(db, a, req.headers['idempotency-key'], req.body);
      return reply
        .code(201)
        .header('Idempotency-Replayed', String(result.replayed))
        .send(result.data);
    },
  );
  app.patch(
    `${p}/fee-plans/:id`,
    {
      schema: {
        tags: ['Membership fees'],
        params: idParams,
        headers: financeWriteHeaders,
        body: feePlanPatchSchema,
        response: { 200: feePlanResponseSchema },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'finance:plans'),
        result = await updatePlan(db, a, req.headers['idempotency-key'], req.params.id, req.body);
      return reply.header('Idempotency-Replayed', String(result.replayed)).send(result.data);
    },
  );
  app.get(
    `${p}/fee-assessments`,
    {
      schema: {
        tags: ['Membership fees'],
        querystring: financeListQuerySchema,
        response: { 200: financePageSchema(assessmentResponseSchema) },
      },
    },
    async (req) => {
      const a = await access(req, 'finance:read');
      return listAssessments(db, a.organizationId, req.query);
    },
  );
  app.get(
    `${p}/fee-assessments/:id`,
    {
      schema: {
        tags: ['Membership fees'],
        params: idParams,
        response: { 200: assessmentDetailSchema },
      },
    },
    async (req) => {
      const a = await access(req, 'finance:read');
      return getAssessmentDetail(db, a.organizationId, req.params.id);
    },
  );
  app.post(
    `${p}/fee-assessments`,
    {
      schema: {
        tags: ['Membership fees'],
        headers: financeWriteHeaders,
        body: assessmentInputSchema,
        response: { 201: assessmentResponseSchema },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'finance:write'),
        result = await createAssessment(db, a, req.headers['idempotency-key'], req.body);
      return reply
        .code(201)
        .header('Idempotency-Replayed', String(result.replayed))
        .send(result.data);
    },
  );
  app.post(
    `${p}/fee-assessments/batch/preview`,
    {
      schema: {
        tags: ['Membership fees'],
        body: assessmentBatchRequestSchema,
        response: { 200: assessmentBatchPreviewSchema },
      },
    },
    async (req) => previewAssessmentBatch(db, await access(req, 'finance:write'), req.body),
  );
  app.post(
    `${p}/fee-assessments/batch`,
    {
      schema: {
        tags: ['Membership fees'],
        headers: financeWriteHeaders,
        body: assessmentBatchConfirmSchema,
        response: { 201: assessmentBatchResultSchema },
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const result = await createAssessmentBatch(
        db,
        await access(req, 'finance:write'),
        req.headers['idempotency-key'],
        req.body,
      );
      return reply
        .code(201)
        .header('Idempotency-Replayed', String(result.replayed))
        .send(result.data);
    },
  );
  app.get(
    `${p}/finance/summary`,
    {
      schema: {
        tags: ['Membership fees'],
        querystring: financeSummaryQuerySchema,
        response: { 200: financeSummarySchema },
      },
    },
    async (req) => {
      const a = await access(req, 'finance:read');
      return financeSummary(db, a.organizationId, req.query.fiscalYear);
    },
  );
  app.get(
    `${p}/payments`,
    {
      schema: {
        tags: ['Payments'],
        querystring: financeListQuerySchema,
        response: { 200: financePageSchema(paymentResponseSchema) },
      },
    },
    async (req) => {
      const a = await access(req, 'finance:read');
      return listPayments(db, a.organizationId, req.query);
    },
  );
  app.get(
    `${p}/payments/:id`,
    { schema: { tags: ['Payments'], params: idParams, response: { 200: paymentResponseSchema } } },
    async (req) => {
      const a = await access(req, 'finance:read');
      return getPayment(db, a.organizationId, req.params.id);
    },
  );
  app.post(
    `${p}/payments`,
    {
      schema: {
        tags: ['Payments'],
        headers: financeWriteHeaders,
        body: paymentInputSchema,
        response: { 201: paymentResponseSchema },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'finance:write'),
        result = await createPayment(db, a, req.headers['idempotency-key'], req.body);
      return reply
        .code(201)
        .header('Idempotency-Replayed', String(result.replayed))
        .send(result.data);
    },
  );
  app.get(
    `${p}/payments/:id/receipt`,
    {
      schema: {
        tags: ['Payments'],
        description:
          'Authorized PDF payment confirmation. Contains immutable payment and allocation data; no legal certification.',
        params: idParams,
        querystring: pdfQuerySchema,
        produces: ['application/pdf'],
        response: { 200: z.string().meta({ format: 'binary' }) },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'finance:read'),
        pdf = await paymentPdf(db, a.organizationId, req.params.id, req.query.language);
      return sendPdf(reply, pdf, `bnature-payment-${req.params.id}.pdf`);
    },
  );
  app.post(
    `${p}/fee-assessments/:id/reminders`,
    {
      schema: {
        tags: ['Membership fees'],
        params: idParams,
        headers: financeWriteHeaders,
        body: z.object({}).strict(),
        response: { 201: reminderResponseSchema },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'finance:write'),
        result = await createReminder(db, a, req.headers['idempotency-key'], req.params.id);
      return reply
        .code(201)
        .header('Idempotency-Replayed', String(result.replayed))
        .send(result.data);
    },
  );
  app.get(
    `${p}/fee-reminders/:id/pdf`,
    {
      schema: {
        tags: ['Membership fees'],
        description: 'Prepared reminder draft for manual delivery. Does not send email.',
        params: idParams,
        querystring: pdfQuerySchema,
        produces: ['application/pdf'],
        response: { 200: z.string().meta({ format: 'binary' }) },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'finance:read'),
        pdf = await reminderPdf(db, a.organizationId, req.params.id, req.query.language);
      return sendPdf(reply, pdf, `bnature-reminder-${req.params.id}.pdf`);
    },
  );
}
