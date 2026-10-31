import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw } from 'lucide-react';
import { roles, type ComplianceDeadline, type ComplianceRule, type Page } from '@bnature/contracts';
import { api, errorMessage, queryClient } from '../lib/api';
import { useSession } from '../app/session';
import {
  Button,
  Empty,
  Field,
  Modal,
  Notice,
  PageHeading,
  Pagination,
  formatDate,
  QueryView,
} from '../components/ui';
import {
  FormModal,
  StatusTag,
  todayIso,
  usePermission,
  usePrivateUpload,
  useVolunteerWrite,
} from './volunteers/shared';

const refresh = () => void queryClient.invalidateQueries();
function KindBadge({ kind }: { kind: ComplianceDeadline['kind'] }) {
  const { t } = useTranslation();
  return (
    <span className={`badge badge-kind-${kind}`}>
      <span />
      {t(`complianceKind_${kind}`)}
    </span>
  );
}
function DeadlineDialog({
  deadline: initial,
  onClose,
}: {
  deadline: ComplianceDeadline;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation(),
    can = usePermission(),
    write = useVolunteerWrite(),
    upload = usePrivateUpload(),
    language = i18n.language === 'it' ? 'it' : 'de';
  const [error, setError] = useState(''),
    [mode, setMode] = useState<'complete' | 'evidence' | 'status' | null>(null),
    // Evidence keeps the dialog open; the server response is the current state.
    [deadline, setDeadline] = useState(initial);
  const editable = can('compliance:write') && !['done', 'not_applicable'].includes(deadline.status);
  const fail = (e: unknown) =>
    setError(
      e instanceof Error && e.message.startsWith('document') ? t(e.message) : errorMessage(e),
    );
  const after = () => {
    refresh();
    onClose();
  };
  const updated = (next: ComplianceDeadline) => {
    setDeadline(next);
    setMode(null);
    refresh();
  };
  return (
    <Modal wide title={deadline.titleI18n[language]} onClose={onClose}>
      {error && <Notice error>{error}</Notice>}
      <div className="deadline-meta">
        <KindBadge kind={deadline.kind} />
        <StatusTag prefix="deadline" value={deadline.status} />
        <span>
          {t('cmpDue')}: <strong>{formatDate(deadline.dueDate, i18n.language)}</strong>
        </span>
        {deadline.overdue && <span className="error-text">{t('cmpOverdue')}</span>}
      </div>
      <p>{deadline.descriptionI18n[language]}</p>
      <dl className="detail-list">
        <dt>{t('cmpLegalBasis')}</dt>
        <dd>{deadline.legalBasis || t('cmpInternalRule')}</dd>
        <dt>{t('cmpResponsible')}</dt>
        <dd>
          {deadline.responsibleName ??
            (deadline.responsibleRole ? t(deadline.responsibleRole) : '—')}
        </dd>
        {deadline.sourceLabel && (
          <>
            <dt>{t('cmpSource')}</dt>
            <dd>{deadline.sourceLabel}</dd>
          </>
        )}
        <dt>{t('cmpReminders')}</dt>
        <dd>
          {deadline.reminderDays.map((d) => t('cmpDaysBefore', { count: d })).join(', ') || '—'}
          {deadline.nextReminder &&
            ` · ${t('cmpNextReminder')}: ${formatDate(deadline.nextReminder, i18n.language)}`}
        </dd>
        {deadline.completedOn && (
          <>
            <dt>{t('cmpCompletedOn')}</dt>
            <dd>
              {formatDate(deadline.completedOn, i18n.language)}{' '}
              {deadline.protocolNumber && `· ${t('cmpProtocol')} ${deadline.protocolNumber}`}
            </dd>
          </>
        )}
      </dl>
      <h3>{t('cmpEvidence')}</h3>
      <ul className="plain-list">
        {deadline.evidence.map((e) => (
          <li key={e.id}>
            {e.documentTitle ?? e.reference} {e.description && `· ${e.description}`} ·{' '}
            {e.createdByName ?? '—'}
          </li>
        ))}
        {!deadline.evidence.length && <li className="muted">{t('cmpNoEvidence')}</li>}
      </ul>
      {editable && (
        <div className="heading-actions">
          <Button variant="secondary" onClick={() => setMode('evidence')}>
            {t('cmpAddEvidence')}
          </Button>
          {can('documents:write') && (
            <label className="button button-secondary file-button">
              {t('cmpUploadEvidence')}
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  setError('');
                  void upload<{ id: string }>('/documents', file, {
                    title: file.name,
                    category: 'correspondence',
                    complianceDeadlineId: deadline.id,
                    filename: file.name,
                  })
                    .then((doc) =>
                      write<ComplianceDeadline>(`/compliance-deadlines/${deadline.id}/evidence`, {
                        documentId: doc.id,
                        description: file.name,
                      }),
                    )
                    .then(updated, fail);
                }}
              />
            </label>
          )}
          <Button variant="secondary" onClick={() => setMode('status')}>
            {t('cmpChangeStatus')}
          </Button>
          <Button disabled={!deadline.evidence.length} onClick={() => setMode('complete')}>
            {t('cmpComplete')}
          </Button>
        </div>
      )}
      {editable && !deadline.evidence.length && (
        <p className="form-hint">{t('cmpEvidenceRequired')}</p>
      )}
      <h3>{t('volHistory')}</h3>
      <ol className="history-list">
        {deadline.history.map((h, i) => (
          <li key={i}>
            <strong>{t(`cmpHistory_${h.action}`)}</strong> ·{' '}
            {formatDate(h.createdAt, i18n.language)} · {h.actorName ?? '—'}
            {h.note && <small>{h.note}</small>}
          </li>
        ))}
      </ol>
      {mode === 'evidence' && (
        <FormModal
          title={t('cmpAddEvidence')}
          onClose={() => setMode(null)}
          fields={[
            {
              name: 'reference',
              label: t('cmpReference'),
              required: true,
              hint: t('cmpReferenceHint'),
            },
            { name: 'description', label: t('description') },
          ]}
          onSubmit={async (v) => {
            updated(
              await write<ComplianceDeadline>(`/compliance-deadlines/${deadline.id}/evidence`, {
                reference: v.reference,
                description: v.description,
              }),
            );
          }}
        />
      )}
      {mode === 'complete' && (
        <FormModal
          title={t('cmpComplete')}
          onClose={() => setMode(null)}
          fields={[
            {
              name: 'completedOn',
              label: t('cmpCompletedOn'),
              type: 'date',
              required: true,
              defaultValue: todayIso(),
            },
            { name: 'protocolNumber', label: t('cmpProtocol') },
            { name: 'note', label: t('notes') },
          ]}
          onSubmit={async (v) => {
            await write(`/compliance-deadlines/${deadline.id}/complete`, {
              version: deadline.version,
              ...v,
            });
            after();
          }}
        >
          <p className="form-hint">{t('cmpManualSubmission')}</p>
        </FormModal>
      )}
      {mode === 'status' && (
        <FormModal
          title={t('cmpChangeStatus')}
          onClose={() => setMode(null)}
          fields={[
            {
              name: 'status',
              label: t('status'),
              type: 'select',
              defaultValue: deadline.status,
              options: (['open', 'in_progress', 'not_applicable'] as const).map((s) => ({
                value: s,
                label: t(`deadline_${s}`),
              })),
            },
            { name: 'dueDate', label: t('cmpDue'), type: 'date', defaultValue: deadline.dueDate },
            { name: 'note', label: t('cmpNote'), hint: t('cmpNoteHint') },
          ]}
          onSubmit={async (v) => {
            await write(
              `/compliance-deadlines/${deadline.id}`,
              { version: deadline.version, status: v.status, dueDate: v.dueDate, note: v.note },
              'PATCH',
            );
            after();
          }}
        />
      )}
    </Modal>
  );
}
function Rules() {
  const { t, i18n } = useTranslation(),
    { me } = useSession(),
    can = usePermission(),
    write = useVolunteerWrite(),
    language = i18n.language === 'it' ? 'it' : 'de';
  const [versioning, setVersioning] = useState<ComplianceRule | 'new' | null>(null),
    [error, setError] = useState('');
  const rules = useQuery({
    queryKey: ['compliance-rules', me.activeOrganizationId],
    queryFn: () => api<{ items: ComplianceRule[] }>('/compliance-rules'),
  });
  const calc = (r: ComplianceRule) => {
    const c = r.calculation as { basis: string; offsetDays: number; month?: number; day?: number };
    return `${t(`basis_${c.basis}`)}${c.basis === 'annual_date' ? ` ${c.day}.${c.month}.` : ''} ${c.offsetDays >= 0 ? '+' : ''}${c.offsetDays} ${t('cmpDays')}`;
  };
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>{t('cmpRules')}</h2>
          <p>{t('cmpRulesIntro')}</p>
        </div>
        {can('compliance:write') && (
          <div className="heading-actions">
            <Button
              variant="secondary"
              onClick={() =>
                void write('/compliance-rules/initialize', {}).then(refresh, (e) =>
                  setError(errorMessage(e)),
                )
              }
            >
              {t('cmpInitialize')}
            </Button>
            <Button variant="secondary" onClick={() => setVersioning('new')}>
              <Plus size={16} /> {t('cmpNewRule')}
            </Button>
          </div>
        )}
      </div>
      {error && <Notice error>{error}</Notice>}
      <QueryView query={rules}>
        {(data) =>
          data.items.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t('cmpRule')}</th>
                    <th>{t('cmpKind')}</th>
                    <th>{t('cmpCalculation')}</th>
                    <th>{t('cmpLegalBasis')}</th>
                    <th>{t('cmpValidity')}</th>
                    {can('compliance:write') && <th>{t('actions')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id} className={r.validTo ? 'row-muted' : ''}>
                      <td>
                        <strong>{r.titleI18n[language]}</strong>
                        <small className="cell-note">
                          {r.ruleKey} · v{r.version}
                          {r.reviewNote && ` · ${t('cmpReviewRequired')}`}
                        </small>
                      </td>
                      <td>
                        <KindBadge kind={r.kind} />
                      </td>
                      <td>{calc(r)}</td>
                      <td>
                        {r.legalBasis || '—'}
                        {r.sourceUrl && (
                          <small className="cell-note">
                            <a href={r.sourceUrl} target="_blank" rel="noreferrer noopener">
                              {t('cmpOfficialSource')}
                            </a>
                          </small>
                        )}
                      </td>
                      <td>
                        {formatDate(r.validFrom, i18n.language)} –{' '}
                        {r.validTo ? formatDate(r.validTo, i18n.language) : t('ongoing')}
                        {!r.active && <small className="cell-note">{t('inactive')}</small>}
                      </td>
                      {can('compliance:write') && (
                        <td className="row-actions">
                          {!r.validTo && (
                            <>
                              <Button variant="ghost" onClick={() => setVersioning(r)}>
                                {t('cmpNewVersion')}
                              </Button>
                              <Button
                                variant="ghost"
                                onClick={() =>
                                  void write(
                                    `/compliance-rules/${r.id}`,
                                    { active: !r.active, reviewNote: r.reviewNote },
                                    'PATCH',
                                  ).then(refresh, (e) => setError(errorMessage(e)))
                                }
                              >
                                {t(r.active ? 'cmpDeactivate' : 'cmpActivate')}
                              </Button>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty description={t('cmpNoRules')} />
          )
        }
      </QueryView>
      {versioning && (
        <FormModal
          wide
          title={t(versioning === 'new' ? 'cmpNewRule' : 'cmpNewVersion')}
          onClose={() => setVersioning(null)}
          fields={(() => {
            const r = versioning === 'new' ? undefined : versioning;
            const c = (r?.calculation ?? { basis: 'manual', offsetDays: 0 }) as {
              basis: string;
              offsetDays: number;
              month?: number;
              day?: number;
            };
            return [
              {
                name: 'ruleKey',
                label: t('cmpRuleKey'),
                required: true,
                defaultValue: r?.ruleKey ?? '',
                hint: t('cmpRuleKeyHint'),
              },
              {
                name: 'kind',
                label: t('cmpKind'),
                type: 'select' as const,
                defaultValue: r?.kind ?? 'internal',
                options: (['legal', 'recommendation', 'internal'] as const).map((k) => ({
                  value: k,
                  label: t(`complianceKind_${k}`),
                })),
              },
              {
                name: 'topic',
                label: t('cmpTopic'),
                type: 'select' as const,
                defaultValue: r?.topic ?? 'custom',
                options: (
                  [
                    'runts_annual_report',
                    'organ_change',
                    'association_data',
                    'board_term',
                    'insurance',
                    'register_snapshot',
                    'document_review',
                    'custom',
                  ] as const
                ).map((k) => ({ value: k, label: t(`topic_${k}`) })),
              },
              {
                name: 'titleDe',
                label: `${t('cmpTitle')} (DE)`,
                required: true,
                defaultValue: r?.titleI18n.de,
              },
              {
                name: 'titleIt',
                label: `${t('cmpTitle')} (IT)`,
                required: true,
                defaultValue: r?.titleI18n.it,
              },
              {
                name: 'descriptionDe',
                label: `${t('description')} (DE)`,
                type: 'textarea' as const,
                required: true,
                defaultValue: r?.descriptionI18n.de,
              },
              {
                name: 'descriptionIt',
                label: `${t('description')} (IT)`,
                type: 'textarea' as const,
                required: true,
                defaultValue: r?.descriptionI18n.it,
              },
              { name: 'legalBasis', label: t('cmpLegalBasis'), defaultValue: r?.legalBasis },
              { name: 'sourceUrl', label: t('cmpSourceUrl'), defaultValue: r?.sourceUrl },
              {
                name: 'responsibleRole',
                label: t('cmpResponsible'),
                type: 'select' as const,
                defaultValue: r?.responsibleRole ?? '',
                options: [
                  { value: '', label: '—' },
                  ...roles.map((role) => ({ value: role, label: t(role) })),
                ],
              },
              {
                name: 'basis',
                label: t('cmpBasis'),
                type: 'select' as const,
                defaultValue: c.basis,
                options: (
                  [
                    'manual',
                    'fiscal_year_end',
                    'annual_date',
                    'board_change',
                    'board_mandate_end',
                    'policy_end',
                    'last_register_snapshot',
                  ] as const
                ).map((b) => ({
                  value: b,
                  label: t(`basis_${b}`),
                })),
              },
              {
                name: 'offsetDays',
                label: t('cmpOffset'),
                type: 'number' as const,
                defaultValue: c.offsetDays,
                min: -730,
                max: 730,
              },
              {
                name: 'month',
                label: t('cmpMonth'),
                type: 'number' as const,
                defaultValue: c.month ?? '',
                min: 1,
                max: 12,
              },
              {
                name: 'day',
                label: t('cmpDay'),
                type: 'number' as const,
                defaultValue: c.day ?? '',
                min: 1,
                max: 31,
              },
              {
                name: 'reminderDays',
                label: t('cmpReminders'),
                defaultValue: (r?.reminderDays ?? [30, 7]).join(', '),
                hint: t('cmpRemindersHint'),
              },
              {
                name: 'validFrom',
                label: t('cmpValidFrom'),
                type: 'date' as const,
                required: true,
                defaultValue: todayIso(),
              },
            ];
          })()}
          onSubmit={async (v) => {
            await write('/compliance-rules', {
              ruleKey: v.ruleKey,
              kind: v.kind,
              topic: v.topic,
              titleI18n: { de: v.titleDe, it: v.titleIt },
              descriptionI18n: { de: v.descriptionDe, it: v.descriptionIt },
              legalBasis: v.legalBasis,
              sourceUrl: v.sourceUrl,
              responsibleRole: v.responsibleRole || null,
              calculation: {
                basis: v.basis,
                offsetDays: Number(v.offsetDays || 0),
                ...(v.basis === 'annual_date'
                  ? { month: Number(v.month), day: Number(v.day) }
                  : {}),
              },
              reminderDays: String(v.reminderDays)
                .split(',')
                .map((d) => Number(d.trim()))
                .filter((d) => Number.isInteger(d) && d >= 0),
              validFrom: v.validFrom,
            });
            refresh();
            setVersioning(null);
          }}
        />
      )}
    </section>
  );
}
export function Compliance() {
  const { t, i18n } = useTranslation(),
    { me } = useSession(),
    can = usePermission(),
    write = useVolunteerWrite(),
    language = i18n.language === 'it' ? 'it' : 'de';
  const [tab, setTab] = useState<'deadlines' | 'rules'>('deadlines'),
    [status, setStatus] = useState('open'),
    [kind, setKind] = useState(''),
    [page, setPage] = useState(1),
    [open, setOpen] = useState<ComplianceDeadline | null>(null),
    [dialog, setDialog] = useState<'generate' | 'new' | null>(null),
    [message, setMessage] = useState('');
  const query = useQuery({
    queryKey: ['compliance-deadlines', me.activeOrganizationId, status, kind, page],
    queryFn: () =>
      api<Page<ComplianceDeadline>>(
        `/compliance-deadlines?page=${page}${status ? `&status=${status}` : ''}${kind ? `&kind=${kind}` : ''}`,
      ),
    enabled: tab === 'deadlines',
  });
  const year = new Date().getFullYear();
  return (
    <>
      <PageHeading
        title={t('compliance')}
        description={t('cmpIntro')}
        actions={
          can('compliance:write') &&
          tab === 'deadlines' && (
            <>
              <Button variant="secondary" onClick={() => setDialog('generate')}>
                <RefreshCw size={16} /> {t('cmpGenerate')}
              </Button>
              <Button onClick={() => setDialog('new')}>
                <Plus size={17} /> {t('cmpNewDeadline')}
              </Button>
            </>
          )
        }
      />
      <Notice>{t('cmpLegalNotice')}</Notice>
      {message && <Notice>{message}</Notice>}
      <section className="panel">
        <div className="finance-tabs" role="tablist" aria-label={t('compliance')}>
          {(['deadlines', 'rules'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={tab === v}
              onClick={() => setTab(v)}
            >
              {t(v === 'deadlines' ? 'cmpDeadlines' : 'cmpRules')}
            </button>
          ))}
        </div>
        {tab === 'deadlines' && (
          <>
            <div className="toolbar event-filters">
              <Field label={t('status')}>
                <select
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">{t('all')}</option>
                  {(['open', 'in_progress', 'done', 'not_applicable'] as const).map((s) => (
                    <option key={s} value={s}>
                      {t(`deadline_${s}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('cmpKind')}>
                <select
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">{t('all')}</option>
                  {(['legal', 'recommendation', 'internal'] as const).map((k) => (
                    <option key={k} value={k}>
                      {t(`complianceKind_${k}`)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <QueryView query={query}>
              {(data) =>
                data.items.length ? (
                  <>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>{t('cmpDue')}</th>
                            <th>{t('cmpObligation')}</th>
                            <th>{t('cmpKind')}</th>
                            <th>{t('cmpResponsible')}</th>
                            <th>{t('status')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.items.map((d) => (
                            <tr key={d.id} className={d.overdue ? 'row-warning' : ''}>
                              <td>
                                {formatDate(d.dueDate, i18n.language)}
                                {d.overdue && (
                                  <small className="cell-note error-text">{t('cmpOverdue')}</small>
                                )}
                                {d.nextReminder && (
                                  <small className="cell-note">
                                    {t('cmpNextReminder')}:{' '}
                                    {formatDate(d.nextReminder, i18n.language)}
                                  </small>
                                )}
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="finance-name-link"
                                  onClick={() => setOpen(d)}
                                >
                                  <strong>{d.titleI18n[language]}</strong>
                                  <small>{d.sourceLabel || d.legalBasis}</small>
                                </button>
                              </td>
                              <td>
                                <KindBadge kind={d.kind} />
                              </td>
                              <td>
                                {d.responsibleName ??
                                  (d.responsibleRole ? t(d.responsibleRole) : '—')}
                              </td>
                              <td>
                                <StatusTag prefix="deadline" value={d.status} />
                                {d.evidence.length > 0 && (
                                  <small className="cell-note">
                                    {t('cmpEvidenceCount', { count: d.evidence.length })}
                                  </small>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Pagination
                      page={page}
                      pageSize={data.pageSize}
                      total={data.total}
                      onChange={setPage}
                    />
                  </>
                ) : (
                  <Empty description={t('cmpEmpty')} />
                )
              }
            </QueryView>
          </>
        )}
      </section>
      {tab === 'rules' && <Rules />}
      {open && <DeadlineDialog deadline={open} onClose={() => setOpen(null)} />}
      {dialog === 'generate' && (
        <FormModal
          title={t('cmpGenerate')}
          onClose={() => setDialog(null)}
          fields={[
            {
              name: 'from',
              label: t('from'),
              type: 'date',
              required: true,
              defaultValue: `${year}-01-01`,
            },
            {
              name: 'to',
              label: t('to'),
              type: 'date',
              required: true,
              defaultValue: `${year + 1}-12-31`,
            },
          ]}
          onSubmit={async (v) => {
            const result = await write<{ created: number; existing: number }>(
              '/compliance-deadlines/generate',
              { from: v.from, to: v.to },
            );
            setMessage(t('cmpGenerated', { created: result.created, existing: result.existing }));
            refresh();
            setDialog(null);
          }}
        >
          <p className="form-hint">{t('cmpGenerateHint')}</p>
        </FormModal>
      )}
      {dialog === 'new' && (
        <FormModal
          wide
          title={t('cmpNewDeadline')}
          onClose={() => setDialog(null)}
          fields={[
            {
              name: 'kind',
              label: t('cmpKind'),
              type: 'select',
              defaultValue: 'internal',
              options: (['internal', 'recommendation', 'legal'] as const).map((k) => ({
                value: k,
                label: t(`complianceKind_${k}`),
              })),
            },
            { name: 'titleDe', label: `${t('cmpTitle')} (DE)`, required: true },
            { name: 'titleIt', label: `${t('cmpTitle')} (IT)`, required: true },
            { name: 'descriptionDe', label: `${t('description')} (DE)`, type: 'textarea' },
            { name: 'descriptionIt', label: `${t('description')} (IT)`, type: 'textarea' },
            { name: 'legalBasis', label: t('cmpLegalBasis'), hint: t('cmpLegalBasisHint') },
            {
              name: 'responsibleRole',
              label: t('cmpResponsible'),
              type: 'select',
              options: [
                { value: '', label: '—' },
                ...roles.map((role) => ({ value: role, label: t(role) })),
              ],
            },
            { name: 'dueDate', label: t('cmpDue'), type: 'date', required: true },
          ]}
          onSubmit={async (v) => {
            await write('/compliance-deadlines', {
              kind: v.kind,
              titleI18n: { de: v.titleDe, it: v.titleIt },
              descriptionI18n: { de: v.descriptionDe, it: v.descriptionIt },
              legalBasis: v.legalBasis,
              responsibleRole: v.responsibleRole || null,
              dueDate: v.dueDate,
            });
            refresh();
            setDialog(null);
          }}
        />
      )}
    </>
  );
}
