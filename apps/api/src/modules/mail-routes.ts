import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  financeWriteHeaders,
  mailRequestSchema,
  mailSendSchema,
  mailSettingsInputSchema,
  mailSettingsSchema,
  mailPreviewSchema,
  mailMessageSchema,
  mailStatusSchema,
  mailEnqueueResultSchema,
} from '@bnature/contracts';
import type { ModuleContext } from './context';
import { enqueuePreview, previewMail, listMail, getMailSettings, updateMailSettings } from './mail';

export function registerMailRoutes({ server, db, access, config }: ModuleContext) {
  const app = server.withTypeProvider<ZodTypeProvider>();
  const tags = ['Email'];
  app.get(
    '/api/v1/mail/status',
    { schema: { tags, response: { 200: mailStatusSchema } } },
    async (req) => {
      await access(req, 'mail:read');
      return { mode: config.EMAIL_MODE };
    },
  );
  app.get(
    '/api/v1/mail/messages',
    {
      schema: {
        tags,
        querystring: z.object({ page: z.coerce.number().int().min(1).max(10_000).default(1) }),
        response: {
          200: z.object({
            items: z.array(mailMessageSchema),
            total: z.number(),
            page: z.number(),
            pageSize: z.number(),
          }),
        },
      },
    },
    async (req) => {
      const a = await access(req, 'mail:read');
      return listMail(db, a, req.query.page);
    },
  );
  app.post(
    '/api/v1/mail/preview',
    { schema: { tags, body: mailRequestSchema, response: { 200: mailPreviewSchema } } },
    async (req) => {
      const a = await access(req, 'mail:read');
      return previewMail(db, a, req.body, config);
    },
  );
  app.post(
    '/api/v1/mail/send',
    {
      schema: {
        tags,
        headers: financeWriteHeaders,
        body: mailSendSchema,
        response: { 202: mailEnqueueResultSchema },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'mail:read');
      const result = await enqueuePreview(
        db,
        a,
        req.headers['idempotency-key'],
        req.body.request,
        req.body.previewHash,
        config,
      );
      return reply
        .code(202)
        .header('Idempotency-Replayed', String(result.replayed))
        .send(result.data);
    },
  );
  app.get(
    '/api/v1/mail/settings',
    { schema: { tags, response: { 200: mailSettingsSchema } } },
    async (req) => {
      const a = await access(req, 'users:manage');
      return getMailSettings(db, a.organizationId);
    },
  );
  app.put(
    '/api/v1/mail/settings',
    {
      schema: {
        tags,
        headers: financeWriteHeaders,
        body: mailSettingsInputSchema,
        response: { 200: mailSettingsSchema },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'users:manage');
      const result = await updateMailSettings(db, a, req.headers['idempotency-key'], req.body);
      return reply.header('Idempotency-Replayed', String(result.replayed)).send(result.data);
    },
  );
}
