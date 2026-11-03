import { useBusinessDate } from '../../hooks/use-business-date';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, ShieldCheck } from 'lucide-react';
import type { RegisterEntry, RegisterSettings, RegisterSnapshot } from '@bnature/contracts';
import { api, downloadPrivateFile, errorMessage, queryClient } from '../../lib/api';
import { useSession } from '../../app/session';
import {
  Button,
  Empty,
  Field,
  Notice,
  PageHeading,
  formatDate,
  QueryView,
} from '../../components/ui';
import {
  FormModal,
  VolunteerNavigation,
  dateTime,
  usePermission,
  usePrivateUpload,
  useVolunteerWrite,
} from './shared';

type Pending = {
  engagementId: string;
  name: string;
  section: string;
  action: 'admission' | 'exit' | 'correction';
  issues: string[];
  correctsEntryId: string | null;
};
type View = {
  section: 'main' | 'occasional';
  current: { engagementId: string; entryNumber: number; data: RegisterEntry['data'] }[];
  entries: RegisterEntry[];
  pending: Pending[];
};
type Validation = {
  ready: boolean;
  pending: Pending[];
  invalid: { name: string; issues: string[] }[];
  mainCount: number;
  occasionalCount: number;
};
const refresh = () => void queryClient.invalidateQueries();
const person = (d: RegisterEntry['data']) =>
  `${d.lastName} ${d.firstName}${d.fiscalCode ? ` · ${d.fiscalCode}` : d.dateOfBirth ? ` · ${d.dateOfBirth} ${d.birthPlace}` : ''}`;
