import { useBusinessDate } from '../../hooks/use-business-date';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Download } from 'lucide-react';
import {
  insuranceTypes,
  type DocumentRecord,
  type InsurancePolicy,
  type Page,
  type VolunteerSummary,
} from '@bnature/contracts';
import { api, allPages, downloadPrivateFile, errorMessage, queryClient } from '../../lib/api';
import { useSession } from '../../app/session';
import {
  Button,
  Empty,
  Field,
  Modal,
  Notice,
  PageHeading,
  formatDate,
  QueryView,
} from '../../components/ui';
import {
  CoverageBadge,
  FormModal,
  StatusTag,
  VolunteerNavigation,
  usePermission,
  usePrivateUpload,
  useVolunteerWrite,
  type FormValues,
} from './shared';

type Coverage = {
  id: string;
  engagementId: string;
  volunteerName: string;
  volunteerType: 'regular' | 'occasional';
  coveredFrom: string;
  coveredTo: string | null;
  notifiedOn: string | null;
};
type Notification = {
  id: string;
  notifiedOn: string;
  method: string;
  listSha256: string;
  personCount: number;
  proofDocumentIds: string[];
  createdByName: string | null;
};
type Overview = {
  date: string;
  items: {
    engagementId: string;
    name: string;
    volunteerType: string;
    status: 'possibly_covered' | 'assigned' | 'unclear' | 'none';
    reasons: string[];
    gaps: { type: string; from: string; to: string | null }[];
  }[];
  expiring: InsurancePolicy[];
};
const refresh = () => void queryClient.invalidateQueries();
function policyPayload(v: FormValues) {
  return {
    insurer: v.insurer,
    policyNumber: v.policyNumber,
    coverageTypes: insuranceTypes.filter((type) => v[`type_${type}`]),
    startsOn: v.startsOn,
    endsOn: v.endsOn,
    insuredGroup: v.insuredGroup,
    insuredGroupDescription: v.insuredGroupDescription,
    status: v.status,
    notes: v.notes,
  };
}
function PolicyDetail({ policy, onClose }: { policy: InsurancePolicy; onClose: () => void }) {
  const todayIso = useBusinessDate();
  const { t, i18n } = useTranslation(),
    { me } = useSession(),
    can = usePermission(),
    write = useVolunteerWrite(),
    upload = usePrivateUpload(),
    language = i18n.language === 'it' ? 'it' : 'de';
  const [error, setError] = useState(''),
    [adding, setAdding] = useState(false),
    [notifying, setNotifying] = useState(false);
  const coverages = useQuery({
    queryKey: ['policy-coverages', me.activeOrganizationId, policy.id],
    queryFn: () => api<{ items: Coverage[] }>(`/insurance-policies/${policy.id}/coverages`),
  });
  const notifications = useQuery({
    queryKey: ['policy-notifications', me.activeOrganizationId, policy.id],
    queryFn: () => api<{ items: Notification[] }>(`/insurance-policies/${policy.id}/notifications`),
  });
  const documents = useQuery({
    queryKey: ['policy-documents', me.activeOrganizationId, policy.id],
    queryFn: () => api<Page<DocumentRecord>>(`/documents?insurancePolicyId=${policy.id}`),
    enabled: can('documents:read'),
  });
  const volunteers = useQuery({
    queryKey: ['volunteer-options-all', me.activeOrganizationId],
    queryFn: () => allPages<VolunteerSummary>('/volunteers'),
    enabled: adding,
  });
  const fail = (e: unknown) =>
    setError(
      e instanceof Error && e.message.startsWith('document') ? t(e.message) : errorMessage(e),
    );
  const uploadFile = (file: File | undefined, metadata: Record<string, unknown>) => {
    if (!file) return;
    setError('');
    void upload('/documents', file, { title: file.name, filename: file.name, ...metadata }).then(
      refresh,
      fail,
    );
  };
  const download = (d: DocumentRecord) =>
    d.latestVersion &&
    void downloadPrivateFile(
      `/documents/${d.id}/versions/${d.latestVersion.id}/content`,
      d.latestVersion.filename,
    ).catch(fail);
  return (
    <Modal wide title={`${policy.insurer} · ${policy.policyNumber}`} onClose={onClose}>
      {error && <Notice error>{error}</Notice>}
      <p className="form-hint">
        {policy.coverageTypes.map((c) => t(`insurance_${c}`)).join(', ')} ·{' '}
        {formatDate(policy.startsOn, i18n.language)} – {formatDate(policy.endsOn, i18n.language)} ·{' '}
        {t('insRetainUntil')}: {formatDate(policy.retainUntil, i18n.language)}
      </p>
      <h3>{t('insDocuments')}</h3>
      <ul className="plain-list">
        {documents.data?.items.map((d) => (
          <li key={d.id}>
            {can('evidence:download') ? (
              <button type="button" className="link-button" onClick={() => download(d)}>
                {d.title}
              </button>
            ) : (
              d.title
            )}
          </li>
        ))}
        {documents.data && !documents.data.items.length && (
          <li className="muted">{t('insNoDocument')}</li>
        )}
      </ul>
      {can('insurance:write') && can('documents:write') && (
        <label className="button button-secondary file-button">
          {t('insUploadPolicy')}
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            onChange={(e) => {
              uploadFile(e.target.files?.[0], {
                category: 'insurance',
                insurancePolicyId: policy.id,
              });
              e.target.value = '';
            }}
          />
        </label>
      )}
      <h3>{t('insCoverages')}</h3>
      <QueryView query={coverages}>
        {(data) =>
          data.items.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t('volVolunteer')}</th>
                    <th>{t('insPeriod')}</th>
                    <th>{t('insNotifiedOn')}</th>
                    {can('insurance:write') && <th>{t('actions')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((c) => (
                    <tr key={c.id}>
                      <td>
                        {c.volunteerName}{' '}
                        <small className="cell-note">{t(`vol_${c.volunteerType}`)}</small>
                      </td>
                      <td>
                        {formatDate(c.coveredFrom, i18n.language)} –{' '}
                        {c.coveredTo
                          ? formatDate(c.coveredTo, i18n.language)
                          : formatDate(policy.endsOn, i18n.language)}
                      </td>
                      <td>
                        {c.notifiedOn
                          ? formatDate(c.notifiedOn, i18n.language)
                          : t('insNotNotified')}
                      </td>
                      {can('insurance:write') && (
                        <td>
                          {!c.coveredTo && (
                            <Button
                              variant="ghost"
                              onClick={() =>
                                void write(`/insurance-coverages/${c.id}/end`, {
                                  coveredTo: todayIso(),
                                  reason: t('insEndedManually'),
                                }).then(refresh, fail)
                              }
                            >
                              {t('insEndCoverage')}
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">{t('insNoCoverage')}</p>
          )
        }
      </QueryView>
      {can('insurance:write') && (
        <div className="heading-actions">
          <Button variant="secondary" onClick={() => setAdding(true)}>
            {t('insAssign')}
          </Button>
          {can('evidence:download') && (
            <>
              <Button
                variant="secondary"
                onClick={() =>
                  void downloadPrivateFile(
                    `/insurance-policies/${policy.id}/notification-list?format=csv&language=${language}`,
                    'insurer-list.csv',
                  ).catch(fail)
                }
              >
                <Download size={16} /> {t('insListCsv')}
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  void downloadPrivateFile(
                    `/insurance-policies/${policy.id}/notification-list?format=pdf&language=${language}`,
                    'insurer-list.pdf',
                  ).catch(fail)
                }
              >
                <Download size={16} /> {t('insListPdf')}
              </Button>
              <Button onClick={() => setNotifying(true)}>{t('insRecordNotification')}</Button>
            </>
          )}
        </div>
      )}
      <h3>{t('insNotifications')}</h3>
      <ul className="plain-list">
        {notifications.data?.items.map((n) => (
          <li key={n.id}>
            {formatDate(n.notifiedOn, i18n.language)} · {n.method} · {n.personCount}{' '}
            {t('insPersons')} · <code>{n.listSha256.slice(0, 12)}…</code>
            {n.proofDocumentIds.length ? ` · ${t('insProofStored')}` : ''}
            {can('insurance:write') && can('documents:write') && (
              <label className="link-button file-inline">
                {t('insUploadProof')}
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  onChange={(e) => {
                    uploadFile(e.target.files?.[0], {
                      category: 'correspondence',
                      insurerNotificationId: n.id,
                    });
                    e.target.value = '';
                  }}
                />
              </label>
            )}
          </li>
        ))}
      </ul>
      {adding && (
        <FormModal
          title={t('insAssign')}
          onClose={() => setAdding(false)}
          fields={[
            {
              name: 'coveredFrom',
              label: t('insCoveredFrom'),
              type: 'date',
              required: true,
              defaultValue: policy.startsOn > todayIso() ? policy.startsOn : todayIso(),
            },
            { name: 'coveredTo', label: t('insCoveredTo'), type: 'date' },
          ]}
          onSubmit={async (v) => {
            const form = document.querySelectorAll<HTMLInputElement>(
              'input[name="coverage-volunteer"]:checked',
            );
            const engagementIds = [...form].map((i) => i.value);
            if (!engagementIds.length) throw new Error('volChooseVolunteers');
            await write(`/insurance-policies/${policy.id}/coverages`, {
              engagementIds,
              coveredFrom: v.coveredFrom,
              coveredTo: v.coveredTo || null,
            });
            refresh();
            setAdding(false);
          }}
        >
          <fieldset className="checkbox-list">
            <legend>{t('volVolunteer')}</legend>
            {volunteers.data
              ?.filter((v) => v.status !== 'ended')
              .filter(
                (v) =>
                  policy.insuredGroup === 'all' ||
                  policy.insuredGroup === 'named' ||
                  policy.insuredGroup === v.volunteerType,
              )
              .map((v) => (
                <label key={v.id}>
                  <input type="checkbox" name="coverage-volunteer" value={v.id} /> {v.firstName}{' '}
                  {v.lastName} · {t(`vol_${v.volunteerType}`)}
                </label>
              ))}
          </fieldset>
        </FormModal>
      )}
      {notifying && (
        <FormModal
          title={t('insRecordNotification')}
          onClose={() => setNotifying(false)}
          fields={[
            {
              name: 'notifiedOn',
              label: t('insNotifiedOn'),
              type: 'date',
              required: true,
              defaultValue: todayIso(),
            },
            { name: 'method', label: t('insMethod'), required: true, hint: t('insMethodHint') },
            { name: 'notes', label: t('notes') },
          ]}
          onSubmit={async (v) => {
            const list = await api<{ sha256: string; people: { engagementId: string }[] }>(
              `/insurance-policies/${policy.id}/notification-list`,
            );
            if (!list.people.length) throw new Error('volNoCoveredPeople');
            await write('/insurer-notifications', {
              policyId: policy.id,
              notifiedOn: v.notifiedOn,
              method: v.method,
              notes: v.notes,
              engagementIds: list.people.map((p) => p.engagementId),
              listSha256: list.sha256,
            });
            refresh();
            setNotifying(false);
          }}
        >
          <p className="form-hint">{t('insNotificationHint')}</p>
        </FormModal>
      )}
    </Modal>
  );
}
export function VolunteerInsurance() {
  const todayIso = useBusinessDate();
  const { t, i18n } = useTranslation(),
    { me } = useSession(),
    can = usePermission(),
    write = useVolunteerWrite();
  const [date, setDate] = useState(todayIso()),
    [editing, setEditing] = useState<InsurancePolicy | 'new' | null>(null),
    [open, setOpen] = useState<InsurancePolicy | null>(null);
  const policies = useQuery({
    queryKey: ['insurance-policies', me.activeOrganizationId],
    queryFn: () => api<{ items: InsurancePolicy[] }>('/insurance-policies'),
  });
  const overview = useQuery({
    queryKey: ['insurance-coverage', me.activeOrganizationId, date],
    queryFn: () => api<Overview>(`/insurance-coverage?date=${date}`),
  });
  const policyFields = (p?: InsurancePolicy) => [
    { name: 'insurer', label: t('insInsurer'), required: true, defaultValue: p?.insurer },
    {
      name: 'policyNumber',
      label: t('insPolicyNumber'),
      required: true,
      defaultValue: p?.policyNumber,
    },
    ...insuranceTypes.map((type) => ({
      name: `type_${type}`,
      label: t(`insurance_${type}`),
      type: 'checkbox' as const,
      defaultValue: p ? p.coverageTypes.includes(type) : true,
    })),
    {
      name: 'startsOn',
      label: t('insStartsOn'),
      type: 'date' as const,
      required: true,
      defaultValue: p?.startsOn,
    },
    {
      name: 'endsOn',
      label: t('insEndsOn'),
      type: 'date' as const,
      required: true,
      defaultValue: p?.endsOn,
    },
    {
      name: 'insuredGroup',
      label: t('insGroup'),
      type: 'select' as const,
      defaultValue: p?.insuredGroup ?? 'all',
      options: (['all', 'regular', 'occasional', 'named'] as const).map((g) => ({
        value: g,
        label: t(`insuredGroup_${g}`),
      })),
    },
    {
      name: 'insuredGroupDescription',
      label: t('insGroupDescription'),
      defaultValue: p?.insuredGroupDescription,
    },
    {
      name: 'status',
      label: t('status'),
      type: 'select' as const,
      defaultValue: p?.status ?? 'active',
      options: (['draft', 'active', 'expired', 'cancelled'] as const).map((s) => ({
        value: s,
        label: t(`policy_${s}`),
      })),
    },
    { name: 'notes', label: t('notes'), type: 'textarea' as const, defaultValue: p?.notes },
  ];
  return (
    <>
      <PageHeading
        title={t('volInsurance')}
        description={t('insIntro')}
        actions={
          can('insurance:write') && (
            <Button onClick={() => setEditing('new')}>
              <Plus size={17} />
              {t('insAddPolicy')}
            </Button>
          )
        }
      />
      <VolunteerNavigation />
      <Notice>{t('insLegalNotice')}</Notice>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>{t('insPolicies')}</h2>
          </div>
        </div>
        <QueryView query={policies}>
          {(data) =>
            data.items.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{t('insInsurer')}</th>
                      <th>{t('insTypes')}</th>
                      <th>{t('insPeriod')}</th>
                      <th>{t('insGroup')}</th>
                      <th>{t('status')}</th>
                      <th>{t('insCoverages')}</th>
                      <th>{t('actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((p) => (
                      <tr
                        key={p.id}
                        className={
                          p.status === 'active' && p.expiresInDays >= 0 && p.expiresInDays <= 60
                            ? 'row-warning'
                            : ''
                        }
                      >
                        <td>
                          <button
                            type="button"
                            className="finance-name-link"
                            onClick={() => setOpen(p)}
                          >
                            <strong>{p.insurer}</strong>
                            <small>{p.policyNumber}</small>
                          </button>
                        </td>
                        <td>{p.coverageTypes.map((c) => t(`insurance_${c}`)).join(', ')}</td>
                        <td>
                          {formatDate(p.startsOn, i18n.language)} –{' '}
                          {formatDate(p.endsOn, i18n.language)}
                          {p.status === 'active' && p.expiresInDays >= 0 && (
                            <small className="cell-note">
                              {t('insExpiresIn', { count: p.expiresInDays })}
                            </small>
                          )}
                        </td>
                        <td>{t(`insuredGroup_${p.insuredGroup}`)}</td>
                        <td>
                          <StatusTag prefix="policy" value={p.status} />
                          {!p.documentCount && (
                            <small className="cell-note">{t('insNoDocument')}</small>
                          )}
                        </td>
                        <td className="numeric">{p.coverageCount}</td>
                        <td className="row-actions">
                          <Button variant="ghost" onClick={() => setOpen(p)}>
                            {t('insOpen')}
                          </Button>
                          {can('insurance:write') && (
                            <Button variant="ghost" onClick={() => setEditing(p)}>
                              {t('edit')}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty description={t('insEmpty')} />
            )
          }
        </QueryView>
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>{t('insCoverageCheck')}</h2>
            <p>{t('volCoverageNote')}</p>
          </div>
          <Field label={t('insReferenceDate')}>
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
          </Field>
        </div>
        <QueryView query={overview}>
          {(data) =>
            data.items.length ? (
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label={t('insCoverageCheck')}
              >
                <table>
                  <thead>
                    <tr>
                      <th>{t('volVolunteer')}</th>
                      <th>{t('volInsuranceStatus')}</th>
                      <th>{t('insFindings')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((i) => (
                      <tr key={i.engagementId}>
                        <td>
                          {i.name}{' '}
                          <small className="cell-note">{t(`vol_${i.volunteerType}`)}</small>
                        </td>
                        <td>
                          <CoverageBadge status={i.status} />
                        </td>
                        <td>
                          {i.reasons.map((r) => t(r)).join(' · ')}
                          {i.gaps.length > 0 && (
                            <small className="cell-note">
                              {t('volCoverageGaps')}:{' '}
                              {i.gaps
                                .map(
                                  (g) =>
                                    `${t(`insurance_${g.type}`)} ${formatDate(g.from, i18n.language)}–${g.to ? formatDate(g.to, i18n.language) : '…'}`,
                                )
                                .join('; ')}
                            </small>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty description={t('volEmpty')} />
            )
          }
        </QueryView>
      </section>
      {editing && (
        <FormModal
          wide
          title={t(editing === 'new' ? 'insAddPolicy' : 'edit')}
          fields={policyFields(editing === 'new' ? undefined : editing)}
          onClose={() => setEditing(null)}
          onSubmit={async (v) => {
            const body = policyPayload(v);
            if (!body.coverageTypes.length) throw new Error('volChooseInsuranceType');
            if (editing === 'new') await write('/insurance-policies', body);
            else
              await write(
                `/insurance-policies/${editing.id}`,
                { ...body, version: editing.version },
                'PATCH',
              );
            refresh();
            setEditing(null);
          }}
        />
      )}
      {open && <PolicyDetail policy={open} onClose={() => setOpen(null)} />}
    </>
  );
}
