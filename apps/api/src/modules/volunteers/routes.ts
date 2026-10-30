import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, eq, ilike, or, sql, asc } from 'drizzle-orm';
import { schema as s } from '@bnature/db';
import {
  MAX_DOCUMENT_BYTES,
  idParams,
  idSchema,
  itemsOf,
  financeWriteHeaders,
  financePageSchema,
  documentMediaTypeSchema,
  documentUploadHeaders,
  decodeDocumentMetadata,
  volunteerQuerySchema,
  volunteerSummarySchema,
  volunteerDetailSchema,
  engagementInputSchema,
  engagementPatchSchema,
  engagementEndSchema,
  assignmentSchema,
  assignmentInputSchema,
  assignmentPatchSchema,
  assignmentQuerySchema,
  timeEntrySchema,
  timeEntryInputSchema,
  timeEntryCorrectionSchema,
  timeEntryDecisionSchema,
  timeEntryQuerySchema,
  timeExportQuerySchema,
  timeTotalsSchema,
  policySchema,
  policyInputSchema,
  policyPatchSchema,
  coverageSchema,
  coverageInputSchema,
  coverageEndSchema,
  coverageOverviewSchema,
  notificationSchema,
  notificationInputSchema,
  notificationListQuerySchema,
  registerSectionSchema,
  registerViewSchema,
  registerEntrySchema,
  registerEntryInputSchema,
  registerSettingsResponseSchema,
  registerSettingsPatchSchema,
  snapshotSchema,
  snapshotInputSchema,
  snapshotValidationSchema,
  signatureImportMetadataSchema,
  signatureVerificationSchema,
  ruleSchema,
  ruleInputSchema,
  deadlineSchema,
  deadlineInputSchema,
  deadlinePatchSchema,
  deadlineCompleteSchema,
  deadlineQuerySchema,
  evidenceInputSchema,
  generateDeadlinesSchema,
} from '@bnature/contracts';
import { HttpError } from '../../middleware/access';
import { documentStorage } from '../../services/storage';
import { escapeLike } from '../members';
import type { ModuleContext } from '../context';
import {
  listVolunteers,
  getVolunteer,
  createEngagement,
  updateEngagement,
  endEngagement,
  volunteerOverview,
} from './engagements';
import {
  listAssignments,
  createAssignment,
  updateAssignment,
  listTimeEntries,
  getTimeEntry,
  createTimeEntry,
  correctTimeEntry,
  decideTimeEntry,
  draftFromAttendance,
  exportTimeEntries,
} from './work';
import {
  listPolicies,
  getPolicy,
  createPolicy,
  updatePolicy,
  listCoverages,
  addCoverages,
  endCoverage,
  notificationList,
  notificationListFile,
  listNotifications,
  recordNotification,
  coverageOverview,
} from './insurance';
import {
  getSettings,
  updateSettings,
  registerView,
  verifyChain,
  createRegisterEntry,
  validateSnapshot,
  listSnapshots,
  createSnapshot,
  verifySnapshotIntegrity,
  snapshotFile,
  importSignatureFile,
  recordVerification,
} from './register';
import {
  listRules,
  createRuleVersion,
  setRuleActive,
  initializeRules,
  listDeadlines,
  createDeadline,
  updateDeadline,
  addEvidence,
  completeDeadline,
  generateDeadlines,
} from './compliance';
import { requirePermission } from './common';

const replay = (reply: FastifyReply, r: { data: unknown; replayed: boolean }, status = 200) =>
  reply.code(status).header('Idempotency-Replayed', String(r.replayed)).send(r.data);
