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
import { HttpError, currentAccess, type Access } from '../middleware/access';
import { audit } from '../services/audit';
import type { DocumentStorage } from '../services/storage';
import { wire } from './responses';
import { escapeLike } from './members';
import { eventRow } from './events';
import { financialOperation } from './finance/operations';

const d = s.documents,
  v = s.documentVersions;
const readOnly = { isolationLevel: 'repeatable read', accessMode: 'read only' } as const;
export type UploadedFile = { bytes: Buffer; mediaType: DocumentMediaType; sha256: string };
export function fingerprint(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}
// Receipts linked to cashbook entries are financial records: hidden from roles without finance access.
// Register, insurance, volunteer and compliance evidence follow their module permissions.
const financeVisible = (role: Role, userId = '') =>
  and(
    can(role, 'finance:read') ? undefined : and(isNull(d.cashbookEntryId), isNull(d.transferId)),
    can(role, 'register:read') ? undefined : sql`${d.category}<>'register'`,
    can(role, 'insurance:read')
      ? undefined
      : and(isNull(d.insurancePolicyId), isNull(d.insurerNotificationId)),
    can(role, 'volunteers:write') ? undefined : isNull(d.volunteerEngagementId),
    can(role, 'compliance:read') ? undefined : isNull(d.complianceDeadlineId),
    role === 'project_lead'
      ? sql`exists(select 1 from event_occurrences ev where ev.organization_id="documents"."organization_id" and ev.id="documents"."event_occurrence_id" and (ev.organizer_id=${userId || '00000000-0000-0000-0000-000000000000'} or ev.created_by=${userId || '00000000-0000-0000-0000-000000000000'}))`
      : ['admin', 'board'].includes(role)
        ? undefined
        : or(
            isNull(d.eventOccurrenceId),
            sql`exists(select 1 from event_occurrences ev where ev.organization_id="documents"."organization_id" and ev.id="documents"."event_occurrence_id" and ev.visibility<>'internal' and ev.status<>'draft')`,
          ),
  );