function SnapshotStatus({ snapshot }: { snapshot: RegisterSnapshot }) {
  const { t } = useTranslation();
  return (
    <span className={`badge badge-snapshot-${snapshot.status}`}>
      <span />
      {t(`snapshot_${snapshot.status}`)}
    </span>
  );
}
function Snapshots() {
  const todayIso = useBusinessDate();
  const { t, i18n } = useTranslation(),
    { me } = useSession(),
    can = usePermission(),
    write = useVolunteerWrite(),
    upload = usePrivateUpload();
  const [cutoff, setCutoff] = useState(todayIso()),
    [validation, setValidation] = useState<Validation | null>(null),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [verifying, setVerifying] = useState<RegisterSnapshot | null>(null);
  const snapshots = useQuery({
    queryKey: ['register-snapshots', me.activeOrganizationId],
    queryFn: () =>
      api<{ items: RegisterSnapshot[]; provider: { id: string; qualified: boolean } }>(
        '/register-snapshots',
      ),
  });
  const fail = (e: unknown) =>
    setError(
      e instanceof Error && e.message.startsWith('document') ? t(e.message) : errorMessage(e),
    );
  const file = (s: RegisterSnapshot, kind: 'snapshot' | 'signed' | 'timestamp') =>
    void downloadPrivateFile(
      `/register-snapshots/${s.id}/files/${kind}`,
      `register-${s.snapshotNumber}-${kind}${kind === 'timestamp' ? '.tsr' : '.pdf'}`,
    ).catch(fail);
  const importFile = (s: RegisterSnapshot, kind: 'signed' | 'timestamp', f: File | undefined) => {
    if (!f) return;
    const lower = f.name.toLowerCase();
    const type = lower.endsWith('.p7m')
      ? 'application/pkcs7-mime'
      : lower.endsWith('.tsr') || lower.endsWith('.tsd')
        ? 'application/timestamp-reply'
        : lower.endsWith('.pdf')
          ? 'application/pdf'
          : undefined;
    setError('');
    void upload(
      `/register-snapshots/${s.id}/signature-files`,
      f,
      { kind, filename: f.name },
      type,
    ).then(refresh, fail);
  };
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>{t('regSnapshots')}</h2>
          <p>{t('regSnapshotsIntro')}</p>
        </div>
      </div>
      {error && <Notice error>{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      {can('register:finalize') && (
        <div className="toolbar">
          <Field label={t('regCutoff')}>
            <input
              type="date"
              value={cutoff}
              max={todayIso()}
              onChange={(e) => {
                setCutoff(e.target.value);
                setValidation(null);
              }}
            />
          </Field>
          <Button
            variant="secondary"
            onClick={() =>
              void api<Validation>(`/register-snapshots/validation?cutoffDate=${cutoff}`).then(
                setValidation,
                fail,
              )
            }
          >
            {t('regValidate')}
          </Button>
          <Button
            disabled={!validation?.ready}
            onClick={() => {
              setError('');
              void write('/register-snapshots', { cutoffDate: cutoff }).then(() => {
                setValidation(null);
                refresh();
              }, fail);
            }}
          >
            {t('regFinalize')}
          </Button>
        </div>
      )}
      {validation && (
        <Notice error={!validation.ready}>
          {validation.ready
            ? t('regReady', { main: validation.mainCount, occasional: validation.occasionalCount })
            : `${t('regNotReady')} ${validation.pending.map((p) => `${p.name} (${t(`regAction_${p.action}`)})`).join(', ')}`}
          {validation.invalid.length > 0 &&
            ` · ${validation.invalid.map((i) => `${i.name}: ${i.issues.map((x) => t(x)).join(' ')}`).join('; ')}`}
        </Notice>
      )}
      <QueryView query={snapshots}>
        {(data) =>
          data.items.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t('regSnapshot')}</th>
                    <th>{t('regCounts')}</th>
                    <th>SHA-256</th>
                    <th>{t('status')}</th>
                    <th>{t('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong>#{s.snapshotNumber}</strong> ·{' '}
                        {formatDate(s.cutoffDate, i18n.language)}
                        <small className="cell-note">
                          {dateTime(s.createdAt, i18n.language)} · {s.createdByName ?? '—'}
                        </small>
                      </td>
                      <td>
                        {s.mainCount} / {s.occasionalCount}
                      </td>
                      <td>
                        <code title={s.sha256}>{s.sha256.slice(0, 16)}…</code>
                        {s.previousSha256 && (
                          <small className="cell-note">← {s.previousSha256.slice(0, 10)}…</small>
                        )}
                      </td>
                      <td>
                        <SnapshotStatus snapshot={s} />
                        {s.status !== 'signature_pending' &&
                          s.technicalChecks.signed !== undefined && (
                            <small className="cell-note">
                              {t('regTechnicalCheck')}:{' '}
                              {(s.technicalChecks.signed as { preservesSnapshot?: boolean })
                                .preservesSnapshot
                                ? t('regContentMatches')
                                : t('regContentMismatch')}
                            </small>
                          )}
                        <small className="cell-note">
                          {t(
                            s.legallyApproved ? 'regProcedureApproved' : 'regProcedureNotApproved',
                          )}
                        </small>
                      </td>
                      <td className="row-actions">
                        {can('evidence:download') && (
                          <>
                            <Button variant="ghost" onClick={() => file(s, 'snapshot')}>
                              <Download size={15} /> PDF
                            </Button>
                            {s.signedDocumentId && (
                              <Button variant="ghost" onClick={() => file(s, 'signed')}>
                                <Download size={15} /> {t('regSigned')}
                              </Button>
                            )}
                            {s.timestampDocumentId && (
                              <Button variant="ghost" onClick={() => file(s, 'timestamp')}>
                                <Download size={15} /> {t('regTimestamp')}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              onClick={() =>
                                void api<{ reproducible: boolean; archivedFileIntact: boolean }>(
                                  `/register-snapshots/${s.id}/integrity`,
                                ).then(
                                  (r) =>
                                    setMessage(
                                      t(
                                        r.reproducible && r.archivedFileIntact
                                          ? 'regIntegrityOk'
                                          : 'regIntegrityFailed',
                                        { number: s.snapshotNumber },
                                      ),
                                    ),
                                  fail,
                                )
                              }
                            >
                              <ShieldCheck size={15} /> {t('regIntegrity')}
                            </Button>
                          </>
                        )}
                        {can('register:finalize') && s.status !== 'verified' && (
                          <>
                            {(!s.signedDocumentId || s.status === 'verification_failed') && (
                              <label className="button button-ghost file-button">
                                {t('regImportSigned')}
                                <input
                                  type="file"
                                  accept=".pdf,.p7m,application/pdf,application/pkcs7-mime"
                                  onChange={(e) => {
                                    importFile(s, 'signed', e.target.files?.[0]);
                                    e.target.value = '';
                                  }}
                                />
                              </label>
                            )}
                            <label className="button button-ghost file-button">
                              {t('regImportTimestamp')}
                              <input
                                type="file"
                                accept=".tsr,.tsd,.p7m"
                                onChange={(e) => {
                                  importFile(s, 'timestamp', e.target.files?.[0]);
                                  e.target.value = '';
                                }}
                              />
                            </label>
                            {s.status === 'signature_imported' && (
                              <Button variant="ghost" onClick={() => setVerifying(s)}>
                                {t('regRecordVerification')}
                              </Button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty description={t('regNoSnapshots')} />
          )
        }
      </QueryView>
      <p className="form-hint">{t('regSignatureNotice')}</p>
      {verifying && (
        <FormModal
          title={t('regRecordVerification')}
          onClose={() => setVerifying(null)}
          fields={[
            {
              name: 'result',
              label: t('regResult'),
              type: 'select',
              options: [
                { value: 'verified', label: t('snapshot_verified') },
                { value: 'verification_failed', label: t('snapshot_verification_failed') },
              ],
            },
            { name: 'tool', label: t('regTool'), required: true, hint: t('regToolHint') },
            { name: 'signer', label: t('regSigner') },
            { name: 'timestampTime', label: t('regTimestampTime'), type: 'datetime-local' },
            { name: 'notes', label: t('notes'), type: 'textarea' },
          ]}
          onSubmit={async (v) => {
            await write(`/register-snapshots/${verifying.id}/verification`, {
              version: verifying.version,
              result: v.result,
              tool: v.tool,
              signer: v.signer,
              timestampTime: v.timestampTime
                ? new Date(String(v.timestampTime)).toISOString()
                : null,
              notes: v.notes,
            });
            refresh();
            setVerifying(null);
          }}
        >
          <Notice>{t('regVerificationNotice')}</Notice>
        </FormModal>
      )}
    </section>
  );
}
function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(),
    { me } = useSession(),
    write = useVolunteerWrite();
  const settings = useQuery({
    queryKey: ['register-settings', me.activeOrganizationId],
    queryFn: () => api<RegisterSettings & { version: number }>('/volunteer-register/settings'),
  });
  if (!settings.data) return null;
  const s = settings.data,
    admin = me.role === 'admin';
  return (
    <FormModal
      wide
      title={t('regSettings')}
      onClose={onClose}
      fields={[
        {
          name: 'occasionalSection',
          label: t('regOccasionalSection'),
          type: 'checkbox',
          defaultValue: s.occasionalSection,
        },
        {
          name: 'signatureIntervalDays',
          label: t('regInterval'),
          type: 'number',
          min: 1,
          max: 366,
          defaultValue: s.signatureIntervalDays,
        },
        {
          name: 'signatureProcedure',
          label: t('regProcedure'),
          type: 'textarea',
          defaultValue: s.signatureProcedure,
          hint: t('regProcedureHint'),
        },
        {
          name: 'insuranceRetentionYears',
          label: t('regInsuranceRetention'),
          type: 'number',
          min: 10,
          defaultValue: s.insuranceRetentionYears,
        },
        {
          name: 'registerRetentionYears',
          label: t('regRegisterRetention'),
          type: 'number',
          min: 10,
          defaultValue: s.registerRetentionYears,
        },
        {
          name: 'expiryWarningDays',
          label: t('regExpiryWarning'),
          type: 'number',
          min: 1,
          max: 365,
          defaultValue: s.expiryWarningDays,
        },
        ...(admin
          ? [
              {
                name: 'legalApprovalReference',
                label: t('regApprovalReference'),
                defaultValue: s.legalApprovalReference,
              },
              {
                name: 'legalApprovedOn',
                label: t('regApprovedOn'),
                type: 'date' as const,
                defaultValue: s.legalApprovedOn ?? '',
              },
            ]
          : []),
      ]}
      onSubmit={async (v) => {
        await write(
          '/volunteer-register/settings',
          {
            version: s.version,
            occasionalSection: v.occasionalSection,
            signatureIntervalDays: Number(v.signatureIntervalDays),
            signatureProcedure: v.signatureProcedure,
            insuranceRetentionYears: Number(v.insuranceRetentionYears),
            registerRetentionYears: Number(v.registerRetentionYears),
            expiryWarningDays: Number(v.expiryWarningDays),
            ...(admin
              ? {
                  legalApprovalReference: v.legalApprovalReference,
                  legalApprovedOn: v.legalApprovedOn || null,
                }
              : {}),
          },
          'PATCH',
        );
        refresh();
        onClose();
      }}
    >
      <Notice>{t('regApprovalNotice')}</Notice>
    </FormModal>
  );
}
export function VolunteerRegister() {
  const { t, i18n } = useTranslation(),
    { me } = useSession(),
    can = usePermission(),
    write = useVolunteerWrite();
  const [section, setSection] = useState<'main' | 'occasional'>('main'),
    [error, setError] = useState(''),
    [correcting, setCorrecting] = useState<Pending | null>(null),
    [settings, setSettings] = useState(false);
  const view = useQuery({
    queryKey: ['volunteer-register', me.activeOrganizationId, section],
    queryFn: () => api<View>(`/volunteer-register?section=${section}`),
  });
  const chain = useQuery({
    queryKey: ['volunteer-register-chain', me.activeOrganizationId],
    queryFn: () =>
      api<Record<string, { valid: boolean; entries: number }>>('/volunteer-register/verify'),
  });
  const record = (p: Pending, reason = '') => {
    setError('');
    void write('/volunteer-register/entries', {
      engagementId: p.engagementId,
      entryType: p.action,
      reason,
      correctsEntryId: p.correctsEntryId,
    }).then(refresh, (e) => setError(errorMessage(e)));
  };
  return (
    <>
      <PageHeading
        title={t('volRegister')}
        description={t('regIntro')}
        actions={
          can('register:finalize') && (
            <Button variant="secondary" onClick={() => setSettings(true)}>
              {t('regSettings')}
            </Button>
          )
        }
      />
      <VolunteerNavigation />
      <Notice>{t('regLegalNotice')}</Notice>
      {error && <Notice error>{error}</Notice>}
      <section className="panel">
        <div className="finance-tabs" role="tablist" aria-label={t('volRegister')}>
          {(['main', 'occasional'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={section === s}
              onClick={() => setSection(s)}
            >
              {t(`regSection_${s}`)}
            </button>
          ))}
        </div>
        <QueryView query={view}>
          {(viewData) => (
            <div className="register-body">
              {chain.data?.[section] && (
                <p className={`chain-state ${chain.data[section]!.valid ? 'ok' : 'broken'}`}>
                  <ShieldCheck size={16} />{' '}
                  {t(chain.data[section]!.valid ? 'regChainValid' : 'regChainBroken', {
                    count: chain.data[section]!.entries,
                  })}
                </p>
              )}
              {viewData.pending.length > 0 && (
                <>
                  <h3>{t('regPending')}</h3>
                  <ul className="pending-list">
                    {viewData.pending.map((p) => (
                      <li key={`${p.engagementId}${p.action}`}>
                        <span>
                          <strong>{p.name}</strong> · {t(`regAction_${p.action}`)}
                          {p.issues.length > 0 && (
                            <small className="cell-note error-text">
                              {p.issues.map((i) => t(i)).join(' ')}
                            </small>
                          )}
                        </span>
                        {can('register:write') && (
                          <Button
                            variant="secondary"
                            disabled={p.issues.length > 0}
                            onClick={() =>
                              p.action === 'correction' ? setCorrecting(p) : record(p)
                            }
                          >
                            {t('regRecord')}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <h3>{t('regCurrent', { count: viewData.current.length })}</h3>
              {viewData.current.length ? (
                // Read-only tables scroll on small screens and must be reachable by keyboard.
                <div
                  className="table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label={t('regCurrent', { count: viewData.current.length })}
                >
                  <table>
                    <thead>
                      <tr>
                        <th>Nr.</th>
                        <th>{t('name')}</th>
                        <th>{t('volResidence')}</th>
                        <th>{t('volStartedOn')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewData.current.map((c) => (
                        <tr key={c.engagementId}>
                          <td className="numeric">{c.entryNumber}</td>
                          <td>{person(c.data)}</td>
                          <td>
                            {[c.data.street, c.data.postalCode, c.data.city]
                              .filter(Boolean)
                              .join(', ') || c.data.domicile}
                          </td>
                          <td>{formatDate(c.data.startedOn, i18n.language)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty description={t('regEmpty')} />
              )}
              <h3>{t('regEntries')}</h3>
              {viewData.entries.length ? (
                <div
                  className="table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label={t('regEntries')}
                >
                  <table>
                    <thead>
                      <tr>
                        <th>Nr.</th>
                        <th>{t('regEntryType')}</th>
                        <th>{t('regEffective')}</th>
                        <th>{t('name')}</th>
                        <th>{t('regRecordedBy')}</th>
                        <th>Hash</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewData.entries.map((e) => (
                        <tr key={e.id}>
                          <td className="numeric">{e.entryNumber}</td>
                          <td>
                            {t(`regAction_${e.entryType}`)}
                            {e.reason && <small className="cell-note">{e.reason}</small>}
                          </td>
                          <td>{formatDate(e.effectiveDate, i18n.language)}</td>
                          <td>{person(e.data)}</td>
                          <td>
                            {e.recordedByName ?? '—'}
                            <small className="cell-note">
                              {dateTime(e.recordedAt, i18n.language)}
                            </small>
                          </td>
                          <td>
                            <code title={e.entryHash}>{e.entryHash.slice(0, 10)}…</code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty description={t('regNoEntries')} />
              )}
            </div>
          )}
        </QueryView>
      </section>
      <Snapshots />
      {correcting && (
        <FormModal
          title={t('regAction_correction')}
          onClose={() => setCorrecting(null)}
          fields={[{ name: 'reason', label: t('volCorrectionReason'), required: true }]}
          onSubmit={async (v) => {
            await write('/volunteer-register/entries', {
              engagementId: correcting.engagementId,
              entryType: 'correction',
              correctsEntryId: correcting.correctsEntryId,
              reason: v.reason,
            });
            refresh();
            setCorrecting(null);
          }}
        >
          <p className="form-hint">{t('regCorrectionHint')}</p>
        </FormModal>
      )}
      {settings && <SettingsDialog onClose={() => setSettings(false)} />}
    </>
  );
}