const key = (req: FastifyRequest) => String(req.headers['idempotency-key']);
const binary = z.string().meta({ format: 'binary' });
function disposition(filename: string) {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
const overviewSchema = z.object({
  activeRegular: z.number().int(),
  activeOccasional: z.number().int(),
  plannedAssignments: z.number().int(),
  confirmedMinutesThisYear: z.number().int(),
  pendingMinutesThisYear: z.number().int(),
  unclearCoverage: z.number().int().nullable(),
  expiringPolicies: z.number().int().nullable(),
  lastSnapshot: z
    .object({ snapshotNumber: z.number().int(), cutoffDate: z.string(), status: z.string() })
    .nullable(),
  snapshotDue: z.boolean(),
  openLegalDeadlines: z.number().int().nullable(),
});
export function registerVolunteerRoutes({ server, db, access, config }: ModuleContext) {
  const app = server.withTypeProvider<ZodTypeProvider>(),
    p = '/api/v1',
    storage = documentStorage(config.DOCUMENT_STORAGE_DIR);
  const tags = ['Volunteers'],
    insuranceTags = ['Insurance'],
    registerTags = ['Volunteer register'],
    complianceTags = ['Compliance'];
  const write = { headers: financeWriteHeaders };

  app.get(
    `${p}/volunteers/overview`,
    { schema: { tags, response: { 200: overviewSchema } } },
    async (req) => volunteerOverview(db, await access(req, 'volunteers:read')),
  );
  app.get(
    `${p}/volunteers`,
    {
      schema: {
        tags,
        querystring: volunteerQuerySchema,
        response: { 200: financePageSchema(volunteerSummarySchema) },
      },
    },
    async (req) => listVolunteers(db, await access(req, 'volunteers:read'), req.query),
  );
  app.get(
    `${p}/volunteer-people`,
    {
      schema: {
        tags,
        description: 'Existing persons (members or not) that can be registered as volunteers.',
        querystring: z.object({ search: z.string().trim().max(100).default('') }),
        response: {
          200: itemsOf(
            z.object({
              id: idSchema,
              name: z.string(),
              isMember: z.boolean(),
              hasOpenEngagement: z.boolean(),
            }),
          ),
        },
      },
    },
    async (req) => {
      const a = await access(req, 'volunteers:write'),
        term = `%${escapeLike(req.query.search)}%`;
      const items = await db
        .select({
          id: s.persons.id,
          name: sql<string>`${s.persons.firstName}||' '||${s.persons.lastName}`,
          // Single-table selects render columns unqualified; correlated subqueries name the table.
          isMember: sql<boolean>`exists(select 1 from memberships m where m.organization_id="persons"."organization_id" and m.person_id="persons"."id" and m.status in ('active','pending'))`,
          hasOpenEngagement: sql<boolean>`exists(select 1 from volunteer_engagements v where v.organization_id="persons"."organization_id" and v.person_id="persons"."id" and v.ended_on is null)`,
        })
        .from(s.persons)
        .where(
          and(
            eq(s.persons.organizationId, a.organizationId),
            req.query.search
              ? or(ilike(s.persons.lastName, term), ilike(s.persons.firstName, term))
              : undefined,
          ),
        )
        .orderBy(asc(s.persons.lastName), asc(s.persons.firstName))
        .limit(50);
      return { items };
    },
  );
  app.get(
    `${p}/volunteers/:id`,
    { schema: { tags, params: idParams, response: { 200: volunteerDetailSchema } } },
    async (req) => getVolunteer(db, await access(req, 'volunteers:read'), req.params.id),
  );
  app.post(
    `${p}/volunteers`,
    {
      schema: {
        tags,
        ...write,
        body: engagementInputSchema,
        response: { 201: volunteerDetailSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await createEngagement(db, await access(req, 'volunteers:write'), key(req), req.body),
        201,
      ),
  );
  app.patch(
    `${p}/volunteers/:id`,
    {
      schema: {
        tags,
        ...write,
        params: idParams,
        body: engagementPatchSchema,
        response: { 200: volunteerDetailSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await updateEngagement(
          db,
          await access(req, 'volunteers:write'),
          key(req),
          req.params.id,
          req.body,
        ),
      ),
  );
  app.post(
    `${p}/volunteers/:id/end`,
    {
      schema: {
        tags,
        ...write,
        params: idParams,
        body: engagementEndSchema,
        response: { 200: volunteerDetailSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await endEngagement(
          db,
          await access(req, 'volunteers:write'),
          key(req),
          req.params.id,
          req.body,
        ),
      ),
  );

  app.get(
    `${p}/volunteer-assignments`,
    {
      schema: {
        tags,
        querystring: assignmentQuerySchema,
        response: { 200: financePageSchema(assignmentSchema) },
      },
    },
    async (req) => listAssignments(db, await access(req, 'volunteers:read'), req.query),
  );
  app.post(
    `${p}/volunteer-assignments`,
    {
      schema: { tags, ...write, body: assignmentInputSchema, response: { 201: assignmentSchema } },
    },
    async (req, reply) =>
      replay(
        reply,
        await createAssignment(db, await access(req, 'volunteers:assign'), key(req), req.body),
        201,
      ),
  );
  app.patch(
    `${p}/volunteer-assignments/:id`,
    {
      schema: {
        tags,
        ...write,
        params: idParams,
        body: assignmentPatchSchema,
        response: { 200: assignmentSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await updateAssignment(
          db,
          await access(req, 'volunteers:assign'),
          key(req),
          req.params.id,
          req.body,
        ),
      ),
  );
  app.post(
    `${p}/volunteer-assignments/:id/attendance-draft`,
    {
      schema: {
        tags,
        description:
          'Creates an unconfirmed time draft from recorded attendance. Drafts never count as hours.',
        ...write,
        params: idParams,
        body: z.object({}).strict(),
        response: { 201: timeEntrySchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await draftFromAttendance(
          db,
          await access(req, 'volunteers:assign'),
          key(req),
          req.params.id,
        ),
        201,
      ),
  );
  app.get(
    `${p}/volunteer-time-entries`,
    {
      schema: {
        tags,
        querystring: timeEntryQuerySchema,
        response: { 200: financePageSchema(timeEntrySchema).extend({ totals: timeTotalsSchema }) },
      },
    },
    async (req) => listTimeEntries(db, await access(req, 'volunteers:read'), req.query),
  );
  app.get(
    `${p}/volunteer-time-entries/export`,
    {
      schema: {
        tags,
        querystring: timeExportQuerySchema,
        produces: ['text/csv', 'application/pdf'],
        response: { 200: binary },
      },
    },
    async (req, reply) => {
      const data = await exportTimeEntries(db, await access(req, 'volunteers:read'), req.query);
      return (reply as FastifyReply)
        .type(req.query.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf')
        .header('Content-Disposition', disposition(`volunteer-hours.${req.query.format}`))
        .send(data);
    },
  );
  app.get(
    `${p}/volunteer-time-entries/:id`,
    { schema: { tags, params: idParams, response: { 200: timeEntrySchema } } },
    async (req) => getTimeEntry(db, await access(req, 'volunteers:read'), req.params.id),
  );
  app.post(
    `${p}/volunteer-time-entries`,
    { schema: { tags, ...write, body: timeEntryInputSchema, response: { 201: timeEntrySchema } } },
    async (req, reply) =>
      replay(
        reply,
        await createTimeEntry(db, await access(req, 'volunteers:assign'), key(req), req.body),
        201,
      ),
  );
  app.post(
    `${p}/volunteer-time-entries/:id/correction`,
    {
      schema: {
        tags,
        ...write,
        params: idParams,
        body: timeEntryCorrectionSchema,
        response: { 200: timeEntrySchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await correctTimeEntry(
          db,
          await access(req, 'volunteers:assign'),
          key(req),
          req.params.id,
          req.body,
        ),
      ),
  );
  app.post(
    `${p}/volunteer-time-entries/:id/decision`,
    {
      schema: {
        tags,
        ...write,
        params: idParams,
        body: timeEntryDecisionSchema,
        response: { 200: timeEntrySchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await decideTimeEntry(
          db,
          await access(
            req,
            req.body.decision === 'submit' ? 'volunteers:assign' : 'volunteer_hours:confirm',
          ),
          key(req),
          req.params.id,
          req.body,
        ),
      ),
  );

  app.get(
    `${p}/insurance-policies`,
    { schema: { tags: insuranceTags, response: { 200: itemsOf(policySchema) } } },
    async (req) => listPolicies(db, await access(req, 'insurance:read')),
  );
  app.get(
    `${p}/insurance-policies/:id`,
    { schema: { tags: insuranceTags, params: idParams, response: { 200: policySchema } } },
    async (req) => getPolicy(db, await access(req, 'insurance:read'), req.params.id),
  );
  app.post(
    `${p}/insurance-policies`,
    {
      schema: {
        tags: insuranceTags,
        ...write,
        body: policyInputSchema,
        response: { 201: policySchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await createPolicy(db, await access(req, 'insurance:write'), key(req), req.body),
        201,
      ),
  );
  app.patch(
    `${p}/insurance-policies/:id`,
    {
      schema: {
        tags: insuranceTags,
        ...write,
        params: idParams,
        body: policyPatchSchema,
        response: { 200: policySchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await updatePolicy(
          db,
          await access(req, 'insurance:write'),
          key(req),
          req.params.id,
          req.body,
        ),
      ),
  );
  app.get(
    `${p}/insurance-policies/:id/coverages`,
    {
      schema: { tags: insuranceTags, params: idParams, response: { 200: itemsOf(coverageSchema) } },
    },
    async (req) => listCoverages(db, await access(req, 'insurance:read'), req.params.id),
  );
  app.post(
    `${p}/insurance-policies/:id/coverages`,
    {
      schema: {
        tags: insuranceTags,
        ...write,
        params: idParams,
        body: coverageInputSchema,
        response: { 201: z.object({ id: idSchema, count: z.number().int() }) },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await addCoverages(
          db,
          await access(req, 'insurance:write'),
          key(req),
          req.params.id,
          req.body,
        ),
        201,
      ),
  );
  app.post(
    `${p}/insurance-coverages/:id/end`,
    {
      schema: {
        tags: insuranceTags,
        ...write,
        params: idParams,
        body: coverageEndSchema,
        response: { 200: z.object({ id: idSchema }) },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await endCoverage(
          db,
          await access(req, 'insurance:write'),
          key(req),
          req.params.id,
          req.body,
        ),
      ),
  );
  app.get(
    `${p}/insurance-coverage`,
    {
      schema: {
        tags: insuranceTags,
        description:
          'Indicative assignment check per volunteer. Never a legal confirmation of insurance cover.',
        querystring: z.object({ date: z.iso.date().optional() }),
        response: { 200: coverageOverviewSchema },
      },
    },
    async (req) => coverageOverview(db, await access(req, 'insurance:read'), req.query.date),
  );
  app.get(
    `${p}/insurance-policies/:id/notification-list`,
    {
      schema: {
        tags: insuranceTags,
        params: idParams,
        querystring: notificationListQuerySchema,
        produces: ['application/json', 'text/csv', 'application/pdf'],
      },
    },
    async (req, reply) => {
      const a = await access(req, 'insurance:write');
      requirePermission(a, 'evidence:download');
      if (req.query.format === 'json') return notificationList(db, a, req.params.id, req.query.on);
      const data = await notificationListFile(
        db,
        a,
        req.params.id,
        req.query.format,
        req.query.language,
        req.query.on,
      );
      return (reply as FastifyReply)
        .type(req.query.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf')
        .header('Content-Disposition', disposition(`insurer-list.${req.query.format}`))
        .send(data);
    },
  );
  app.get(
    `${p}/insurance-policies/:id/notifications`,
    {
      schema: {
        tags: insuranceTags,
        params: idParams,
        response: { 200: itemsOf(notificationSchema) },
      },
    },
    async (req) => listNotifications(db, await access(req, 'insurance:read'), req.params.id),
  );
  app.post(
    `${p}/insurer-notifications`,
    {
      schema: {
        tags: insuranceTags,
        ...write,
        body: notificationInputSchema,
        response: { 201: z.object({ id: idSchema }) },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await recordNotification(db, await access(req, 'insurance:write'), key(req), req.body),
        201,
      ),
  );

  app.get(
    `${p}/volunteer-register/settings`,
    { schema: { tags: registerTags, response: { 200: registerSettingsResponseSchema } } },
    async (req) => getSettings(db, await access(req, 'register:read')),
  );
  app.patch(
    `${p}/volunteer-register/settings`,
    {
      schema: {
        tags: registerTags,
        ...write,
        body: registerSettingsPatchSchema,
        response: { 200: registerSettingsResponseSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await updateSettings(db, await access(req, 'register:finalize'), key(req), req.body),
      ),
  );
  app.get(
    `${p}/volunteer-register`,
    {
      schema: {
        tags: registerTags,
        querystring: z.object({ section: registerSectionSchema.default('main') }),
        response: { 200: registerViewSchema },
      },
    },
    async (req) => registerView(db, await access(req, 'register:read'), req.query.section),
  );
  app.get(
    `${p}/volunteer-register/verify`,
    {
      schema: {
        tags: registerTags,
        description: 'Recomputes the hash chain of both register sections.',
        response: {
          200: z.record(
            z.string(),
            z.object({
              entries: z.number().int(),
              valid: z.boolean(),
              brokenAt: z.number().int().nullable(),
            }),
          ),
        },
      },
    },
    async (req) => verifyChain(db, await access(req, 'register:read')),
  );
  app.post(
    `${p}/volunteer-register/entries`,
    {
      schema: {
        tags: registerTags,
        ...write,
        body: registerEntryInputSchema,
        response: { 201: registerEntrySchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await createRegisterEntry(db, await access(req, 'register:write'), key(req), req.body),
        201,
      ),
  );
  app.get(
    `${p}/register-snapshots`,
    {
      schema: {
        tags: registerTags,
        response: {
          200: itemsOf(snapshotSchema).extend({
            provider: z.object({ id: z.string(), qualified: z.boolean() }),
          }),
        },
      },
    },
    async (req) => listSnapshots(db, await access(req, 'register:read')),
  );
  app.get(
    `${p}/register-snapshots/validation`,
    {
      schema: {
        tags: registerTags,
        querystring: snapshotInputSchema,
        response: { 200: snapshotValidationSchema },
      },
    },
    async (req) => validateSnapshot(db, await access(req, 'register:read'), req.query.cutoffDate),
  );
  app.post(
    `${p}/register-snapshots`,
    {
      schema: {
        tags: registerTags,
        description:
          'Finalizes an immutable register state with SHA-256 checksum. Status starts as signature pending.',
        ...write,
        body: snapshotInputSchema,
        response: { 201: snapshotSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await createSnapshot(
          db,
          storage,
          await access(req, 'register:finalize'),
          key(req),
          req.body.cutoffDate,
        ),
        201,
      ),
  );
  app.get(
    `${p}/register-snapshots/:id/integrity`,
    {
      schema: {
        tags: registerTags,
        params: idParams,
        response: {
          200: z.object({
            reproducible: z.boolean(),
            archivedFileIntact: z.boolean(),
            sha256: z.string(),
            recomputedSha256: z.string(),
          }),
        },
      },
    },
    async (req) => {
      const a = await access(req, 'register:read');
      requirePermission(a, 'evidence:download');
      return verifySnapshotIntegrity(db, storage, a, req.params.id);
    },
  );
  app.get(
    `${p}/register-snapshots/:id/files/:kind`,
    {
      schema: {
        tags: registerTags,
        params: idParams.extend({ kind: z.enum(['snapshot', 'signed', 'timestamp']) }),
        produces: documentMediaTypeSchema.options,
        response: { 200: binary },
      },
    },
    async (req, reply) => {
      const file = await snapshotFile(
        db,
        storage,
        await access(req, 'register:read'),
        req.params.id,
        req.params.kind,
      );
      return (reply as FastifyReply)
        .type(file.mediaType)
        .header('Content-Disposition', disposition(file.filename))
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .header('X-Content-Type-Options', 'nosniff')
        .send(file.bytes);
    },
  );
  app.post(
    `${p}/register-snapshots/:id/signature-files`,
    {
      bodyLimit: MAX_DOCUMENT_BYTES,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: registerTags,
        description:
          'Imports an externally signed file (PAdES PDF or CAdES .p7m) or an RFC 3161 timestamp into the private document store. Metadata: {"kind":"signed|timestamp","filename":"..."}.',
        consumes: documentMediaTypeSchema.options,
        params: idParams,
        headers: documentUploadHeaders,
        response: { 201: snapshotSchema },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'register:finalize');
      let meta: z.infer<typeof signatureImportMetadataSchema>;
      try {
        meta = signatureImportMetadataSchema.parse(
          decodeDocumentMetadata(String(req.headers['x-document-metadata'])),
        );
      } catch {
        throw new HttpError(422, 'VALIDATION_ERROR', 'Bitte prüfen Sie Ihre Eingaben.');
      }
      if (!Buffer.isBuffer(req.body) || !req.body.length)
        throw new HttpError(
          415,
          'FILE_TYPE_MISMATCH',
          'Der Dateityp passt nicht zur Signaturdatei.',
        );
      const declared = String(req.headers['content-type'] ?? '')
        .split(';')[0]!
        .trim()
        .toLowerCase();
      return replay(
        reply,
        await importSignatureFile(
          db,
          storage,
          a,
          key(req),
          req.params.id,
          meta,
          req.body,
          declared,
        ),
        201,
      );
    },
  );
  app.post(
    `${p}/register-snapshots/:id/verification`,
    {
      schema: {
        tags: registerTags,
        description:
          'Documents the result of an external signature/timestamp verification. Not a certification.',
        ...write,
        params: idParams,
        body: signatureVerificationSchema,
        response: { 200: snapshotSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await recordVerification(
          db,
          await access(req, 'register:finalize'),
          key(req),
          req.params.id,
          req.body,
        ),
      ),
  );

  app.get(
    `${p}/compliance-rules`,
    { schema: { tags: complianceTags, response: { 200: itemsOf(ruleSchema) } } },
    async (req) => listRules(db, await access(req, 'compliance:read')),
  );
  app.post(
    `${p}/compliance-rules`,
    {
      schema: {
        tags: complianceTags,
        description:
          'Creates a rule or a new version of an existing rule key; the current version is closed.',
        ...write,
        body: ruleInputSchema,
        response: { 201: ruleSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await createRuleVersion(db, await access(req, 'compliance:write'), key(req), req.body),
        201,
      ),
  );
  app.post(
    `${p}/compliance-rules/initialize`,
    {
      schema: {
        tags: complianceTags,
        ...write,
        body: z.object({}).strict(),
        response: { 200: itemsOf(ruleSchema) },
      },
    },
    async (req, reply) =>
      replay(reply, await initializeRules(db, await access(req, 'compliance:write'), key(req))),
  );
  app.patch(
    `${p}/compliance-rules/:id`,
    {
      schema: {
        tags: complianceTags,
        ...write,
        params: idParams,
        body: z
          .object({ active: z.boolean(), reviewNote: z.string().trim().max(1000).default('') })
          .strict(),
        response: { 200: ruleSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await setRuleActive(
          db,
          await access(req, 'compliance:write'),
          key(req),
          req.params.id,
          req.body,
        ),
      ),
  );
  app.get(
    `${p}/compliance-deadlines`,
    {
      schema: {
        tags: complianceTags,
        querystring: deadlineQuerySchema,
        response: { 200: financePageSchema(deadlineSchema) },
      },
    },
    async (req) => listDeadlines(db, await access(req, 'compliance:read'), req.query),
  );
  app.post(
    `${p}/compliance-deadlines`,
    {
      schema: {
        tags: complianceTags,
        ...write,
        body: deadlineInputSchema,
        response: { 201: deadlineSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await createDeadline(db, await access(req, 'compliance:write'), key(req), req.body),
        201,
      ),
  );
  app.post(
    `${p}/compliance-deadlines/generate`,
    {
      schema: {
        tags: complianceTags,
        description:
          'Calculates deadlines from the active rule versions. Existing deadlines are kept.',
        ...write,
        body: generateDeadlinesSchema,
        response: { 200: z.object({ created: z.number().int(), existing: z.number().int() }) },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await generateDeadlines(db, await access(req, 'compliance:write'), key(req), req.body),
      ),
  );
  app.patch(
    `${p}/compliance-deadlines/:id`,
    {
      schema: {
        tags: complianceTags,
        ...write,
        params: idParams,
        body: deadlinePatchSchema,
        response: { 200: deadlineSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await updateDeadline(
          db,
          await access(req, 'compliance:write'),
          key(req),
          req.params.id,
          req.body,
        ),
      ),
  );
  app.post(
    `${p}/compliance-deadlines/:id/evidence`,
    {
      schema: {
        tags: complianceTags,
        ...write,
        params: idParams,
        body: evidenceInputSchema,
        response: { 201: deadlineSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await addEvidence(
          db,
          await access(req, 'compliance:write'),
          key(req),
          req.params.id,
          req.body,
        ),
        201,
      ),
  );
  app.post(
    `${p}/compliance-deadlines/:id/complete`,
    {
      schema: {
        tags: complianceTags,
        ...write,
        params: idParams,
        body: deadlineCompleteSchema,
        response: { 200: deadlineSchema },
      },
    },
    async (req, reply) =>
      replay(
        reply,
        await completeDeadline(
          db,
          await access(req, 'compliance:write'),
          key(req),
          req.params.id,
          req.body,
        ),
      ),
  );
}
