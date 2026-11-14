import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { Newsletter } from '@bnature/contracts';
import { api, allPages, errorMessage, queryClient } from '../lib/api';
import { useSession } from '../app/session';
import { Button, ErrorState, Field, Loading, Modal, Notice } from '../components/ui';

const lang = (language: string) => (language.startsWith('it') ? 'it' : 'de');

export function useNewsletters() {
  const { me } = useSession();
  return useQuery({
    queryKey: ['newsletters', me.activeOrganizationId],
    queryFn: async () => ({ items: await allPages<Newsletter>('/mail/newsletters') }),
  });
}

/** Draft selection for the mail composer, with create, edit and withdraw. */
export function NewsletterPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const newsletters = useNewsletters();
  const [editing, setEditing] = useState<Newsletter | 'new' | null>(null);
  const [error, setError] = useState('');
  const drafts = newsletters.data?.items.filter((n) => n.status === 'draft') ?? [];
  const selected = drafts.find((n) => n.id === value);
  async function withdraw() {
    if (!selected) return;
    setError('');
    try {
      await api(`/mail/newsletters/${selected.id}/withdraw`, { method: 'POST', body: '{}' });
      onChange('');
      await queryClient.invalidateQueries({ queryKey: ['newsletters'] });
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  if (newsletters.isPending) return <Loading />;
  if (newsletters.isError) return <ErrorState error={newsletters.error} />;
  return (
    <>
      <Field label={t('mailNewsletterDraft')}>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t('mailNewsletterChoose')}</option>
          {drafts.map((n) => (
            <option key={n.id} value={n.id}>
              {n.subjectI18n[lang(i18n.language)]}
            </option>
          ))}
        </select>
      </Field>
      <div className="newsletter-actions">
        <Button variant="secondary" onClick={() => setEditing('new')}>
          <Plus size={16} />
          {t('mailNewsletterNew')}
        </Button>
        {selected && (
          <>
            <Button variant="ghost" onClick={() => setEditing(selected)}>
              <Pencil size={15} />
              {t('edit')}
            </Button>
            <Button variant="ghost" onClick={() => void withdraw()}>
              <Trash2 size={15} />
              {t('mailNewsletterWithdraw')}
            </Button>
          </>
        )}
      </div>
      {error && <Notice error>{error}</Notice>}
      {editing && (
        <NewsletterEditor
          newsletter={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            setEditing(null);
            onChange(id);
          }}
        />
      )}
    </>
  );
}

function NewsletterEditor({
  newsletter,
  onClose,
  onSaved,
}: {
  newsletter: Newsletter | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { me } = useSession();
  const audiences = useQuery({
    queryKey: ['community', 'audiences', me.activeOrganizationId],
    queryFn: () => api<{ groups: { id: string; name: string }[] }>('/community/audiences'),
  });
  const [groupIds, setGroupIds] = useState<string[]>(newsletter?.groupIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      subjectI18n: { de: form.get('subjectDe'), it: form.get('subjectIt') },
      bodyI18n: { de: form.get('bodyDe'), it: form.get('bodyIt') },
      groupIds,
    };
    setBusy(true);
    setError('');
    try {
      const saved = await api<Newsletter>(
        newsletter ? `/mail/newsletters/${newsletter.id}` : '/mail/newsletters',
        {
          method: newsletter ? 'PUT' : 'POST',
          body: JSON.stringify(newsletter ? { ...body, version: newsletter.version } : body),
        },
      );
      await queryClient.invalidateQueries({ queryKey: ['newsletters'] });
      onSaved(saved.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      wide
      title={t(newsletter ? 'mailNewsletterEdit' : 'mailNewsletterNew')}
      onClose={() => !busy && onClose()}
    >
      <form className="stack-form" onSubmit={(event) => void save(event)}>
        <p className="form-help">{t('mailNewsletterHelp')}</p>
        <div className="form-grid">
          <Field label={t('mailNewsletterSubjectDe')}>
            <input
              name="subjectDe"
              required
              maxLength={200}
              defaultValue={newsletter?.subjectI18n.de}
            />
          </Field>
          <Field label={t('mailNewsletterSubjectIt')}>
            <input
              name="subjectIt"
              required
              maxLength={200}
              defaultValue={newsletter?.subjectI18n.it}
            />
          </Field>
          <Field label={t('mailNewsletterBodyDe')}>
            <textarea
              name="bodyDe"
              required
              rows={8}
              maxLength={20000}
              defaultValue={newsletter?.bodyI18n.de}
            />
          </Field>
          <Field label={t('mailNewsletterBodyIt')}>
            <textarea
              name="bodyIt"
              required
              rows={8}
              maxLength={20000}
              defaultValue={newsletter?.bodyI18n.it}
            />
          </Field>
        </div>
        <fieldset className="newsletter-groups">
          <legend>{t('mailNewsletterAudience')}</legend>
          <p className="form-help">{t('mailNewsletterAudienceHint')}</p>
          {audiences.data?.groups.map((group) => (
            <label key={group.id} className="checkbox-field">
              <input
                type="checkbox"
                checked={groupIds.includes(group.id)}
                onChange={(e) =>
                  setGroupIds((ids) =>
                    e.target.checked ? [...ids, group.id] : ids.filter((id) => id !== group.id),
                  )
                }
              />
              <span>{group.name}</span>
            </label>
          ))}
        </fieldset>
        {error && <Notice error>{error}</Notice>}
        <footer className="form-actions">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button disabled={busy}>{t(busy ? 'saving' : 'mailNewsletterSave')}</Button>
        </footer>
      </form>
    </Modal>
  );
}

/** Profile switch: receive the club newsletter or not (only with a linked person). */
export function NewsletterSubscription() {
  const { t } = useTranslation();
  const { me } = useSession();
  const key = ['profile-newsletter', me.activeOrganizationId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api<{ linked: boolean; optOut: boolean }>('/profile/newsletter'),
  });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  if (!query.data?.linked) return null;
  async function change(receive: boolean) {
    setBusy(true);
    setStatus(null);
    try {
      const next = await api<{ linked: boolean; optOut: boolean }>('/profile/newsletter', {
        method: 'PUT',
        body: JSON.stringify({ optOut: !receive }),
      });
      queryClient.setQueryData(key, next);
      setStatus({ ok: true, text: t('saved') });
    } catch (e) {
      setStatus({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel form-panel newsletter-subscription">
      <h2>{t('mailNewsletterProfileTitle')}</h2>
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={!query.data.optOut}
          disabled={busy}
          onChange={(e) => void change(e.target.checked)}
        />
        <span>{t('mailNewsletterReceive')}</span>
      </label>
      <p className="muted">{t('mailNewsletterProfileHint')}</p>
      <div aria-live="polite">{status && <Notice error={!status.ok}>{status.text}</Notice>}</div>
    </section>
  );
}
