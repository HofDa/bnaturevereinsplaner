import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { clientErrorSchema, errorReportSchema, idParams } from '@bnature/contracts';
import type { ModuleContext } from './context';
import { HttpError } from '../middleware/access';
import { audit } from '../services/audit';
import { dismissErrorReport, listErrorReports, recordError } from '../services/error-reports';

export function registerErrorReportRoutes({ server, db, access, errorAlert }: ModuleContext) {
  const app = server.withTypeProvider<ZodTypeProvider>();
  const tags = ['System'];
  // Open to signed-out visitors too (the login screen can break as well), hence the tight
  // limit, the size caps in the schema and the cap on stored reports.
  app.post(
    '/api/v1/client-errors',
    {
      schema: { tags, body: clientErrorSchema },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      await recordError(
        db,
        {
          source: 'web',
          name: req.body.name,
          message: req.body.message,
          stack: req.body.stack,
          // Only the path: query strings can carry search terms or drafts.
          location: `${req.body.kind} ${req.body.path.split(/[?#]/)[0]}`,
          release: req.body.release,
          userAgent: req.headers['user-agent'],
        },
        errorAlert,
      );
      return reply.code(204).send();
    },
  );
  app.get(
    '/api/v1/error-reports',
    { schema: { tags, response: { 200: z.object({ items: z.array(errorReportSchema) }) } } },
    async (req) => {
      await access(req, 'audit:read');
      const rows = await listErrorReports(db);
      return {
        items: rows.map(({ firstSeenAt, lastSeenAt, ...row }) => ({
          ...row,
          firstSeenAt: firstSeenAt.toISOString(),
          lastSeenAt: lastSeenAt.toISOString(),
        })),
      };
    },
  );
  app.post(
    '/api/v1/error-reports/:id/dismiss',
    { schema: { tags, params: idParams } },
    async (req, reply) => {
      const a = await access(req, 'audit:read');
      if (!(await dismissErrorReport(db, req.params.id)))
        throw new HttpError(404, 'NOT_FOUND', 'Fehlerbericht nicht gefunden.');
      await audit(db, a, 'delete', 'error_report', req.params.id, ['state']);
      return reply.code(204).send();
    },
  );
}
