import { useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Download, ArrowUpRight, Archive, ArchiveRestore, FileUp } from 'lucide-react';
import {
  MAX_DOCUMENT_BYTES,
  detectMediaType,
  encodeDocumentMetadata,
  documentCategorySchema,
  type DocumentRecord,
  type DocumentDetail,
  type DocumentVersion,
  type Member,
  type Page,
} from '@bnature/contracts';
import {
  Button,
  Empty,
  ErrorState,
  Field,
  FormActions,
  Loading,
  Modal,
  Notice,
  PageHeading,
  Pagination,
  SearchInput,
  formatDate,
  QueryView,
} from '../components/ui';
import { api, allPages, downloadPrivateFile, errorMessage, queryClient } from '../lib/api';
import { useSession } from '../app/session';
import { useDebounced } from '../hooks/use-debounced';

const categories = documentCategorySchema.options;
const categoryKey = (value: string) => `documentCategory_${value}`;
const refresh = () =>
  void queryClient.invalidateQueries({
    predicate: (query) => String(query.queryKey[0]).startsWith('documents'),
  });
function fileSize(bytes: number, language: string) {
  const format = new Intl.NumberFormat(language === 'it' ? 'it-IT' : 'de-IT', {
    maximumFractionDigits: 1,
  });
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1024 * 1024
    ? `${format.format(bytes / 1024)} KB`
    : `${format.format(bytes / 1024 / 1024)} MB`;
}
async function readFileType(file: File) {
  if (file.size === 0) throw new Error('documentFileEmpty');
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error('documentTooLarge');
  const type = detectMediaType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  if (!type) throw new Error('documentTypeInvalid');
  return type;
}
// Keeps the operation key for an unchanged retry, like financial writes.
function useUpload() {
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  return async <T,>(path: string, file: File, metadata: Record<string, unknown>) => {
    const mediaType = await readFileType(file),
      encoded = encodeDocumentMetadata(metadata),
      signature = `${path}:${file.name}:${file.size}:${file.lastModified}:${encoded}`;
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, key: crypto.randomUUID() };
    return api<T>(path, {
      method: 'POST',
      body: file,
      headers: {
        'Content-Type': mediaType,
        'X-Document-Metadata': encoded,
        'Idempotency-Key': attempt.current.key,
      },
    });
  };
}
function uploadError(error: unknown, t: (key: string) => string) {
  return error instanceof Error && error.message.startsWith('document')
    ? t(error.message)
    : errorMessage(error);
}
function useMembers() {
  const { me } = useSession();
  return useQuery({
    queryKey: ['documents-member-options', me.activeOrganizationId],
    queryFn: () => allPages<Member>('/members'),
    enabled: me.permissions.includes('members:read'),
  });
}
export function UploadForm({
  cashbookEntryId,
  transferId,
  eventOccurrenceId,
  basePath = '/documents',
  defaultTitle = '',
  onDone,
  onCancel,
}: {
  cashbookEntryId?: string;
  transferId?: string;
  eventOccurrenceId?: string;
  basePath?: string;
  defaultTitle?: string;
  onDone: (document: DocumentDetail) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation(),
    upload = useUpload(),
    members = useMembers();
  const { me } = useSession();
  const groups = useQuery({
    queryKey: ['documents-group-options', me.activeOrganizationId],
    queryFn: () => api<{ items: Array<{ id: string; name: string }> }>('/groups?pageSize=100'),
    enabled: me.permissions.includes('groups:read'),
  });
  const [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget),
      file = form.get('file');
    if (!(file instanceof File) || !file.name) {
      setError(t('documentChooseFile'));
      return;
    }
    setPending(true);
    try {
      onDone(
        await upload<DocumentDetail>(basePath, file, {
          title: form.get('title'),
          category: form.get('category'),
          description: form.get('description') ?? '',
          membershipId: form.get('membershipId') || null,
          cashbookEntryId: cashbookEntryId ?? null,
          transferId: transferId ?? null,
          eventOccurrenceId: eventOccurrenceId ?? null,
          groupId: form.get('groupId') || null,
          filename: file.name,
        }),
      );
    } catch (error) {
      setError(uploadError(error, t));
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)}>
      <p className="finance-form-help">{t('documentUploadHelp')}</p>
      <div className="form-grid">
        <Field label={`${t('documentFile')} *`} hint={t('documentFileHint')}>
          <input type="file" name="file" required accept="application/pdf,image/png,image/jpeg" />
        </Field>
        <Field label={`${t('documentTitle')} *`}>
          <input name="title" required maxLength={200} defaultValue={defaultTitle} />
        </Field>
        <Field label={t('documentCategory')}>
          <select
            name="category"
            defaultValue={cashbookEntryId || transferId ? 'receipt' : 'other'}
          >
            {categories.map((value) => (
              <option key={value} value={value}>
                {t(categoryKey(value))}
              </option>
            ))}
          </select>
        </Field>
        {members.data && (
          <Field label={t('documentMember')}>
            <select name="membershipId" defaultValue="">
              <option value="">{t('documentNoMember')}</option>
              {members.data.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.firstName} {m.lastName} · {m.membershipNumber}
                </option>
              ))}
            </select>
          </Field>
        )}
        {groups.data && (
          <Field label={t('groups')}>
            <select name="groupId">
              <option value="">—</option>
              {groups.data.items.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t('documentDescription')}>
          <textarea name="description" rows={3} maxLength={2000} />
        </Field>
      </div>
      {error && <Notice error>{error}</Notice>}
      <FormActions pending={pending} create onCancel={onCancel} />
    </form>
  );
}
function VersionList({
  document,
  basePath = '/documents',
}: {
  document: DocumentDetail;
  basePath?: string;
}) {
  const { t, i18n } = useTranslation(),
    [error, setError] = useState('');
  async function download(version: DocumentVersion) {
    setError('');
    try {
      await downloadPrivateFile(
        `${basePath}/${document.id}/versions/${version.id}/content`,
        version.filename,
      );
    } catch (error) {
      setError(errorMessage(error));
    }
  }
  return (
    <>
      {error && <Notice error>{error}</Notice>}
      <ul className="finance-allocation-history">
        {document.versions.map((version) => (
          <li key={version.id}>
            <span>
              <strong>v{version.versionNumber}</strong> {version.filename}
              <small className="finance-cell-note">
                {formatDate(version.createdAt, i18n.language)} ·{' '}
                {fileSize(version.sizeBytes, i18n.language)} · SHA-256 {version.sha256.slice(0, 12)}
                …
              </small>
            </span>
            <Button
              variant="ghost"
              aria-label={`${t('documentDownload')}: ${version.filename} v${version.versionNumber}`}
              onClick={() => void download(version)}
            >
              <Download size={17} />
            </Button>
          </li>
        ))}
      </ul>
    </>
  );
}
function DocumentDetails({
  id,
  onChanged,
  basePath = '/documents',
}: {
  id: string;
  onChanged: (message: string) => void;
  basePath?: string;
}) {
  const { t, i18n } = useTranslation(),
    { me } = useSession(),
    upload = useUpload(),
    members = useMembers(),
    canWrite =
      me.permissions.includes('documents:write') ||
      (basePath.startsWith('/events/') && me.permissions.includes('events:write')),
    financeWrite = me.permissions.includes('finance:write');
  const query = useQuery({
    queryKey: ['documents-detail', me.activeOrganizationId, id, basePath],
    queryFn: () => api<DocumentDetail>(`${basePath}/${id}`),
  });
  const [error, setError] = useState(''),
    [pending, setPending] = useState(false),
    [editing, setEditing] = useState(false);
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} />;
  const item = query.data,
    editable =
      canWrite && !item.archived && (!(item.cashbookEntryId || item.transferId) || financeWrite);
  async function patch(body: Record<string, unknown>, message: string) {
    setPending(true);
    setError('');
    try {
      await api(`${basePath}/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...body, version: item.version }),
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      setEditing(false);
      refresh();
      onChanged(message);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  async function newVersion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget,
      file = new FormData(formElement).get('file');
    if (!(file instanceof File) || !file.name) {
      setError(t('documentChooseFile'));
      return;
    }
    setPending(true);
    setError('');
    try {
      await upload(`${basePath}/${item.id}/versions`, file, { filename: file.name });
      formElement.reset();
      refresh();
      onChanged('documentVersionSaved');
    } catch (error) {
      setError(uploadError(error, t));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="finance-detail">
      <h3>{item.title}</h3>
      <p>
        {t(categoryKey(item.category))}
        {item.archived && ` · ${t('documentArchived')}`}
      </p>
      <dl>
        {[
          ['documentDescription', item.description || '—'],
          ['documentMember', item.memberName ?? '—'],
          ['documentCashbookEntry', item.cashbookEntryLabel ?? '—'],
          ['s22Transfers', item.transferLabel ?? '—'],
          ['groups', item.groupName ?? '—'],
          ['events', item.eventTitleI18n?.[i18n.language === 'it' ? 'it' : 'de'] ?? '—'],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{t(label!)}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <h3>{t('documentVersions')}</h3>
      <VersionList document={item} basePath={basePath} />
      {error && <Notice error>{error}</Notice>}
      {editable && !editing && (
        <form className="document-version-form" onSubmit={(event) => void newVersion(event)}>
          <Field label={t('documentNewVersion')} hint={t('documentFileHint')}>
            <input type="file" name="file" required accept="application/pdf,image/png,image/jpeg" />
          </Field>
          <Button type="submit" variant="secondary" disabled={pending}>
            <FileUp size={16} />
            {t('documentUploadVersion')}
          </Button>
        </form>
      )}
      {editing && (
        <form
          className="finance-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void patch(
              {
                title: form.get('title'),
                category: form.get('category'),
                description: form.get('description'),
                ...(members.data ? { membershipId: form.get('membershipId') || null } : {}),
              },
              'documentSaved',
            );
          }}
        >
          <div className="form-grid">
            <Field label={`${t('documentTitle')} *`}>
              <input name="title" required maxLength={200} defaultValue={item.title} />
            </Field>
            <Field label={t('documentCategory')}>
              <select name="category" defaultValue={item.category}>
                {categories.map((value) => (
                  <option key={value} value={value}>
                    {t(categoryKey(value))}
                  </option>
                ))}
              </select>
            </Field>
            {members.data && (
              <Field label={t('documentMember')}>
                <select name="membershipId" defaultValue={item.membershipId ?? ''}>
                  <option value="">{t('documentNoMember')}</option>
                  {members.data.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.firstName} {m.lastName} · {m.membershipNumber}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label={t('documentDescription')}>
              <textarea
                name="description"
                rows={3}
                maxLength={2000}
                defaultValue={item.description}
              />
            </Field>
          </div>
          <FormActions pending={pending} onCancel={() => setEditing(false)} />
        </form>
      )}
      {canWrite && (!(item.cashbookEntryId || item.transferId) || financeWrite) && !editing && (
        <div className="finance-row-actions document-actions">
          {editable && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              {t('documentEdit')}
            </Button>
          )}
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              void patch(
                { archived: !item.archived },
                item.archived ? 'documentRestored' : 'documentArchivedNotice',
              )
            }
          >
            {item.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
            {t(item.archived ? 'documentRestore' : 'documentArchive')}
          </Button>
        </div>
      )}
    </div>
  );
}
function DocumentTable({
  items,
  onOpen,
  basePath = '/documents',
}: {
  items: DocumentRecord[];
  onOpen: (id: string) => void;
  basePath?: string;
}) {
  const { t, i18n } = useTranslation(),
    [error, setError] = useState('');
  return (
    <>
      {error && <Notice error>{error}</Notice>}
      <div className="table-scroll" tabIndex={0} role="region" aria-label={t('documents')}>
        <table>
          <thead>
            <tr>
              <th>{t('documentTitle')}</th>
              <th>{t('documentCategory')}</th>
              <th>{t('documentFile')}</th>
              <th>{t('documentUpdated')}</th>
              <th>{t('actions')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <button className="finance-name-link" onClick={() => onOpen(item.id)}>
                    <strong>{item.title}</strong>
                    {(item.memberName || item.cashbookEntryLabel) && (
                      <small>
                        {[
                          item.memberName,
                          item.cashbookEntryLabel &&
                            `${t('ledgerCashbook')} ${item.cashbookEntryLabel}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </small>
                    )}
                  </button>
                </td>
                <td>{t(categoryKey(item.category))}</td>
                <td>
                  {item.latestVersion?.filename}
                  <small className="finance-cell-note">
                    v{item.latestVersion?.versionNumber} ·{' '}
                    {item.latestVersion && fileSize(item.latestVersion.sizeBytes, i18n.language)}
                  </small>
                </td>
                <td>{formatDate(item.updatedAt, i18n.language)}</td>
                <td>
                  <div className="finance-row-actions">
                    {item.latestVersion && (
                      <Button
                        variant="secondary"
                        aria-label={`${t('documentDownload')}: ${item.title}`}
                        onClick={async () => {
                          setError('');
                          try {
                            await downloadPrivateFile(
                              `${basePath}/${item.id}/versions/${item.latestVersion!.id}/content`,
                              item.latestVersion!.filename,
                            );
                          } catch (error) {
                            setError(errorMessage(error));
                          }
                        }}
                      >
                        <Download size={16} />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      aria-label={`${t('documentDetails')}: ${item.title}`}
                      onClick={() => onOpen(item.id)}
                    >
                      <ArrowUpRight size={17} />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
export function Documents() {
  const { t } = useTranslation(),
    { me } = useSession(),
    canWrite = me.permissions.includes('documents:write');
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState(''),
    [archived, setArchived] = useState('false'),
    [page, setPage] = useState(1),
    [editor, setEditor] = useState<{ type: 'upload' } | { type: 'detail'; id: string } | null>(
      null,
    ),
    [notice, setNotice] = useState('');
  const debounced = useDebounced(search);
  const q = new URLSearchParams({
    search: debounced,
    page: String(page),
    archived,
    ...(category ? { category } : {}),
  }).toString();
  const query = useQuery({
    queryKey: ['documents-list', me.activeOrganizationId, q],
    queryFn: () => api<Page<DocumentRecord>>(`/documents?${q}`),
  });
  return (
    <>
      <PageHeading
        title={t('documents')}
        description={t('documentsIntro')}
        actions={
          canWrite && (
            <Button onClick={() => setEditor({ type: 'upload' })}>
              <Plus size={17} />
              {t('documentUpload')}
            </Button>
          )
        }
      />
      {notice && <Notice>{notice}</Notice>}
      <section className="panel">
        <div className="toolbar">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder={t('documentSearch')}
          />
          <label>
            <span className="sr-only">{t('documentCategory')}</span>
            <select
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setPage(1);
              }}
            >
              <option value="">{t('documentAllCategories')}</option>
              {categories.map((value) => (
                <option key={value} value={value}>
                  {t(categoryKey(value))}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">{t('status')}</span>
            <select
              value={archived}
              onChange={(event) => {
                setArchived(event.target.value);
                setPage(1);
              }}
            >
              <option value="false">{t('documentCurrent')}</option>
              <option value="true">{t('documentArchiveFilter')}</option>
            </select>
          </label>
        </div>
        <QueryView query={query}>
          {(data) =>
            data.items.length ? (
              <>
                <DocumentTable
                  items={data.items}
                  onOpen={(id) => setEditor({ type: 'detail', id })}
                />
                <Pagination
                  page={page}
                  pageSize={data.pageSize}
                  total={data.total}
                  onChange={setPage}
                />
              </>
            ) : (
              <Empty
                description={t(
                  debounced || category
                    ? 'noResults'
                    : archived === 'true'
                      ? 'documentArchiveEmpty'
                      : 'documentEmpty',
                )}
              />
            )
          }
        </QueryView>
      </section>
      <p className="finance-footnote">{t('documentPrivacyHint')}</p>
      {editor && (
        <Modal
          wide
          title={t(editor.type === 'upload' ? 'documentUpload' : 'documentDetails')}
          onClose={() => setEditor(null)}
        >
          {editor.type === 'upload' ? (
            <UploadForm
              onCancel={() => setEditor(null)}
              onDone={() => {
                setEditor(null);
                setNotice(t('documentSaved'));
                refresh();
              }}
            />
          ) : (
            <DocumentDetails
              id={editor.id}
              onChanged={(message) => {
                setNotice(t(message));
                if (message !== 'documentVersionSaved') setEditor(null);
              }}
            />
          )}
        </Modal>
      )}
    </>
  );
}
// Receipts for a cashbook entry, shown from the cashbook.
export function EntryDocuments({
  entryId,
  transferId,
  eventOccurrenceId,
  title,
  canWrite,
}: {
  entryId?: string;
  transferId?: string;
  eventOccurrenceId?: string;
  title: string;
  canWrite: boolean;
}) {
  const basePath =
    eventOccurrenceId && canWrite ? `/events/${eventOccurrenceId}/documents` : '/documents';
  const { t } = useTranslation(),
    { me } = useSession(),
    [uploading, setUploading] = useState(false),
    [open, setOpen] = useState<string | null>(null),
    [notice, setNotice] = useState('');
  const query = useQuery({
    queryKey: [
      'documents-entry',
      me.activeOrganizationId,
      entryId,
      transferId,
      eventOccurrenceId,
      basePath,
    ],
    queryFn: () =>
      api<Page<DocumentRecord>>(
        `${basePath}?${eventOccurrenceId ? `eventOccurrenceId=${eventOccurrenceId}` : transferId ? `transferId=${transferId}` : `cashbookEntryId=${entryId}`}&archived=false&pageSize=100`,
      ),
  });
  if (open)
    return (
      <DocumentDetails
        basePath={basePath}
        id={open}
        onChanged={(message) => setNotice(t(message))}
      />
    );
  return (
    <div className="finance-detail">
      {notice && <Notice>{notice}</Notice>}
      <QueryView query={query}>
        {(data) =>
          data.items.length ? (
            <DocumentTable basePath={basePath} items={data.items} onOpen={setOpen} />
          ) : (
            <p className="finance-footnote">
              {t(eventOccurrenceId ? 'documentEmpty' : 'documentNoReceipts')}
            </p>
          )
        }
      </QueryView>
      {canWrite &&
        (uploading ? (
          <section
            className="finance-inline-form"
            aria-label={t(eventOccurrenceId ? 'documentUpload' : 'documentAttachReceipt')}
          >
            <h3>{t(eventOccurrenceId ? 'documentUpload' : 'documentAttachReceipt')}</h3>
            <UploadForm
              basePath={basePath}
              cashbookEntryId={entryId}
              transferId={transferId}
              eventOccurrenceId={eventOccurrenceId}
              defaultTitle={title}
              onCancel={() => setUploading(false)}
              onDone={() => {
                setUploading(false);
                setNotice(t('documentSaved'));
                refresh();
              }}
            />
          </section>
        ) : (
          <Button variant="secondary" onClick={() => setUploading(true)}>
            <FileUp size={16} />
            {t(eventOccurrenceId ? 'documentUpload' : 'documentAttachReceipt')}
          </Button>
        ))}
    </div>
  );
}
