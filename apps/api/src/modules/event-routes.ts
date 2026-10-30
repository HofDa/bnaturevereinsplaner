import { z } from 'zod';
import type { FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  idSchema,
  idParams,
  financeWriteHeaders,
  itemsOf,
  financePageSchema,
  eventCategoryInputSchema,
  eventCategoryPatchSchema,
  eventCategoryResponseSchema,
  eventInputSchema,
  eventPatchSchema,
  eventResponseSchema,
  eventQuerySchema,
  eventCancelSchema,
  seriesInputSchema,
  seriesPatchSchema,
  seriesResponseSchema,
  registrationInputSchema,
  registrationPatchSchema,
  registrationResponseSchema,
  attendanceRecordSchema,
  attendanceSnapshotSchema,
  attendancePutSchema,
  attendanceSyncSchema,
  attendanceResultSchema,
  attendanceHistorySchema,
  eventPersonSchema,
  eventPeopleQuerySchema,
  eventExportQuerySchema,
  languageSchema,
} from '@bnature/contracts';
import type { ModuleContext } from './context';
import {
  listEvents,
  getEvent,
  createEvent,
  patchEvent,
  cancelEvent,
  listEventCategories,
  initializeEventCategories,
  createEventCategory,
  patchEventCategory,
  listSeries,
  createSeries,
  patchSeries,
  eventPeople,
  eventOrganizers,
} from './events';
import {
  listRegistrations,
  createRegistration,
  patchRegistration,
  deleteRegistration,
} from './event-registrations';
import {
  attendanceList,
  prepareAttendance,
  attendanceOperation,
  syncAttendance,
  attendanceHistory,
} from './event-attendance';
import { registerDocumentRoutes } from './document-routes';
import { attendanceExport, calendarExport } from './event-exports';
const sendBinary = (reply: FastifyReply, data: Buffer | string) => reply.send(data);
const registrationParams = z.object({ id: idSchema, registrationId: idSchema });
const replay = (reply: FastifyReply, r: { data: unknown; replayed: boolean }, status = 200) =>
  reply.code(status).header('Idempotency-Replayed', String(r.replayed)).send(r.data);
