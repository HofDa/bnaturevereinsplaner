import { createHash } from 'node:crypto';
import { and, eq, sql, desc, count, ilike, or, isNull, type SQL } from 'drizzle-orm';
import { schema as s, type Database, type Executor, type Transaction } from '@bnature/db';
import {
  can,
  documentResponseSchema,
  documentDetailSchema,
  documentVersionResponseSchema,
  type DocumentInput,
  type DocumentPatch,
  type DocumentListQuery,
  type DocumentMediaType,
  type DocumentRecord,
  type Page,
  type Role,
} from '@bnature/contracts';
import { HttpError, type Access } from '../middleware/access';
import { audit } from '../services/audit';
import type { DocumentStorage } from '../services/storage';
import { wire } from './responses';
import { escapeLike } from './members';
import { financialOperation } from './finance/operations';

const d = s.documents,
  v = s.documentVersions;
const readOnly = { isolationLevel: 'repeatable read', accessMode: 'read only' } as const;
export type UploadedFile = { bytes: Buffer; mediaType: DocumentMediaType; sha256: string };
export function fingerprint(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}
// Receipts linked to cashbook entries are financial records: hidden from roles without finance access.
const financeVisible = (role: Role) =>
  can(role, 'finance:read') ? undefined : isNull(d.cashbookEntryId);
// Single-table selects render columns unqualified, so correlated subqueries name the table explicitly.
const latest = sql<
  string | null
