import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  MAX_DOCUMENT_BYTES,
  idParams,
  financeWriteHeaders,
  financePageSchema,
  documentMediaTypeSchema,
  documentInputSchema,
  documentVersionInputSchema,
  documentPatchSchema,
  documentResponseSchema,
  documentDetailSchema,
  documentListQuerySchema,
  documentUploadHeaders,
  documentVersionParams,
  decodeDocumentMetadata,
  detectMediaType,
} from '@bnature/contracts';
import { HttpError } from '../middleware/access';
import { documentStorage } from '../services/storage';
import type { ModuleContext } from './context';
import {
  listDocuments,
  getDocument,
  createDocument,
  addDocumentVersion,
  updateDocument,
  readDocumentVersion,
  fingerprint,
  type UploadedFile,
} from './documents';

const uploadTypes = documentMediaTypeSchema.options;
function metadata<T extends z.ZodType>(req: FastifyRequest, schema: T): z.infer<T> {
  let value: unknown;
  try {
    value = decodeDocumentMetadata(String(req.headers['x-document-metadata']));
  } catch {
    throw new HttpError(422, 'VALIDATION_ERROR', 'Bitte prüfen Sie Ihre Eingaben.');
  }
  return schema.parse(value);
}
function uploadedFile(req: FastifyRequest): UploadedFile {
  const bytes = req.body;
  if (!Buffer.isBuffer(bytes))
    throw new HttpError(
      415,
      'FILE_TYPE_MISMATCH',
      'Nur PDF-, PNG- und JPEG-Dateien mit passendem Inhalt sind erlaubt.',
    );
  if (bytes.length === 0) throw new HttpError(422, 'EMPTY_FILE', 'Die Datei ist leer.');
  const declared = String(req.headers['content-type'] ?? '')
      .split(';')[0]!
      .trim()
      .toLowerCase(),
    detected = detectMediaType(bytes);
  // The declared type must match the file signature; renamed or disguised files are rejected.
  if (!detected || detected !== declared)
    throw new HttpError(
      415,
      'FILE_TYPE_MISMATCH',
      'Nur PDF-, PNG- und JPEG-Dateien mit passendem Inhalt sind erlaubt.',
    );
  return { bytes, mediaType: detected, sha256: fingerprint(bytes) };
}
// RFC 6266/5987: ASCII fallback plus the exact UTF-8 name.
function disposition(filename: string) {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
const replayed = (reply: FastifyReply, value: boolean) =>
  reply.header('Idempotency-Replayed', String(value));
export function registerDocumentRoutes({ server, db, access, config }: ModuleContext) {
  const app = server.withTypeProvider<ZodTypeProvider>(),
    storage = documentStorage(config.DOCUMENT_STORAGE_DIR),
    p = '/api/v1/documents',
    tags = ['Documents'],
    upload = {
      bodyLimit: MAX_DOCUMENT_BYTES,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    };
  server.addContentTypeParser(
    uploadTypes,
    { parseAs: 'buffer', bodyLimit: MAX_DOCUMENT_BYTES },
    (_req, body, done) => done(null, body),
  );
  app.get(
    p,
    {
      schema: {
        tags,
        querystring: documentListQuerySchema,
        response: { 200: financePageSchema(documentResponseSchema) },
      },
    },
    async (req) => {
      const a = await access(req, 'documents:read');
      return listDocuments(db, a.organizationId, a.role, req.query);
    },
  );
  app.get(
    `${p}/:id`,
    { schema: { tags, params: idParams, response: { 200: documentDetailSchema } } },
    async (req) => {
      const a = await access(req, 'documents:read');
      return getDocument(db, a.organizationId, a.role, req.params.id);
    },
  );
  app.post(
    p,
    {
      ...upload,
      schema: {
        tags,
        description:
          'Raw file body (PDF, PNG or JPEG, max. 10 MiB). Metadata as base64url JSON in X-Document-Metadata.',
        consumes: uploadTypes,
        headers: documentUploadHeaders,
        response: { 201: documentDetailSchema },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'documents:write'),
        input = metadata(req, documentInputSchema),
        result = await createDocument(
          db,
          storage,
          a,
          req.headers['idempotency-key'],
          input,
          uploadedFile(req),
        );
      return replayed(reply.code(201), result.replayed).send(result.data);
    },
  );
  app.post(
    `${p}/:id/versions`,
    {
      ...upload,
      schema: {
        tags,
        description: 'Adds an immutable new file version. Metadata: {"filename": "..."}.',
        consumes: uploadTypes,
        params: idParams,
        headers: documentUploadHeaders,
        response: { 201: documentDetailSchema },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'documents:write'),
        input = metadata(req, documentVersionInputSchema),
        result = await addDocumentVersion(
          db,
          storage,
          a,
          req.headers['idempotency-key'],
          req.params.id,
          input.filename,
          uploadedFile(req),
        );
      return replayed(reply.code(201), result.replayed).send(result.data);
    },
  );
  app.patch(
    `${p}/:id`,
    {
      schema: {
        tags,
        params: idParams,
        headers: financeWriteHeaders,
        body: documentPatchSchema,
        response: { 200: documentDetailSchema },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'documents:write'),
        result = await updateDocument(
          db,
          a,
          req.headers['idempotency-key'],
          req.params.id,
          req.body,
        );
      return replayed(reply, result.replayed).send(result.data);
    },
  );
  app.get(
    `${p}/:id/versions/:versionId/content`,
    {
      schema: {
        tags,
        description: 'Authorized private download. The stored SHA-256 is verified before delivery.',
        params: documentVersionParams,
        produces: uploadTypes,
        response: { 200: z.string().meta({ format: 'binary' }) },
      },
    },
    async (req, reply) => {
      const a = await access(req, 'documents:read'),
        file = await readDocumentVersion(
          db,
          storage,
          a.organizationId,
          a.role,
          req.params.id,
          req.params.versionId,
        );
      return (reply as FastifyReply)
        .type(file.mediaType)
        .header('Content-Disposition', disposition(file.filename))
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .header('X-Content-Type-Options', 'nosniff')
        .send(file.bytes);
    },
  );
}
