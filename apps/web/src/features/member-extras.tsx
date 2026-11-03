import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react';
import type {
  Consent,
  ConsentKind,
  Guardian,
  MemberExtras,
  MemberField,
  MemberFieldType,
} from '@bnature/contracts';
import { api, apiSend, errorMessage, queryClient } from '../lib/api';
import { useSession } from '../app/session';
import {
  Button,
  Empty,
  ErrorState,
  Field,
  Loading,
  Modal,
  Notice,
  formatDate,
} from '../components/ui';

const lang = (language: string) => (language.startsWith('it') ? 'it' : 'de');
const today = () => new Date().toISOString().slice(0, 10);

function useExtras(membershipId: string) {
  const { me } = useSession();
  return useQuery({
    queryKey: ['member-extras', me.activeOrganizationId, membershipId],
    queryFn: () => api<MemberExtras>(`/members/${membershipId}/extras`),
  });
}
const refresh = () => queryClient.invalidateQueries({ queryKey: ['member-extras'] });

/** Fields, consents and guardians shown under the member's master data. */
export function MemberExtrasPanels({ membershipId }: { membershipId: string }) {
  const { me } = useSession();
  const query = useExtras(membershipId);
  const canWrite = me.permissions.includes('members:write');
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  return (
    <div className="detail-grid member-extras">
      <ConsentPanel id={membershipId} extras={query.data} canWrite={canWrite} />
      <GuardianPanel id={membershipId} extras={query.data} canWrite={canWrite} />
      {query.data.fields.length > 0 && (
        <FieldPanel id={membershipId} extras={query.data} canWrite={canWrite} />
      )}
    </div>
  );
}

function display(
  field: MemberField,
  value: MemberExtras['fields'][number]['value'],
  t: (k: string) => string,
  language: string,
) {
  if (value === null) return '—';
  if (field.type === 'boolean') return t(value ? 'memberFieldYes' : 'memberFieldNo');
  if (field.type === 'date' && typeof value === 'string') return formatDate(value, language);
  if (field.type === 'number' && typeof value === 'number') return value.toLocaleString(language);
  return String(value);
}