>`(select dv.id from document_versions dv where dv.organization_id="documents"."organization_id" and dv.document_id="documents"."id" order by dv.version_number desc limit 1)`;
const versionCount = sql<number>`(select count(*)::int from document_versions dv where dv.organization_id="documents"."organization_id" and dv.document_id="documents"."id")`;
const documentSelect = {
  id: d.id,
  title: d.title,
  category: d.category,
  description: d.description,
  archived: d.archived,
  cashbookEntryId: d.cashbookEntryId,
  cashbookEntryLabel: sql<
    string | null
  >`(select ce.fiscal_year || '/' || ce.entry_number from cashbook_entries ce where ce.organization_id="documents"."organization_id" and ce.id="documents"."cashbook_entry_id")`,
  membershipId: d.membershipId,
  memberName: sql<
    string | null
  >`(select p.first_name || ' ' || p.last_name from memberships m join persons p on p.organization_id=m.organization_id and p.id=m.person_id where m.organization_id="documents"."organization_id" and m.id="documents"."membership_id")`,
  version: d.version,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
  latestVersionId: latest,
  versionCount,
};
async function versionsOf(db: Executor, org: string, documentId: string) {
  const rows = await db
    .select()
    .from(v)
    .where(and(eq(v.organizationId, org), eq(v.documentId, documentId)))
    .orderBy(desc(v.versionNumber));
  return rows.map((row) => documentVersionResponseSchema.parse(wire(row)));
}
async function present(
  db: Executor,
  org: string,
  row: { latestVersionId: string | null } & Record<string, unknown>,
): Promise<DocumentRecord> {
  const { latestVersionId, ...rest } = row;
  const [version] = latestVersionId
    ? await db
        .select()
        .from(v)
        .where(and(eq(v.organizationId, org), eq(v.id, latestVersionId)))
    : [];
  return documentResponseSchema.parse({
    ...wire(rest),
    latestVersion: version ? wire(version) : null,
  });
}
export async function getDocument(db: Executor, org: string, role: Role, id: string) {
  const [row] = await db
    .select(documentSelect)
    .from(d)
    .where(and(eq(d.organizationId, org), eq(d.id, id), financeVisible(role)));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Dokument nicht gefunden.');
  return documentDetailSchema.parse({
    ...(await present(db, org, row)),
    versions: await versionsOf(db, org, id),
  });
}
export async function listDocuments(
  db: Database,
  org: string,
  role: Role,
  q: DocumentListQuery,
): Promise<Page<DocumentRecord>> {
  const where: SQL | undefined = and(
    eq(d.organizationId, org),
    eq(d.archived, q.archived === 'true'),
    financeVisible(role),
    q.category ? eq(d.category, q.category) : undefined,
    q.cashbookEntryId ? eq(d.cashbookEntryId, q.cashbookEntryId) : undefined,
    q.membershipId ? eq(d.membershipId, q.membershipId) : undefined,
    q.search
      ? or(
          ilike(d.title, `%${escapeLike(q.search)}%`),
          ilike(d.description, `%${escapeLike(q.search)}%`),
        )
      : undefined,
  );
  return db.transaction(async (tx) => {
    const rows = await tx
      .select(documentSelect)
      .from(d)
      .where(where)
      .orderBy(desc(d.updatedAt), desc(d.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const [total] = await tx.select({ n: count() }).from(d).where(where);
    const items: DocumentRecord[] = [];
    for (const row of rows) items.push(await present(tx, org, row));
    return { items, total: total?.n ?? 0, page: q.page, pageSize: q.pageSize };
  }, readOnly);
}
// Roles are re-read inside the locked transaction, like every financial write.
async function currentRole(tx: Transaction, access: Access) {
  const [row] = await tx
    .select({ role: s.organizationUserRoles.role })
    .from(s.organizationUserRoles)
    .where(
      and(
        eq(s.organizationUserRoles.organizationId, access.organizationId),
        eq(s.organizationUserRoles.userId, access.userId),
      ),
    );
  if (!row) throw new HttpError(403, 'FORBIDDEN', 'Keine Berechtigung für diese Aktion.');
  return row.role;
}
async function assertReferences(
  tx: Transaction,
  access: Access,
  role: Role,
  refs: { cashbookEntryId?: string | null; membershipId?: string | null },
) {
  if (refs.cashbookEntryId) {
    if (!can(role, 'finance:write'))
      throw new HttpError(403, 'FORBIDDEN', 'Belege zu Buchungen erfordern Finanzrechte.');
    const [entry] = await tx
      .select({ id: s.cashbookEntries.id })
      .from(s.cashbookEntries)
      .where(
        and(
          eq(s.cashbookEntries.organizationId, access.organizationId),
          eq(s.cashbookEntries.id, refs.cashbookEntryId),
        ),
      );
    if (!entry) throw new HttpError(404, 'NOT_FOUND', 'Buchung nicht gefunden.');
  }
  if (refs.membershipId) {
    const [member] = await tx
      .select({ id: s.memberships.id })
      .from(s.memberships)
      .where(
        and(
          eq(s.memberships.organizationId, access.organizationId),
          eq(s.memberships.id, refs.membershipId),
        ),
      );
    if (!member) throw new HttpError(404, 'NOT_FOUND', 'Mitglied nicht gefunden.');
  }
}
const versionFields = ['filename', 'mediaType', 'sizeBytes', 'sha256'];
async function insertVersion(
  tx: Transaction,
  access: Access,
  documentId: string,
  versionNumber: number,
  filename: string,
  file: UploadedFile,
  storageKey: string,
) {
  const [row] = await tx
    .insert(v)
    .values({
      organizationId: access.organizationId,
      documentId,
      versionNumber,
      filename,
      mediaType: file.mediaType,
      sizeBytes: file.bytes.length,
      sha256: file.sha256,
      storageKey,
      createdBy: access.userId,
    })
    .returning({ id: v.id });
  await audit(tx, access, 'upload', 'document_version', row!.id, versionFields);
}
// The file is written before the transaction; a failed or replayed request removes it again.
async function withStoredFile<T>(
  storage: DocumentStorage,
  access: Access,
  file: UploadedFile,
  run: (storageKey: string) => Promise<{ data: T; replayed: boolean }>,
) {
  const storageKey = crypto.randomUUID();
  await storage.write(access.organizationId, storageKey, file.bytes);
  try {
    const result = await run(storageKey);
    if (result.replayed) await storage.remove(access.organizationId, storageKey);
    return result;
  } catch (error) {
    await storage.remove(access.organizationId, storageKey);
    throw error;
  }
}
export function createDocument(
  db: Database,
  storage: DocumentStorage,
  access: Access,
  key: string,
  input: DocumentInput,
  file: UploadedFile,
) {
  return withStoredFile(storage, access, file, (storageKey) =>
    financialOperation(
      db,
      access,
      key,
      'documents:create',
      { ...input, sha256: file.sha256, mediaType: file.mediaType },
      'documents:write',
      async (tx) => {
        const role = await currentRole(tx, access);
        await assertReferences(tx, access, role, input);
        const { filename, ...metadata } = input;
        const [row] = await tx
          .insert(d)
          .values({ ...metadata, organizationId: access.organizationId, createdBy: access.userId })
          .returning({ id: d.id });
        await audit(tx, access, 'create', 'document', row!.id, Object.keys(metadata));
        await insertVersion(tx, access, row!.id, 1, filename, file, storageKey);
        return getDocument(tx, access.organizationId, role, row!.id);
      },
    ),
  );
}
export function addDocumentVersion(
  db: Database,
  storage: DocumentStorage,
  access: Access,
  key: string,
  documentId: string,
  filename: string,
  file: UploadedFile,
) {
  return withStoredFile(storage, access, file, (storageKey) =>
    financialOperation(
      db,
      access,
      key,
      `documents:version:${documentId}`,
      { filename, sha256: file.sha256, mediaType: file.mediaType },
      'documents:write',
      async (tx) => {
        const role = await currentRole(tx, access),
          current = await getDocument(tx, access.organizationId, role, documentId);
        if (current.archived)
          throw new HttpError(
            409,
            'DOCUMENT_ARCHIVED',
            'Archivierte Dokumente sind schreibgeschützt.',
          );
        if (current.cashbookEntryId && !can(role, 'finance:write'))
          throw new HttpError(403, 'FORBIDDEN', 'Belege zu Buchungen erfordern Finanzrechte.');
        await insertVersion(
          tx,
          access,
          documentId,
          (current.versions[0]?.versionNumber ?? 0) + 1,
          filename,
          file,
          storageKey,
        );
        // Bumps the document version so concurrent metadata edits notice the change.
        await tx
          .update(d)
          .set({ version: current.version + 1, updatedAt: new Date() })
          .where(and(eq(d.organizationId, access.organizationId), eq(d.id, documentId)));
        return getDocument(tx, access.organizationId, role, documentId);
      },
    ),
  );
}
export function updateDocument(
  db: Database,
  access: Access,
  key: string,
  id: string,
  input: DocumentPatch,
) {
  return financialOperation(
    db,
    access,
    key,
    `documents:update:${id}`,
    input,
    'documents:write',
    async (tx) => {
      const role = await currentRole(tx, access),
        current = await getDocument(tx, access.organizationId, role, id);
      if (current.version !== input.version)
        throw new HttpError(409, 'STALE_VERSION', 'Das Dokument wurde zwischenzeitlich geändert.');
      const { version, ...patch } = input;
      if (current.archived && patch.archived !== false)
        throw new HttpError(
          409,
          'DOCUMENT_ARCHIVED',
          'Archivierte Dokumente sind schreibgeschützt.',
        );
      const touchesFinance =
        current.cashbookEntryId !== null ||
        (patch.cashbookEntryId !== undefined && patch.cashbookEntryId !== null);
      if (touchesFinance && !can(role, 'finance:write'))
        throw new HttpError(403, 'FORBIDDEN', 'Belege zu Buchungen erfordern Finanzrechte.');
      await assertReferences(tx, access, role, patch);
      await tx
        .update(d)
        .set({ ...patch, version: version + 1, updatedAt: new Date() })
        .where(and(eq(d.organizationId, access.organizationId), eq(d.id, id)));
      await audit(tx, access, 'update', 'document', id, Object.keys(patch));
      return getDocument(tx, access.organizationId, role, id);
    },
  );
}
export async function readDocumentVersion(
  db: Database,
  storage: DocumentStorage,
  org: string,
  role: Role,
  documentId: string,
  versionId: string,
) {
  const [row] = await db
    .select({
      storageKey: v.storageKey,
      filename: v.filename,
      mediaType: v.mediaType,
      sha256: v.sha256,
    })
    .from(v)
    .innerJoin(d, and(eq(d.organizationId, v.organizationId), eq(d.id, v.documentId)))
    .where(
      and(
        eq(v.organizationId, org),
        eq(v.documentId, documentId),
        eq(v.id, versionId),
        financeVisible(role),
      ),
    );
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Dokument nicht gefunden.');
  const bytes = await storage.read(org, row.storageKey).catch(() => {
    throw new HttpError(500, 'DOCUMENT_STORAGE_ERROR', 'Die Datei ist nicht verfügbar.');
  });
  // Integrity check against the hash recorded at upload time.
  if (fingerprint(bytes) !== row.sha256)
    throw new HttpError(500, 'DOCUMENT_STORAGE_ERROR', 'Die Datei ist nicht verfügbar.');
  return { ...row, bytes };
}
