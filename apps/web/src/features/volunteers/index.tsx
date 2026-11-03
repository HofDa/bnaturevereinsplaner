import { useBusinessDate } from '../../hooks/use-business-date';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Users,
  CalendarClock,
  Clock3,
  ShieldAlert,
  FileClock,
  Scale,
  UserCheck,
} from 'lucide-react';
import type {
  DocumentRecord,
  Page,
  VolunteerDetail as Detail,
  VolunteerSummary,
} from '@bnature/contracts';
import { api, downloadPrivateFile, queryClient } from '../../lib/api';
import { useSession } from '../../app/session';
import {
  Button,
  Empty,
  ErrorState,
  Loading,
  Notice,
  PageHeading,
  Pagination,
  SearchInput,
  Field,
  formatDate,
} from '../../components/ui';
import { useDebounced } from '../../hooks/use-debounced';
import {
  CoverageBadge,
  FormModal,
  StatusTag,
  VolunteerNavigation,
  hoursLabel,
  nullable,
  splitList,
  usePermission,
  usePrivateUpload,
  useVolunteerWrite,
  type FormValues,
} from './shared';

type Overview = {
  activeRegular: number;
  activeOccasional: number;
  plannedAssignments: number;
  confirmedMinutesThisYear: number;
  pendingMinutesThisYear: number;
  unclearCoverage: number | null;
  expiringPolicies: number | null;
  lastSnapshot: { snapshotNumber: number; cutoffDate: string; status: string } | null;
  snapshotDue: boolean;
  openLegalDeadlines: number | null;
};
function Stat({
  label,
  value,
  note,
  icon: Icon,
  to,
}: {
  label: string;
  value: string | number;
  note?: string;
  icon: typeof Users;
  to?: string;
}) {
  const body = (
    <>
      <div>
        <span>{label}</span>
        <Icon size={17} />
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </>
  );
  return to ? (
    <Link to={to} className="stat-card stat-link">
      {body}
    </Link>
  ) : (
    <div className="stat-card">{body}</div>
  );
}
export function VolunteerOverview() {
  const { t, i18n } = useTranslation(),
    { me } = useSession();
  const query = useQuery({
    queryKey: ['volunteer-overview', me.activeOrganizationId],
    queryFn: () => api<Overview>('/volunteers/overview'),
  });
  return (
    <>
      <PageHeading title={t('volunteers')} description={t('volIntro')} />
      <VolunteerNavigation />
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          <div className="stats-grid volunteer-stats">
            <Stat
              label={t('volActiveRegular')}
              value={query.data.activeRegular}
              icon={Users}
              to="/volunteers/list"
              note={t('volRegularNote')}
            />
            <Stat
              label={t('volActiveOccasional')}
              value={query.data.activeOccasional}
              icon={UserCheck}
              to="/volunteers/list"
              note={t('volOccasionalNote')}
            />
            <Stat
              label={t('volPlannedAssignments')}
              value={query.data.plannedAssignments}
              icon={CalendarClock}
              to="/volunteers/assignments"
            />
            <Stat
              label={t('volConfirmedHours')}
              value={hoursLabel(query.data.confirmedMinutesThisYear)}
              icon={Clock3}
              to="/volunteers/hours"
              note={`${t('volPendingHours')}: ${hoursLabel(query.data.pendingMinutesThisYear)}`}
            />
            {query.data.unclearCoverage !== null && (
              <Stat
                label={t('volUnclearCoverage')}
                value={query.data.unclearCoverage}
                icon={ShieldAlert}
                to="/volunteers/insurance"
                note={t('volCoverageNote')}
              />
            )}
            {query.data.expiringPolicies !== null && (
              <Stat
                label={t('volExpiringPolicies')}
                value={query.data.expiringPolicies}
                icon={FileClock}
                to="/volunteers/insurance"
              />
            )}
            {me.permissions.includes('register:read') && (
              <Stat
                label={t('volSnapshotStatus')}
                value={query.data.lastSnapshot ? `#${query.data.lastSnapshot.snapshotNumber}` : '—'}
                icon={FileClock}
                to="/volunteers/register"
                note={
                  query.data.lastSnapshot
                    ? `${t(`snapshot_${query.data.lastSnapshot.status}`)} · ${formatDate(query.data.lastSnapshot.cutoffDate, i18n.language)}${query.data.snapshotDue ? ` · ${t('volSnapshotDue')}` : ''}`
                    : t('volSnapshotNone')
                }
              />
            )}
            {query.data.openLegalDeadlines !== null && (
              <Stat
                label={t('volOpenLegalDeadlines')}
                value={query.data.openLegalDeadlines}
                icon={Scale}
                to="/compliance"
              />
            )}
          </div>
          <Notice>{t('volLegalNotice')}</Notice>
        </>
      )}
    </>
  );
}
function registerFields(t: (k: string) => string, data?: Detail['registerData']) {
  return [
    { name: 'fiscalCode', label: t('fiscalCode'), defaultValue: data?.fiscalCode ?? '' },
    {
      name: 'dateOfBirth',
      label: t('dateOfBirth'),
      type: 'date' as const,
      defaultValue: data?.dateOfBirth ?? '',
    },
    { name: 'birthPlace', label: t('volBirthPlace'), defaultValue: data?.birthPlace ?? '' },
    { name: 'street', label: t('street'), defaultValue: data?.street ?? '' },
    { name: 'postalCode', label: t('postalCode'), defaultValue: data?.postalCode ?? '' },
    { name: 'city', label: t('city'), defaultValue: data?.city ?? '' },
    { name: 'country', label: t('country'), defaultValue: data?.country ?? 'IT' },
    {
      name: 'domicile',
      label: t('volDomicile'),
      hint: t('volDomicileHint'),
      defaultValue: data?.domicile ?? '',
    },
  ];
}
const registerPayload = (v: FormValues) => ({
  fiscalCode: v.fiscalCode,
  dateOfBirth: nullable(v.dateOfBirth!),
  birthPlace: v.birthPlace,
  street: v.street,
  postalCode: v.postalCode,
  city: v.city,
  country: (v.country as string) || 'IT',
  domicile: v.domicile,
});
function RegisterVolunteer({ onClose }: { onClose: () => void }) {
  const todayIso = useBusinessDate();
  const { t } = useTranslation(),
    { me } = useSession(),
    write = useVolunteerWrite(),
    navigate = useNavigate();
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const people = useQuery({
    queryKey: ['volunteer-people', me.activeOrganizationId],
    queryFn: () =>
      api<{ items: { id: string; name: string; isMember: boolean; hasOpenEngagement: boolean }[] }>(
        '/volunteer-people',
      ),
  });
  const base = [
    ...(mode === 'existing'
      ? [
          {
            name: 'personId',
            label: t('volPerson'),
            type: 'select' as const,
            required: true,
            options: [
              { value: '', label: t('choosePerson') },
              ...(people.data?.items ?? [])
                .filter((p) => !p.hasOpenEngagement)
                .map((p) => ({
                  value: p.id,
                  label: `${p.name}${p.isMember ? ` · ${t('volIsMember')}` : ''}`,
                })),
            ],
          },
        ]
      : [
          { name: 'firstName', label: t('firstName'), required: true },
          { name: 'lastName', label: t('lastName'), required: true },
          { name: 'email', label: t('email'), type: 'email' as const },
          { name: 'phone', label: t('phone') },
        ]),
    {
      name: 'volunteerType',
      label: t('volType'),
      type: 'select' as const,
      required: true,
      options: [
        { value: 'regular', label: t('vol_regular') },
        { value: 'occasional', label: t('vol_occasional') },
      ],
    },
    {
      name: 'startedOn',
      label: t('volStartedOn'),
      type: 'date' as const,
      required: true,
      defaultValue: todayIso(),
    },
    { name: 'focusAreas', label: t('volFocusAreas'), hint: t('volFocusHint') },
    { name: 'activity', label: t('volActivity') },
    { name: 'notes', label: t('notes'), type: 'textarea' as const },
    ...registerFields(t),
  ];
  return (
    <FormModal
      wide
      title={t('volRegisterVolunteer')}
      fields={base}
      submitLabel={t('create')}
      onClose={onClose}
      onSubmit={async (v) => {
        const created = await write<Detail>('/volunteers', {
          ...(mode === 'existing'
            ? { personId: v.personId }
            : {
                person: {
                  firstName: v.firstName,
                  lastName: v.lastName,
                  email: v.email,
                  phone: v.phone,
                },
              }),
          volunteerType: v.volunteerType,
          startedOn: v.startedOn,
          focusAreas: splitList(String(v.focusAreas)),
          activity: v.activity,
          notes: v.notes,
          registerData: registerPayload(v),
        });
        void queryClient.invalidateQueries();
        onClose();
        navigate(`/volunteers/${created.id}`);
      }}
    >
      <div className="finance-tabs" role="tablist" aria-label={t('volPersonSource')}>
        {(['existing', 'new'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
          >
            {t(m === 'existing' ? 'volExistingPerson' : 'volNewPerson')}
          </button>
        ))}
      </div>
      <p className="form-hint">{t('volNoDuplicatePersons')}</p>
    </FormModal>
  );
}
export function VolunteerList() {
  const { t, i18n } = useTranslation(),
    { me } = useSession(),
    can = usePermission();
  const [search, setSearch] = useState(''),
    [type, setType] = useState(''),
    [status, setStatus] = useState('active'),
    [coverage, setCoverage] = useState(''),
    [page, setPage] = useState(1),
    [creating, setCreating] = useState(false);
  const debounced = useDebounced(search);
  const query = useQuery({
    queryKey: ['volunteers', me.activeOrganizationId, debounced, type, status, coverage, page],
    queryFn: () =>
      api<Page<VolunteerSummary>>(
        `/volunteers?page=${page}&search=${encodeURIComponent(debounced)}${type ? `&volunteerType=${type}` : ''}${status ? `&status=${status}` : ''}${coverage ? `&coverage=${coverage}` : ''}`,
      ),
  });
  const filter = (
    label: string,
    value: string,
    set: (v: string) => void,
    options: [string, string][],
  ) => (
    <Field label={label}>
      <select
        value={value}
        onChange={(e) => {
          set(e.target.value);
          setPage(1);
        }}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </Field>
  );
  return (
    <>
      <PageHeading
        title={t('volList')}
        description={t('volListIntro')}
        actions={
          can('volunteers:write') && (
            <Button onClick={() => setCreating(true)}>
              <Plus size={17} />
              {t('volRegisterVolunteer')}
            </Button>
          )
        }
      />
      <VolunteerNavigation />
      <section className="panel">
        <div className="toolbar event-filters">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
          />
          {filter(t('volType'), type, setType, [
            ['', t('all')],
            ['regular', t('vol_regular')],
            ['occasional', t('vol_occasional')],
          ])}
          {filter(t('status'), status, setStatus, [
            ['', t('all')],
            ['active', t('engagement_active')],
            ['paused', t('engagement_paused')],
            ['ended', t('engagement_ended')],
          ])}
          {filter(t('volInsuranceStatus'), coverage, setCoverage, [
            ['', t('all')],
            ...(['possibly_covered', 'assigned', 'unclear', 'none'] as const).map(
              (c) => [c, t(`coverage_${c}`)] as [string, string],
            ),
          ])}
        </div>
        {query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : query.data.items.length ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t('name')}</th>
                    <th>{t('volType')}</th>
                    <th>{t('status')}</th>
                    <th>{t('volFocusAreas')}</th>
                    <th>{t('volRegisterState')}</th>
                    <th>{t('volInsuranceStatus')}</th>
                    <th>{t('volConfirmedHours')}</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((v) => (
                    <tr key={v.id}>
                      <td>
                        <Link className="finance-name-link" to={`/volunteers/${v.id}`}>
                          <strong>
                            {v.firstName} {v.lastName}
                          </strong>
                          <small>
                            {formatDate(v.startedOn, i18n.language)}
                            {v.endedOn ? ` – ${formatDate(v.endedOn, i18n.language)}` : ''}
                            {v.isMember ? ` · ${t('volIsMember')}` : ''}
                          </small>
                        </Link>
                      </td>
                      <td>{t(`vol_${v.volunteerType}`)}</td>
                      <td>
                        <StatusTag prefix="engagement" value={v.status} />
                      </td>
                      <td>{v.focusAreas.join(', ') || '—'}</td>
                      <td>
                        <StatusTag prefix="registerState" value={v.registerState} />
                      </td>
                      <td>
                        <CoverageBadge status={v.coverageStatus} />
                      </td>
                      <td className="numeric">{hoursLabel(v.confirmedMinutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              pageSize={query.data.pageSize}
              total={query.data.total}
              onChange={setPage}
            />
          </>
        ) : (
          <Empty description={t('volEmpty')} />
        )}
      </section>
      {creating && <RegisterVolunteer onClose={() => setCreating(false)} />}
    </>
  );
}
export function VolunteerDetailPage() {
  const todayIso = useBusinessDate();
  const { id = '' } = useParams(),
    { t, i18n } = useTranslation(),
    { me } = useSession(),
    can = usePermission(),
    write = useVolunteerWrite(),
    upload = usePrivateUpload(),
    language = i18n.language === 'it' ? 'it' : 'de';
  const [dialog, setDialog] = useState<'edit' | 'end' | null>(null),
    [error, setError] = useState('');
  const query = useQuery({
    queryKey: ['volunteer', me.activeOrganizationId, id],
    queryFn: () => api<Detail>(`/volunteers/${id}`),
  });
  const documents = useQuery({
    queryKey: ['volunteer-documents', me.activeOrganizationId, id],
    queryFn: () => api<Page<DocumentRecord>>(`/documents?volunteerEngagementId=${id}`),
    enabled: can('volunteers:write') && can('documents:read'),
  });
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const v = query.data;
  const refresh = () => void queryClient.invalidateQueries();
  return (
    <>
      <PageHeading
        title={`${v.firstName} ${v.lastName}`}
        description={`${t(`vol_${v.volunteerType}`)} · ${formatDate(v.startedOn, i18n.language)}${v.endedOn ? ` – ${formatDate(v.endedOn, i18n.language)}` : ''}`}
        actions={
          can('volunteers:write') &&
          v.status !== 'ended' && (
            <>
              <Button variant="secondary" onClick={() => setDialog('edit')}>
                {t('edit')}
              </Button>
              <Button variant="secondary" onClick={() => setDialog('end')}>
                {t('volEnd')}
              </Button>
            </>
          )
        }
      />
      <VolunteerNavigation />
      {error && <Notice error>{error}</Notice>}
      <div className="volunteer-detail-grid">
        <section className="panel detail-panel">
          <h2>{t('volEngagement')}</h2>
          <dl className="detail-list">
            <dt>{t('status')}</dt>
            <dd>
              <StatusTag prefix="engagement" value={v.status} />
            </dd>
            <dt>{t('volIsMember')}</dt>
            <dd>{t(v.isMember ? 'yes' : 'no')}</dd>
            <dt>{t('volFocusAreas')}</dt>
            <dd>{v.focusAreas.join(', ') || '—'}</dd>
            <dt>{t('volActivity')}</dt>
            <dd>{v.activity || '—'}</dd>
            <dt>{t('volConfirmedHours')}</dt>
            <dd>{hoursLabel(v.confirmedMinutes)}</dd>
            <dt>{t('volRegisterState')}</dt>
            <dd>
              <StatusTag prefix="registerState" value={v.registerState} />
            </dd>
            {v.notes && (
              <>
                <dt>{t('notes')}</dt>
                <dd>{v.notes}</dd>
              </>
            )}
          </dl>
        </section>
        <section className="panel detail-panel">
          <h2>{t('volInsuranceStatus')}</h2>
          <CoverageBadge status={v.coverage.status} />
          <ul className="plain-list">
            {v.coverage.reasons.map((r) => (
              <li key={r}>{t(r)}</li>
            ))}
          </ul>
          {v.coverage.gaps.length > 0 && (
            <>
              <h3>{t('volCoverageGaps')}</h3>
              <ul className="plain-list">
                {v.coverage.gaps.map((g) => (
                  <li key={`${g.type}${g.from}`}>
                    {t(`insurance_${g.type}`)}: {formatDate(g.from, i18n.language)} –{' '}
                    {g.to ? formatDate(g.to, i18n.language) : t('ongoing')}
                  </li>
                ))}
              </ul>
            </>
          )}
          <small className="muted">{t('volCoverageNote')}</small>
        </section>
        {v.registerData && (
          <section className="panel detail-panel">
            <h2>{t('volRegisterData')}</h2>
            {v.registerIssues.length > 0 && (
              <Notice error>{v.registerIssues.map((i) => t(i)).join(' ')}</Notice>
            )}
            <dl className="detail-list">
              <dt>{t('fiscalCode')}</dt>
              <dd>{v.registerData.fiscalCode || '—'}</dd>
              <dt>{t('dateOfBirth')}</dt>
              <dd>
                {formatDate(v.registerData.dateOfBirth, i18n.language)} {v.registerData.birthPlace}
              </dd>
              <dt>{t('volResidence')}</dt>
              <dd>
                {[
                  v.registerData.street,
                  v.registerData.postalCode,
                  v.registerData.city,
                  v.registerData.country,
                ]
                  .filter(Boolean)
                  .join(', ') || '—'}
              </dd>
              {v.registerData.domicile && (
                <>
                  <dt>{t('volDomicile')}</dt>
                  <dd>{v.registerData.domicile}</dd>
                </>
              )}
            </dl>
          </section>
        )}
        <section className="panel detail-panel">
          <h2>{t('volEvents')}</h2>
          {v.events.length ? (
            <ul className="plain-list">
              {v.events.map((e) => (
                <li key={`${e.relation}${e.eventOccurrenceId}`}>
                  <Link to={`/events/${e.eventOccurrenceId}`}>{e.titleI18n[language]}</Link> ·{' '}
                  {formatDate(e.startAt, i18n.language)} ·{' '}
                  {t(e.relation === 'assignment' ? 'volAssignment' : 'volRegistration')} (
                  {t(`${e.relation}_${e.status}`)})
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t('volNoEvents')}</p>
          )}
        </section>
        {documents.data && (
          <section className="panel detail-panel">
            <h2>{t('volEvidence')}</h2>
            <ul className="plain-list">
              {documents.data.items.map((d) => (
                <li key={d.id}>
                  {can('evidence:download') && d.latestVersion ? (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() =>
                        void downloadPrivateFile(
                          `/documents/${d.id}/versions/${d.latestVersion!.id}/content`,
                          d.latestVersion!.filename,
                        ).catch(() => setError(t('documentStorageError')))
                      }
                    >
                      {d.title}
                    </button>
                  ) : (
                    d.title
                  )}
                </li>
              ))}
            </ul>
            {can('documents:write') && (
              <label className="button button-secondary file-button">
                {t('volUploadEvidence')}
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    setError('');
                    try {
                      await upload('/documents', file, {
                        title: file.name,
                        category: 'other',
                        volunteerEngagementId: v.id,
                        filename: file.name,
                      });
                      refresh();
                    } catch (err) {
                      setError(
                        err instanceof Error && err.message.startsWith('document')
                          ? t(err.message)
                          : t('serverError'),
                      );
                    }
                  }}
                />
              </label>
            )}
          </section>
        )}
        <section className="panel detail-panel">
          <h2>{t('volHistory')}</h2>
          <ol className="history-list">
            {v.history.map((h) => (
              <li key={h.id}>
                <strong>{t(`volHistory_${h.action}`)}</strong> ·{' '}
                {formatDate(h.createdAt, i18n.language)} · {h.actorName ?? '—'}
                <small>
                  {Object.keys(h.changes)
                    .map((k) => t(k, { defaultValue: k }))
                    .join(', ')}
                </small>
              </li>
            ))}
          </ol>
        </section>
      </div>
      {dialog === 'edit' && (
        <FormModal
          wide
          title={t('edit')}
          onClose={() => setDialog(null)}
          fields={[
            {
              name: 'status',
              label: t('status'),
              type: 'select',
              defaultValue: v.status,
              options: [
                { value: 'active', label: t('engagement_active') },
                { value: 'paused', label: t('engagement_paused') },
              ],
            },
            {
              name: 'focusAreas',
              label: t('volFocusAreas'),
              hint: t('volFocusHint'),
              defaultValue: v.focusAreas.join(', '),
            },
            { name: 'activity', label: t('volActivity'), defaultValue: v.activity },
            { name: 'notes', label: t('notes'), type: 'textarea', defaultValue: v.notes },
            ...(v.registerData ? registerFields(t, v.registerData) : []),
          ]}
          onSubmit={async (values) => {
            await write(
              `/volunteers/${v.id}`,
              {
                version: v.version,
                status: values.status,
                focusAreas: splitList(String(values.focusAreas)),
                activity: values.activity,
                notes: values.notes,
                ...(v.registerData ? { registerData: registerPayload(values) } : {}),
              },
              'PATCH',
            );
            refresh();
            setDialog(null);
          }}
        />
      )}
      {dialog === 'end' && (
        <FormModal
          title={t('volEnd')}
          onClose={() => setDialog(null)}
          submitLabel={t('volEnd')}
          fields={[
            {
              name: 'endedOn',
              label: t('volEndedOn'),
              type: 'date',
              required: true,
              defaultValue: todayIso(),
            },
            { name: 'reason', label: t('volEndReason'), required: true },
          ]}
          onSubmit={async (values) => {
            await write(`/volunteers/${v.id}/end`, {
              version: v.version,
              endedOn: values.endedOn,
              reason: values.reason,
            });
            refresh();
            setDialog(null);
          }}
        >
          <p className="form-hint">{t('volEndHint')}</p>
        </FormModal>
      )}
    </>
  );
}