function FieldPanel({
  id,
  extras,
  canWrite,
}: {
  id: string;
  extras: MemberExtras;
  canWrite: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = useState(false);
  return (
    <section className="panel detail-panel">
      <header className="extras-header">
        <h2>{t('memberFieldsTitle')}</h2>
        {canWrite && (
          <Button variant="ghost" onClick={() => setEditing(true)}>
            <Pencil size={15} />
            {t('edit')}
          </Button>
        )}
      </header>
      <dl>
        {extras.fields.map(({ field, value }) => (
          <div key={field.id}>
            <dt>
              {field.labelI18n[lang(i18n.language)]}
              {!field.active && <small className="muted"> · {t('memberFieldInactive')}</small>}
            </dt>
            <dd>{display(field, value, t, i18n.language)}</dd>
          </div>
        ))}
      </dl>
      {editing && <FieldEditor id={id} extras={extras} onClose={() => setEditing(false)} />}
    </section>
  );
}

function FieldEditor({
  id,
  extras,
  onClose,
}: {
  id: string;
  extras: MemberExtras;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(
      extras.fields.map(({ field, value }) => [
        field.id,
        field.type === 'boolean' ? value === true : value === null ? '' : String(value),
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const convert = (type: MemberFieldType, raw: string | boolean) =>
    type === 'boolean'
      ? raw === true
      : raw === ''
        ? null
        : type === 'number'
          ? Number(String(raw).replace(',', '.'))
          : raw;
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/members/${id}/fields`, {
        method: 'PUT',
        body: JSON.stringify({
          values: Object.fromEntries(
            extras.fields.map(({ field }) => [
              field.id,
              convert(field.type, draft[field.id] ?? ''),
            ]),
          ),
        }),
      });
      await refresh();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t('memberFieldsTitle')} onClose={() => !busy && onClose()}>
      <form className="stack-form" onSubmit={(event) => void save(event)}>
        {extras.fields.map(({ field }) => {
          const label = field.labelI18n[lang(i18n.language)];
          const value = draft[field.id] ?? '';
          const set = (next: string | boolean) => setDraft((d) => ({ ...d, [field.id]: next }));
          if (field.type === 'boolean')
            return (
              <label key={field.id} className="checkbox-field">
                <input
                  type="checkbox"
                  checked={value === true}
                  onChange={(e) => set(e.target.checked)}
                />
                <span>{label}</span>
              </label>
            );
          return (
            <Field key={field.id} label={label}>
              {field.type === 'select' ? (
                <select value={String(value)} onChange={(e) => set(e.target.value)}>
                  <option value="">—</option>
                  {field.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type === 'date' ? 'date' : 'text'}
                  inputMode={field.type === 'number' ? 'decimal' : undefined}
                  maxLength={500}
                  value={String(value)}
                  onChange={(e) => set(e.target.value)}
                />
              )}
            </Field>
          );
        })}
        {error && <Notice error>{error}</Notice>}
        <footer className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button disabled={busy}>{t(busy ? 'saving' : 'save')}</Button>
        </footer>
      </form>
    </Modal>
  );
}

const kinds: ConsentKind[] = ['data_processing', 'photos'];

function ConsentPanel({
  id,
  extras,
  canWrite,
}: {
  id: string;
  extras: MemberExtras;
  canWrite: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [recording, setRecording] = useState<ConsentKind | null>(null);
  const status = (consent: Consent | null) =>
    !consent ? t('consentNone') : t(consent.granted ? 'consentGranted' : 'consentRefused');
  return (
    <section className="panel detail-panel">
      <h2>{t('consentsTitle')}</h2>
      <ul className="consent-list">
        {kinds.map((kind) => {
          const current = extras.consents[kind];
          return (
            <li key={kind}>
              <div>
                <strong>{t(`consent_${kind}`)}</strong>
                <span
                  className={`consent-state consent-${current ? (current.granted ? 'yes' : 'no') : 'none'}`}
                >
                  {status(current)}
                </span>
                {current && (
                  <small>
                    {t('consentDecidedOn', { date: formatDate(current.decidedOn, i18n.language) })}
                    {current.givenBy && ` · ${t('consentGivenBy', { name: current.givenBy })}`}
                  </small>
                )}
              </div>
              {canWrite && (
                <Button
                  variant="ghost"
                  aria-label={`${t('consentRecord')}: ${t(`consent_${kind}`)}`}
                  onClick={() => setRecording(kind)}
                >
                  {t('consentRecord')}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {extras.consentHistory.length > 0 && (
        <details className="consent-history">
          <summary>{t('consentHistory', { count: extras.consentHistory.length })}</summary>
          <ol>
            {extras.consentHistory.map((entry) => (
              <li key={entry.id}>
                <strong>
                  {t(`consent_${entry.kind}`)}:{' '}
                  {t(entry.granted ? 'consentGranted' : 'consentRefused')}
                </strong>{' '}
                · {formatDate(entry.decidedOn, i18n.language)}
                {entry.givenBy && ` · ${entry.givenBy}`}
                {entry.note && ` · ${entry.note}`}
                <small>
                  {t('consentRecordedBy', {
                    name: entry.recordedBy,
                    date: new Date(entry.recordedAt).toLocaleString(i18n.language),
                  })}
                </small>
              </li>
            ))}
          </ol>
        </details>
      )}
      {recording && (
        <ConsentForm
          id={id}
          kind={recording}
          guardians={extras.isMinor ? extras.guardians : []}
          onClose={() => setRecording(null)}
        />
      )}
    </section>
  );
}

function ConsentForm({
  id,
  kind,
  guardians,
  onClose,
}: {
  id: string;
  kind: ConsentKind;
  guardians: Guardian[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [granted, setGranted] = useState('true');
  const [decidedOn, setDecidedOn] = useState(today());
  const [givenBy, setGivenBy] = useState(guardians[0] ? guardians[0].name : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/members/${id}/consents`, {
        method: 'POST',
        body: JSON.stringify({ kind, granted: granted === 'true', decidedOn, givenBy, note }),
      });
      await refresh();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`${t('consentRecord')}: ${t(`consent_${kind}`)}`}
      onClose={() => !busy && onClose()}
    >
      <form className="stack-form" onSubmit={(event) => void save(event)}>
        <p className="form-help">{t('consentHelp')}</p>
        <Field label={t('consentDecision')}>
          <select value={granted} onChange={(e) => setGranted(e.target.value)}>
            <option value="true">{t('consentGranted')}</option>
            <option value="false">{t('consentRefused')}</option>
          </select>
        </Field>
        <Field label={t('consentDate')}>
          <input
            type="date"
            required
            max={today()}
            value={decidedOn}
            onChange={(e) => setDecidedOn(e.target.value)}
          />
        </Field>
        <Field label={t('consentGivenByLabel')} hint={t('consentGivenByHint')}>
          <input
            maxLength={120}
            list={guardians.length ? `${id}-guardians` : undefined}
            value={givenBy}
            onChange={(e) => setGivenBy(e.target.value)}
          />
        </Field>
        {guardians.length > 0 && (
          <datalist id={`${id}-guardians`}>
            {guardians.map((g) => (
              <option key={g.id} value={g.name} />
            ))}
          </datalist>
        )}
        <Field label={t('consentNote')}>
          <textarea
            rows={2}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        {error && <Notice error>{error}</Notice>}
        <footer className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button disabled={busy}>{t(busy ? 'saving' : 'save')}</Button>
        </footer>
      </form>
    </Modal>
  );
}

function GuardianPanel({
  id,
  extras,
  canWrite,
}: {
  id: string;
  extras: MemberExtras;
  canWrite: boolean;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<Guardian | 'new' | null>(null);
  const [error, setError] = useState('');
  async function remove(guardian: Guardian) {
    setError('');
    try {
      await apiSend(`/members/${id}/guardians/${guardian.id}`, { method: 'DELETE' });
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <section className="panel detail-panel">
      <header className="extras-header">
        <h2>{t('guardiansTitle')}</h2>
        {canWrite && (
          <Button variant="ghost" onClick={() => setEditing('new')}>
            <Plus size={15} />
            {t('guardianAdd')}
          </Button>
        )}
      </header>
      {extras.isMinor && !extras.guardians.length && (
        <p className="minor-warning">
          <TriangleAlert size={16} aria-hidden="true" />
          {t('guardianMissing')}
        </p>
      )}
      {error && <Notice error>{error}</Notice>}
      {extras.guardians.length ? (
        <ul className="guardian-list">
          {extras.guardians.map((guardian) => (
            <li key={guardian.id}>
              <div>
                <strong>{guardian.name}</strong>
                {guardian.relationship && <span> · {guardian.relationship}</span>}
                <small>{[guardian.email, guardian.phone].filter(Boolean).join(' · ') || '—'}</small>
              </div>
              {canWrite && (
                <span className="row-actions">
                  <Button
                    variant="ghost"
                    aria-label={`${t('edit')}: ${guardian.name}`}
                    onClick={() => setEditing(guardian)}
                  >
                    <Pencil size={15} />
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`${t('guardianRemove')}: ${guardian.name}`}
                    onClick={() => void remove(guardian)}
                  >
                    <Trash2 size={15} />
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        !extras.isMinor && <Empty description={t('guardianNone')} />
      )}
      {editing && (
        <GuardianForm
          id={id}
          guardian={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function GuardianForm({
  id,
  guardian,
  onClose,
}: {
  id: string;
  guardian: Guardian | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState({
    name: guardian?.name ?? '',
    relationship: guardian?.relationship ?? '',
    email: guardian?.email ?? '',
    phone: guardian?.phone ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/members/${id}/guardians${guardian ? `/${guardian.id}` : ''}`, {
        method: guardian ? 'PATCH' : 'POST',
        body: JSON.stringify(draft),
      });
      await refresh();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const input = (key: keyof typeof draft, label: string, props: Record<string, unknown> = {}) => (
    <Field label={t(label)}>
      <input
        value={draft[key]}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
        {...props}
      />
    </Field>
  );
  return (
    <Modal title={t(guardian ? 'guardianEdit' : 'guardianAdd')} onClose={() => !busy && onClose()}>
      <form className="stack-form" onSubmit={(event) => void save(event)}>
        {input('name', 'guardianName', { required: true, maxLength: 120, autoComplete: 'off' })}
        {input('relationship', 'guardianRelationship', { maxLength: 60 })}
        {input('email', 'email', { type: 'email', maxLength: 254 })}
        {input('phone', 'phone', { type: 'tel', maxLength: 40 })}
        {error && <Notice error>{error}</Notice>}
        <footer className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button disabled={busy}>{t(busy ? 'saving' : 'save')}</Button>
        </footer>
      </form>
    </Modal>
  );
}

/** Organization settings: define the club's extra member fields. */
export function MemberFieldSettings() {
  const { t, i18n } = useTranslation();
  const { me } = useSession();
  const canWrite = me.permissions.includes('organization:write');
  const query = useQuery({
    queryKey: ['member-fields', me.activeOrganizationId],
    queryFn: () => api<{ items: MemberField[] }>('/member-fields'),
    enabled: me.permissions.includes('members:read'),
  });
  const [draft, setDraft] = useState({
    de: '',
    it: '',
    type: 'text' as MemberFieldType,
    options: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!me.permissions.includes('members:read')) return null;
  const reload = () => queryClient.invalidateQueries({ queryKey: ['member-fields'] });
  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/member-fields', {
        method: 'POST',
        body: JSON.stringify({
          labelI18n: { de: draft.de, it: draft.it },
          type: draft.type,
          options:
            draft.type === 'select'
              ? draft.options
                  .split(/[,;\n]/)
                  .map((o) => o.trim())
                  .filter(Boolean)
              : [],
        }),
      });
      setDraft({ de: '', it: '', type: 'text', options: '' });
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function toggle(field: MemberField) {
    setError('');
    try {
      await api(`/member-fields/${field.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !field.active }),
      });
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <section className="panel form-panel member-field-settings">
      <h2>{t('memberFieldsTitle')}</h2>
      <p className="muted">{t('memberFieldsIntro')}</p>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} />
      ) : query.data.items.length ? (
        <ul className="member-field-list">
          {query.data.items.map((field) => (
            <li key={field.id} className={field.active ? '' : 'inactive'}>
              <div>
                <strong>{field.labelI18n[lang(i18n.language)]}</strong>
                <small>
                  {t(`memberFieldType_${field.type}`)}
                  {field.options.length > 0 && ` · ${field.options.join(', ')}`}
                  {!field.active && ` · ${t('memberFieldInactive')}`}
                </small>
              </div>
              {canWrite && (
                <Button variant="ghost" onClick={() => void toggle(field)}>
                  {t(field.active ? 'memberFieldDeactivate' : 'memberFieldActivate')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <Empty description={t('memberFieldsEmpty')} />
      )}
      {error && <Notice error>{error}</Notice>}
      {canWrite && (
        <form className="member-field-form" onSubmit={(event) => void create(event)}>
          <h3>{t('memberFieldAdd')}</h3>
          <div className="form-grid">
            <Field label={t('memberFieldLabelDe')}>
              <input
                required
                maxLength={80}
                value={draft.de}
                onChange={(e) => setDraft((d) => ({ ...d, de: e.target.value }))}
              />
            </Field>
            <Field label={t('memberFieldLabelIt')}>
              <input
                required
                maxLength={80}
                value={draft.it}
                onChange={(e) => setDraft((d) => ({ ...d, it: e.target.value }))}
              />
            </Field>
            <Field label={t('memberFieldType')}>
              <select
                value={draft.type}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, type: e.target.value as MemberFieldType }))
                }
              >
                {(['text', 'number', 'date', 'boolean', 'select'] as const).map((type) => (
                  <option key={type} value={type}>
                    {t(`memberFieldType_${type}`)}
                  </option>
                ))}
              </select>
            </Field>
            {draft.type === 'select' && (
              <Field label={t('memberFieldOptions')} hint={t('memberFieldOptionsHint')}>
                <input
                  required
                  value={draft.options}
                  onChange={(e) => setDraft((d) => ({ ...d, options: e.target.value }))}
                />
              </Field>
            )}
          </div>
          <footer className="form-actions">
            <Button disabled={busy}>
              <Plus size={16} />
              {t(busy ? 'saving' : 'memberFieldAdd')}
            </Button>
          </footer>
        </form>
      )}
    </section>
  );
}
