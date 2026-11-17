import { QueryView } from '../components/ui';
import { useState } from 'react';
import { Link, useParams, useSearchParams, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Download, Upload, ArrowUpRight, ArrowLeft, Pencil } from 'lucide-react';
import type { ConsentState, Member, MemberField, Page } from '@bnature/contracts';
import { api, allPages, errorMessage } from '../lib/api';
import { csvColumns, downloadCsv, encodeCsv } from '../lib/csv';
import { fieldLabel, formatFieldValue } from '../lib/member-fields';
import { useDebounced } from '../hooks/use-debounced';
import { useSession } from '../app/session';
import {
  Avatar,
  Badge,
  Button,
  Empty,
  ErrorState,
  Loading,
  Modal,
  Notice,
  PageHeading,
  Pagination,
  SearchInput,
  formatDate,
} from '../components/ui';
import { MemberForm } from './member-form';
import { CsvImport } from './csv-import';
import { MemberExtrasPanels } from './member-extras';
export function Members() {
  const { t, i18n } = useTranslation(),
    { me } = useSession();
  const [params, setParams] = useSearchParams(),
    navigate = useNavigate();
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [photoConsent, setPhotoConsent] = useState(''),
    [dataConsent, setDataConsent] = useState(''),
    [sort, setSort] = useState('name'),
    [page, setPage] = useState(1),
    [importOpen, setImportOpen] = useState(false),
    [importBusy, setImportBusy] = useState(false),
    [exporting, setExporting] = useState(false),
    [error, setError] = useState('');
  const debounced = useDebounced(search),
    write = me.permissions.includes('members:write');
  const queryString = new URLSearchParams({
    search: debounced,
    ...(status ? { status } : {}),
    ...(photoConsent ? { photoConsent } : {}),
    ...(dataConsent ? { dataConsent } : {}),
    sort: sort === 'newest' ? 'createdAt' : sort,
    direction: sort === 'newest' ? 'desc' : 'asc',
  }).toString();
  const fieldsQuery = useQuery({
    queryKey: ['member-fields', me.activeOrganizationId],
    queryFn: () => api<{ items: MemberField[] }>('/member-fields'),
  });
  const fields = (fieldsQuery.data?.items ?? []).filter((f) => f.active);
  const yesNo: [string, string] = [t('memberFieldYes'), t('memberFieldNo')];
  const consentText = (state: ConsentState | undefined) =>
    state === 'granted' ? t('consentGranted') : state === 'refused' ? t('consentRefused') : '';
  // CSV: the standard columns, then one column per custom field and the consent states.
  function exportRows(members: Member[]) {
    const fieldHeaders = fields.map((f) => fieldLabel(f, i18n.language));
    const consentHeaders = [t('csvConsentData'), t('csvConsentPhotos')];
    const rows = members.map((m) => ({
      ...m,
      ...Object.fromEntries(
        fields.map((f, i) => [
          fieldHeaders[i],
          formatFieldValue(f, m.customFields?.[f.id], yesNo, i18n.language),
        ]),
      ),
      [consentHeaders[0]!]: consentText(m.dataConsent),
      [consentHeaders[1]!]: consentText(m.photoConsent),
    }));
    return encodeCsv(rows, [...csvColumns, ...fieldHeaders, ...consentHeaders]);
  }
  const query = useQuery({
    queryKey: ['members', me.activeOrganizationId, queryString, page],
    queryFn: () => api<Page<Member>>(`/members?${queryString}&page=${page}`),
  });
  return (
    <>
      <PageHeading
        title={t('members')}
        description={t('membersIntro')}
        actions={
          <>
            <Button
              variant="secondary"
              disabled={exporting}
              onClick={async () => {
                setExporting(true);
                setError('');
                try {
                  downloadCsv(
                    'bnature-mitglieder.csv',
                    exportRows(await allPages<Member>(`/members?${queryString}`)),
                  );
                } catch (error) {
                  setError(errorMessage(error));
                } finally {
                  setExporting(false);
                }
              }}
            >
              <Download size={16} />
              {t(exporting ? 'exporting' : 'export')}
            </Button>
            {write && (
              <>
                <Button variant="secondary" onClick={() => setImportOpen(true)}>
                  <Upload size={16} />
                  {t('import')}
                </Button>
                <Button onClick={() => setParams({ new: '1' })}>
                  <Plus size={17} />
                  {t('addMember')}
                </Button>
              </>
            )}
          </>
        }
      />
      {error && <Notice error>{error}</Notice>}
      <section className="panel">
        <div className="toolbar member-toolbar">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder={t('searchMembers')}
          />
          <label>
            <span className="sr-only">{t('status')}</span>
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">{t('allStatuses')}</option>
              {['active', 'pending', 'inactive', 'resigned'].map((value) => (
                <option key={value} value={value}>
                  {t(value)}
                </option>
              ))}
            </select>
          </label>
          {(
            [
              ['photoConsent', photoConsent, setPhotoConsent, 'consentFilterPhotos'],
              ['dataConsent', dataConsent, setDataConsent, 'consentFilterData'],
            ] as const
          ).map(([name, value, set, label]) => (
            <label key={name}>
              <span className="sr-only">{t(label)}</span>
              <select
                aria-label={t(label)}
                value={value}
                onChange={(event) => {
                  set(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">{t(label)}</option>
                <option value="granted">{`${t(label)}: ${t('consentGranted')}`}</option>
                <option value="refused">{`${t(label)}: ${t('consentRefused')}`}</option>
                <option value="missing">{`${t(label)}: ${t('consentNone')}`}</option>
              </select>
            </label>
          ))}
          <label>
            <span className="sr-only">{t('sort')}</span>
            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value);
                setPage(1);
              }}
            >
              {['name', 'newest', 'joinedAt'].map((value) => (
                <option key={value} value={value}>
                  {t(value === 'joinedAt' ? 'joined' : value)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {
          <QueryView query={query}>
            {(queryData) => (
              <>
                {queryData.items.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>{t('name')}</th>
                          <th>{t('memberNumber')}</th>
                          <th>{t('membershipType')}</th>
                          <th>{t('status')}</th>
                          <th>{t('joined')}</th>
                          <th>{t('consentsTitle')}</th>
                          {fields.length > 0 && <th>{t('memberFieldsTitle')}</th>}
                          <th>
                            <span className="sr-only">{t('actions')}</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {queryData.items.map((member) => (
                          <tr key={member.id}>
                            <td>
                              <Link to={`/members/${member.id}`} className="person-cell">
                                <Avatar firstName={member.firstName} lastName={member.lastName} />
                                <span>
                                  <strong>
                                    {member.firstName} {member.lastName}
                                  </strong>
                                  <small>{member.email || t('noContact')}</small>
                                </span>
                              </Link>
                            </td>
                            <td className="mono">{member.membershipNumber}</td>
                            <td>{t(member.membershipType)}</td>
                            <td>
                              <Badge status={member.status} />
                            </td>
                            <td>{formatDate(member.joinedAt, i18n.language)}</td>
                            <td>
                              <span className="consent-pills">
                                {(
                                  [
                                    ['dataConsent', 'consentShortData'],
                                    ['photoConsent', 'consentShortPhotos'],
                                  ] as const
                                ).map(([key, label]) => {
                                  const state = member[key];
                                  return (
                                    <span
                                      key={key}
                                      className={`consent-pill consent-${state === 'granted' ? 'yes' : state === 'refused' ? 'no' : 'none'}`}
                                    >
                                      {t(label)}{' '}
                                      {state === 'granted' ? '✓' : state === 'refused' ? '✗' : '–'}
                                      <span className="sr-only">
                                        : {consentText(state) || t('consentNone')}
                                      </span>
                                    </span>
                                  );
                                })}
                              </span>
                            </td>
                            {fields.length > 0 && (
                              <td className="member-field-cell">
                                {fields
                                  .filter((f) => member.customFields?.[f.id] !== undefined)
                                  .map((f) => (
                                    <small key={f.id}>
                                      {fieldLabel(f, i18n.language)}:{' '}
                                      {formatFieldValue(
                                        f,
                                        member.customFields?.[f.id],
                                        yesNo,
                                        i18n.language,
                                      )}
                                    </small>
                                  ))}
                              </td>
                            )}
                            <td>
                              <Link
                                to={`/members/${member.id}`}
                                className="icon-button"
                                aria-label={`${t('details')}: ${member.firstName} ${member.lastName}`}
                              >
                                <ArrowUpRight size={18} />
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    title={
                      debounced || status || photoConsent || dataConsent
                        ? t('noResults')
                        : undefined
                    }
                    description={
                      debounced || status || photoConsent || dataConsent
                        ? undefined
                        : t('emptyMembers')
                    }
                  />
                )}
                <Pagination
                  page={page}
                  pageSize={queryData.pageSize}
                  total={queryData.total}
                  onChange={setPage}
                />
              </>
            )}
          </QueryView>
        }
      </section>
      {params.get('new') && write && (
        <Modal wide title={t('addMember')} onClose={() => setParams({})}>
          <MemberForm
            onDone={(member) => navigate(`/members/${member.id}`)}
            onCancel={() => setParams({})}
          />
        </Modal>
      )}
      {importOpen && (
        <Modal
          wide
          title={t('import')}
          onClose={() => {
            if (!importBusy) setImportOpen(false);
          }}
        >
          <CsvImport onBusy={setImportBusy} />
        </Modal>
      )}
    </>
  );
}
export function MemberDetail() {
  const { id } = useParams(),
    { t, i18n } = useTranslation(),
    { me } = useSession();
  const [editing, setEditing] = useState(false);
  const query = useQuery({
    queryKey: ['member', me.activeOrganizationId, id],
    queryFn: () => api<Member>(`/members/${id}`),
  });
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const member = query.data;
  return (
    <>
      <Link to="/members" className="back-link">
        <ArrowLeft size={16} />
        {t('members')}
      </Link>
      <PageHeading
        title={`${member.firstName} ${member.lastName}`}
        description={`${t('memberNumber')} ${member.membershipNumber}`}
        actions={
          me.permissions.includes('members:write') && (
            <Button onClick={() => setEditing(true)}>
              <Pencil size={16} />
              {t('edit')}
            </Button>
          )
        }
      />
      <div className="detail-grid">
        <section className="panel detail-panel">
          <header className="member-detail-header">
            <Avatar firstName={member.firstName} lastName={member.lastName} />
            <div>
              <h2>
                {member.firstName} {member.lastName}
              </h2>
              <Badge status={member.status} />
            </div>
          </header>
          <dl>
            {['email', 'phone', 'dateOfBirth', 'fiscalCode', 'preferredLanguage'].map((key) => (
              <div key={key}>
                <dt>{t(key === 'preferredLanguage' ? 'language' : key)}</dt>
                <dd>
                  {key === 'dateOfBirth'
                    ? formatDate(member.dateOfBirth, i18n.language)
                    : key === 'preferredLanguage'
                      ? t(member.preferredLanguage)
                      : String(member[key as keyof Member] ?? '') || '—'}
                </dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="panel detail-panel">
          <h2>{t('membershipData')}</h2>
          <dl>
            {[
              ['memberNumber', member.membershipNumber],
              ['membershipType', t(member.membershipType)],
              ['joined', formatDate(member.joinedAt, i18n.language)],
              ['endedAt', formatDate(member.endedAt, i18n.language)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{t(label!)}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <h2>{t('address')}</h2>
          <p>
            {member.street || '—'}
            <br />
            {member.postalCode} {member.city}
            <br />
            {member.country}
          </p>
        </section>
      </div>
      <MemberExtrasPanels membershipId={member.id} />
      {editing && (
        <Modal wide title={t('edit')} onClose={() => setEditing(false)}>
          <MemberForm
            member={member}
            onDone={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        </Modal>
      )}
    </>
  );
}