// Evidence files need the separate download permission in addition to visibility.
const evidenceDocument = (row: {
  category: string;
  volunteerEngagementId: string | null;
  insurancePolicyId: string | null;
  insurerNotificationId: string | null;
  complianceDeadlineId: string | null;
}) =>
  row.category === 'register' ||
  !!row.volunteerEngagementId ||
  !!row.insurancePolicyId ||
  !!row.insurerNotificationId ||
  !!row.complianceDeadlineId;
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
  transferId: d.transferId,
  groupId: d.groupId,
  eventOccurrenceId: d.eventOccurrenceId,
  volunteerEngagementId: d.volunteerEngagementId,
  insurancePolicyId: d.insurancePolicyId,
  insurerNotificationId: d.insurerNotificationId,
  complianceDeadlineId: d.complianceDeadlineId,
  eventTitleI18n: sql<{
    de: string;
    it: string;
  } | null>`(select ev.title_i18n from event_occurrences ev where ev.organization_id="documents"."organization_id" and ev.id="documents"."event_occurrence_id")`,
  groupName: sql<
    string | null
  >`(select g.name from groups g where g.organization_id="documents"."organization_id" and g.id="documents"."group_id")`,
  transferLabel: sql<
    string | null
  >`(select tr.booking_date || ' · ' || tr.description from ledger_transfers tr where tr.organization_id="documents"."organization_id" and tr.id="documents"."transfer_id")`,
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
    protected: evidenceDocument(rest as Parameters<typeof evidenceDocument>[0]),
    latestVersion: version ? wire(version) : null,
  });
}
export async function getDocument(db: Executor, org: string, role: Role, id: string, userId = '') {
  const [row] = await db
    .select(documentSelect)
    .from(d)
    .where(and(eq(d.organizationId, org), eq(d.id, id), financeVisible(role, userId)));
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
  userId = '',
): Promise<Page<DocumentRecord>> {
  const where: SQL | undefined = and(
    eq(d.organizationId, org),
    eq(d.archived, q.archived === 'true'),
    financeVisible(role, userId),
    q.category ? eq(d.category, q.category) : undefined,
    q.cashbookEntryId ? eq(d.cashbookEntryId, q.cashbookEntryId) : undefined,
    q.membershipId ? eq(d.membershipId, q.membershipId) : undefined,
    q.transferId ? eq(d.transferId, q.transferId) : undefined,
    q.groupId ? eq(d.groupId, q.groupId) : undefined,
    q.eventOccurrenceId ? eq(d.eventOccurrenceId, q.eventOccurrenceId) : undefined,
    q.volunteerEngagementId ? eq(d.volunteerEngagementId, q.volunteerEngagementId) : undefined,
    q.insurancePolicyId ? eq(d.insurancePolicyId, q.insurancePolicyId) : undefined,
    q.insurerNotificationId ? eq(d.insurerNotificationId, q.insurerNotificationId) : undefined,
    q.complianceDeadlineId ? eq(d.complianceDeadlineId, q.complianceDeadlineId) : undefined,
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
const currentRole = async (tx: Transaction, access: Access) =>
  (await currentAccess(tx, access, 'Keine Berechtigung für diese Aktion.')).role;
async function assertReferences(
  tx: Transaction,
  access: Access,
  role: Role,
  refs: {
    cashbookEntryId?: string | null;
    membershipId?: string | null;
    transferId?: string | null;
    groupId?: string | null;
    eventOccurrenceId?: string | null;
    volunteerEngagementId?: string | null;
    insurancePolicyId?: string | null;
    insurerNotificationId?: string | null;
    complianceDeadlineId?: string | null;
  },
) {
  const linked = async (
    permission: Parameters<typeof can>[1],
    table:
      | typeof s.volunteerEngagements
      | typeof s.insurancePolicies
      | typeof s.insurerNotifications
      | typeof s.complianceDeadlines,
    id: string,
  ) => {
    if (!can(role, permission)) throw new HttpError(403, 'FORBIDDEN', 'Keine Berechtigung.');
    const [row] = await tx
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.organizationId, access.organizationId), eq(table.id, id)));
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Bezug nicht gefunden.');
  };
  if (refs.volunteerEngagementId)
    await linked('volunteers:write', s.volunteerEngagements, refs.volunteerEngagementId);
  if (refs.insurancePolicyId)
    await linked('insurance:write', s.insurancePolicies, refs.insurancePolicyId);
  if (refs.insurerNotificationId)
    await linked('insurance:write', s.insurerNotifications, refs.insurerNotificationId);
  if (refs.complianceDeadlineId)
    await linked('compliance:write', s.complianceDeadlines, refs.complianceDeadlineId);
  if (refs.eventOccurrenceId) await eventRow(tx, { ...access, role }, refs.eventOccurrenceId, true);
  if (role === 'project_lead' && refs.eventOccurrenceId === null)
    throw new HttpError(403, 'FORBIDDEN', 'Veranstaltungsbezug erforderlich.');
  if (refs.transferId) {
    if (!can(role, 'finance:write'))
      throw new HttpError(403, 'FORBIDDEN', 'Finanzrechte erforderlich.');
    const [transfer] = await tx
      .select({ id: s.ledgerTransfers.id })
      .from(s.ledgerTransfers)
      .where(
        and(
          eq(s.ledgerTransfers.organizationId, access.organizationId),
          eq(s.ledgerTransfers.id, refs.transferId),
        ),
      );
    if (!transfer) throw new HttpError(404, 'NOT_FOUND', 'Übertrag nicht gefunden.');
  }
  if (refs.groupId) {
    const [group] = await tx
      .select({ id: s.groups.id })
      .from(s.groups)
      .where(
        and(eq(s.groups.organizationId, access.organizationId), eq(s.groups.id, refs.groupId)),
      );
    if (!group) throw new HttpError(404, 'NOT_FOUND', 'Gruppe nicht gefunden.');
  }
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
export async function withStoredFile<T>(
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
// Used by modules that create protected documents inside their own transaction.
export async function insertDocument(
  tx: Transaction,
  access: Access,
  metadata: Pick<DocumentInput, 'title' | 'category'> & Partial<Omit<DocumentInput, 'filename'>>,
  filename: string,
  file: UploadedFile,
  storageKey: string,
) {
  const [row] = await tx
    .insert(d)
    .values({ ...metadata, organizationId: access.organizationId, createdBy: access.userId })
    .returning({ id: d.id });
  await audit(tx, access, 'create', 'document', row!.id, Object.keys(metadata));
  await insertVersion(tx, access, row!.id, 1, filename, file, storageKey);
  return row!.id;
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
      {
        ...Object.fromEntries(
          Object.entries(input).filter(
            ([key, value]) =>
              ![
                'groupId',
                'transferId',
                'eventOccurrenceId',
                'volunteerEngagementId',
                'insurancePolicyId',
                'insurerNotificationId',
                'complianceDeadlineId',
              ].includes(key) || value !== null,
          ),
        ),
        sha256: file.sha256,
        mediaType: file.mediaType,
      },
      access.role === 'project_lead' ? 'events:write' : 'documents:write',
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
        return getDocument(tx, access.organizationId, role, row!.id, access.userId);
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
      access.role === 'project_lead' ? 'events:write' : 'documents:write',
      async (tx) => {
        const role = await currentRole(tx, access),
          current = await getDocument(tx, access.organizationId, role, documentId, access.userId);
        if (current.archived)
          throw new HttpError(
            409,
            'DOCUMENT_ARCHIVED',
            'Archivierte Dokumente sind schreibgeschützt.',
          );
        if ((current.cashbookEntryId || current.transferId) && !can(role, 'finance:write'))
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
        return getDocument(tx, access.organizationId, role, documentId, access.userId);
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
    access.role === 'project_lead' ? 'events:write' : 'documents:write',
    async (tx) => {
      const role = await currentRole(tx, access),
        current = await getDocument(tx, access.organizationId, role, id, access.userId);
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
        current.transferId !== null ||
        !!patch.transferId ||
        (patch.cashbookEntryId !== undefined && patch.cashbookEntryId !== null);
      if (touchesFinance && !can(role, 'finance:write'))
        throw new HttpError(403, 'FORBIDDEN', 'Belege zu Buchungen erfordern Finanzrechte.');
      await assertReferences(tx, access, role, patch);
      await tx
        .update(d)
        .set({ ...patch, version: version + 1, updatedAt: new Date() })
        .where(and(eq(d.organizationId, access.organizationId), eq(d.id, id)));
      await audit(tx, access, 'update', 'document', id, Object.keys(patch));
      return getDocument(tx, access.organizationId, role, id, access.userId);
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
  userId = '',
) {
  const [row] = await db
    .select({
      storageKey: v.storageKey,
      filename: v.filename,
      mediaType: v.mediaType,
      sha256: v.sha256,
      category: d.category,
      volunteerEngagementId: d.volunteerEngagementId,
      insurancePolicyId: d.insurancePolicyId,
      insurerNotificationId: d.insurerNotificationId,
      complianceDeadlineId: d.complianceDeadlineId,
    })
    .from(v)
    .innerJoin(d, and(eq(d.organizationId, v.organizationId), eq(d.id, v.documentId)))
    .where(
      and(
        eq(v.organizationId, org),
        eq(v.documentId, documentId),
        eq(v.id, versionId),
        financeVisible(role, userId),
      ),
    );
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Dokument nicht gefunden.');
  if (evidenceDocument(row) && !can(role, 'evidence:download'))
    throw new HttpError(403, 'FORBIDDEN', 'Nachweise dürfen mit Ihrer Rolle nicht geladen werden.');
  const bytes = await storage.read(org, row.storageKey).catch(() => {
    throw new HttpError(500, 'DOCUMENT_STORAGE_ERROR', 'Die Datei ist nicht verfügbar.');
  });
  // Integrity check against the hash recorded at upload time.
  if (fingerprint(bytes) !== row.sha256)
    throw new HttpError(500, 'DOCUMENT_STORAGE_ERROR', 'Die Datei ist nicht verfügbar.');
  return {
    storageKey: row.storageKey,
    filename: row.filename,
    mediaType: row.mediaType,
    sha256: row.sha256,
    bytes,
  };
}