export function registerEventRoutes(context: ModuleContext) {
  const { server, db, access } = context;
  registerDocumentRoutes(context, '/api/v1/events/:eventId/documents');
  const app = server.withTypeProvider<ZodTypeProvider>(),
    p = '/api/v1',
    tags = ['Events'];
  app.get(
    `${p}/event-categories`,
    { schema: { tags, response: { 200: itemsOf(eventCategoryResponseSchema) } } },
    async (req) => listEventCategories(db, await access(req, 'events:read')),
  );
  app.post(
    `${p}/event-categories/initialize`,
    {
      schema: {
        tags,
        headers: financeWriteHeaders,
        body: z.object({}).strict(),
        response: { 200: itemsOf(eventCategoryResponseSchema) },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await initializeEventCategories(
          db,
          await access(req, 'events:categories'),
          req.headers['idempotency-key'],
        ),
      ),
  );
  app.post(
    `${p}/event-categories`,
    {
      schema: {
        tags,
        headers: financeWriteHeaders,
        body: eventCategoryInputSchema,
        response: { 201: eventCategoryResponseSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await createEventCategory(
          db,
          await access(req, 'events:categories'),
          req.headers['idempotency-key'],
          req.body,
        ),
        201,
      ),
  );
  app.patch(
    `${p}/event-categories/:id`,
    {
      schema: {
        tags,
        headers: financeWriteHeaders,
        params: idParams,
        body: eventCategoryPatchSchema,
        response: { 200: eventCategoryResponseSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await patchEventCategory(
          db,
          await access(req, 'events:categories'),
          req.headers['idempotency-key'],
          req.params.id,
          req.body,
        ),
      ),
  );
  app.get(
    `${p}/events/calendar.ics`,
    {
      schema: {
        tags,
        querystring: eventQuerySchema.extend({ language: languageSchema.default('de') }),
        response: { 200: z.string() },
      },
    },
    async (req, reply) =>
      reply
        .type('text/calendar; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="bnature-events.ics"')
        .send(
          await calendarExport(db, await access(req, 'events:read'), req.query, req.query.language),
        ),
  );
  app.get(
    `${p}/event-people`,
    {
      schema: {
        tags,
        querystring: eventPeopleQuerySchema,
        response: { 200: itemsOf(eventPersonSchema) },
      },
    },
    async (req) => eventPeople(db, await access(req, 'events:write'), req.query.search),
  );
  app.get(
    `${p}/event-organizers`,
    { schema: { tags, response: { 200: itemsOf(z.object({ id: idSchema, name: z.string() })) } } },
    async (req) => eventOrganizers(db, await access(req, 'events:write')),
  );
  app.get(
    `${p}/events`,
    {
      schema: {
        tags,
        querystring: eventQuerySchema,
        response: { 200: financePageSchema(eventResponseSchema) },
      },
    },
    async (req) => listEvents(db, await access(req, 'events:read'), req.query),
  );
  app.post(
    `${p}/events`,
    {
      schema: {
        tags,
        headers: financeWriteHeaders,
        body: eventInputSchema,
        response: { 201: eventResponseSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await createEvent(
          db,
          await access(req, 'events:write'),
          req.headers['idempotency-key'],
          req.body,
        ),
        201,
      ),
  );
  app.get(
    `${p}/events/:id`,
    { schema: { tags, params: idParams, response: { 200: eventResponseSchema } } },
    async (req) => getEvent(db, await access(req, 'events:read'), req.params.id),
  );
  app.patch(
    `${p}/events/:id`,
    {
      schema: {
        tags,
        params: idParams,
        headers: financeWriteHeaders,
        body: eventPatchSchema,
        response: { 200: eventResponseSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await patchEvent(
          db,
          await access(req, 'events:write'),
          req.headers['idempotency-key'],
          req.params.id,
          req.body,
        ),
      ),
  );
  app.post(
    `${p}/events/:id/cancel`,
    {
      schema: {
        tags,
        params: idParams,
        headers: financeWriteHeaders,
        body: eventCancelSchema,
        response: { 200: eventResponseSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await cancelEvent(
          db,
          await access(req, 'events:write'),
          req.headers['idempotency-key'],
          req.params.id,
          req.body,
        ),
      ),
  );
  app.get(
    `${p}/event-series`,
    { schema: { tags, response: { 200: itemsOf(seriesResponseSchema) } } },
    async (req) => listSeries(db, await access(req, 'events:write')),
  );
  app.post(
    `${p}/event-series`,
    {
      schema: {
        tags,
        headers: financeWriteHeaders,
        body: seriesInputSchema,
        response: { 201: seriesResponseSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await createSeries(
          db,
          await access(req, 'events:write'),
          req.headers['idempotency-key'],
          req.body,
        ),
        201,
      ),
  );
  app.patch(
    `${p}/event-series/:id`,
    {
      schema: {
        tags,
        params: idParams,
        headers: financeWriteHeaders,
        body: seriesPatchSchema,
        response: { 200: seriesResponseSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await patchSeries(
          db,
          await access(req, 'events:write'),
          req.headers['idempotency-key'],
          req.params.id,
          req.body,
        ),
      ),
  );
  app.get(
    `${p}/events/:id/registrations`,
    { schema: { tags, params: idParams, response: { 200: itemsOf(registrationResponseSchema) } } },
    async (req) => listRegistrations(db, await access(req, 'events:read'), req.params.id),
  );
  app.post(
    `${p}/events/:id/registrations`,
    {
      schema: {
        tags,
        params: idParams,
        headers: financeWriteHeaders,
        body: registrationInputSchema,
        response: { 201: registrationResponseSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await createRegistration(
          db,
          await access(req, 'events:register'),
          req.headers['idempotency-key'],
          req.params.id,
          req.body,
        ),
        201,
      ),
  );
  app.patch(
    `${p}/registrations/:id`,
    {
      schema: {
        tags,
        params: idParams,
        headers: financeWriteHeaders,
        body: registrationPatchSchema,
        response: { 200: registrationResponseSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await patchRegistration(
          db,
          await access(req, 'events:register'),
          req.headers['idempotency-key'],
          req.params.id,
          req.body,
        ),
      ),
  );
  app.delete(
    `${p}/registrations/:id`,
    {
      schema: {
        tags,
        params: idParams,
        headers: financeWriteHeaders,
        body: z.object({ version: z.number().int().positive() }).strict(),
        response: { 200: registrationResponseSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await deleteRegistration(
          db,
          await access(req, 'events:register'),
          req.headers['idempotency-key'],
          req.params.id,
          req.body.version,
        ),
      ),
  );
  app.get(
    `${p}/events/:id/attendance`,
    { schema: { tags, params: idParams, response: { 200: itemsOf(attendanceRecordSchema) } } },
    async (req) => attendanceList(db, await access(req, 'attendance:write'), req.params.id),
  );
  app.get(
    `${p}/events/:id/attendance/prepare`,
    { schema: { tags, params: idParams, response: { 200: attendanceSnapshotSchema } } },
    async (req) => prepareAttendance(db, await access(req, 'attendance:write'), req.params.id),
  );
  app.get(
    `${p}/events/:id/attendance/:registrationId/history`,
    {
      schema: {
        tags,
        params: registrationParams,
        response: { 200: itemsOf(attendanceHistorySchema) },
      },
    },
    async (req) =>
      attendanceHistory(
        db,
        await access(req, 'attendance:write'),
        req.params.id,
        req.params.registrationId,
      ),
  );
  app.put(
    `${p}/events/:id/attendance/:registrationId`,
    {
      schema: {
        tags,
        params: registrationParams,
        body: attendancePutSchema,
        response: { 200: attendanceResultSchema },
      },
    },
    async (req) => {
      const a = await access(req, 'attendance:write');
      return attendanceOperation(db, a, {
        ...req.body,
        organizationId: a.organizationId,
        eventOccurrenceId: req.params.id,
        registrationId: req.params.registrationId,
      });
    },
  );
  app.post(
    `${p}/attendance/sync`,
    {
      schema: {
        tags,
        body: attendanceSyncSchema,
        response: { 200: z.object({ results: z.array(attendanceResultSchema) }) },
      },
    },
    async (req) => syncAttendance(db, await access(req, 'attendance:write'), req.body.operations),
  );
  app.get(
    `${p}/events/:id/attendance/export`,
    {
      schema: {
        tags,
        params: idParams,
        querystring: eventExportQuerySchema,
        response: { 200: z.string().meta({ format: 'binary' }) },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'attendance:write'),
        format = req.query.format,
        data = await attendanceExport(db, a, req.params.id, format, req.query.language);
      reply
        .header(
          'Content-Disposition',
          `attachment; filename="bnature-attendance-${req.params.id}.${format}"`,
        )
        .type(format === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8');
      return sendBinary(reply, data);
    },
  );
}
