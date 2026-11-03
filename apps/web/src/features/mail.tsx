import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Mail, Send, Eye, Settings2 } from 'lucide-react';
import {
  mailSettingsInputSchema,
  type MailPreview,
  type MailRequest,
  type MailMessage,
  type MailSettings,
  type Page,
  type EventOccurrence,
} from '@bnature/contracts';
import { useSession } from '../app/session';
import { api, allPages, errorMessage, queryClient } from '../lib/api';
import { useFinancialWrite } from './finance/client';
import {
  Button,
  Empty,
  ErrorState,
  Field,
  Loading,
  Modal,
  Notice,
  PageHeading,
  Pagination,
} from '../components/ui';
import { DataForm } from '../components/data-form';
import { NewsletterPicker } from './mail-newsletter';

export function MailPage() {
  const { t, i18n } = useTranslation();
  const { me } = useSession();
  const write = useFinancialWrite();
  const canInvite = me.permissions.includes('mail:invite');
  const canRemind = me.permissions.includes('finance:write');
  const canConfigure = me.permissions.includes('users:manage');
  const [newsletterId, setNewsletterId] = useState('');
  const [kind, setKind] = useState<'fee_reminder' | 'event_invitation' | 'newsletter'>(
    canRemind ? 'fee_reminder' : 'event_invitation',
  );
  const [eventId, setEventId] = useState('');
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState<MailPreview | null>(null);
  const [details, setDetails] = useState<MailMessage | null>(null);
  const [configure, setConfigure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{
    key: 'mailQueuedCount' | 'mailSettingsSaved';
    count?: number;
  } | null>(null);
  const status = useQuery({
    queryKey: ['mail-status', me.activeOrganizationId],
    queryFn: () => api<{ mode: 'disabled' | 'local' | 'smtp' }>('/mail/status'),
  });
  const messages = useQuery({
    queryKey: ['mail-messages', me.activeOrganizationId, page],
    queryFn: () => api<Page<MailMessage>>(`/mail/messages?page=${page}`),
    refetchInterval: 5000,
  });
  const events = useQuery({
    queryKey: ['mail-events', me.activeOrganizationId],
    queryFn: () => allPages<EventOccurrence>('/events?status=published'),
    enabled: canInvite,
  });
  const settings = useQuery({
    queryKey: ['mail-settings', me.activeOrganizationId],
    queryFn: () => api<MailSettings>('/mail/settings'),
    enabled: canConfigure,
  });
  const upcoming =
    events.data?.filter(
      (e) =>
        e.visibility !== 'internal' &&
        new Date(e.startAt) > new Date() &&
        (!e.registrationDeadline || new Date(e.registrationDeadline) > new Date()),
    ) ?? [];
  const request: MailRequest =
    kind === 'fee_reminder'
      ? { kind }
      : kind === 'newsletter'
        ? { kind, newsletterId }
        : { kind, eventId };
  async function prepare() {
    setError('');
    setNotice(null);
    setBusy(true);
    try {
      setPreview(
        await api<MailPreview>('/mail/preview', { method: 'POST', body: JSON.stringify(request) }),
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      const result = await write<{ queued: number }>('/mail/send', {
        request: preview.request,
        previewHash: preview.hash,
      });
      setNotice({ key: 'mailQueuedCount', count: result.queued });
      setPreview(null);
      setPage(1);
      if (preview.request.kind === 'newsletter') setNewsletterId('');
      void queryClient.invalidateQueries({ queryKey: ['mail-messages'] });
      void queryClient.invalidateQueries({ queryKey: ['newsletters'] });
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        title={t('mailTitle')}
        description={t('mailIntro')}
        actions={
          canConfigure && (
            <Button variant="secondary" onClick={() => setConfigure(true)}>
              <Settings2 size={17} />
              {t('mailAutomation')}
            </Button>
          )
        }
      />
      {status.isError ? (
        <ErrorState error={status.error} />
      ) : (
        status.data && (
          <Notice>
            {t(`mailMode_${status.data.mode}`)}
            {status.data.mode === 'local' && (
              <>
                {' '}
                <a href="http://localhost:8025" target="_blank" rel="noreferrer">
                  {t('mailOpenInbox')}
                </a>
              </>
            )}
          </Notice>
        )
      )}
      {notice && <Notice>{t(notice.key, { count: notice.count })}</Notice>}
      {error && !preview && <Notice error>{error}</Notice>}
      <div className="mail-compose panel">
        <div className="mail-section-title">
          <Mail size={23} />
          <div>
            <h2>{t('mailCompose')}</h2>
            <p>{t('mailComposeHint')}</p>
          </div>
        </div>
        <div className="mail-compose-fields">
          <Field label={t('mailKind')}>
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as 'fee_reminder' | 'event_invitation' | 'newsletter');
                setError('');
              }}
            >
              {canRemind && <option value="fee_reminder">{t('mailKind_fee_reminder')}</option>}
              {canInvite && (
                <option value="event_invitation">{t('mailKind_event_invitation')}</option>
              )}
              {canInvite && <option value="newsletter">{t('mailKind_newsletter')}</option>}
            </select>
          </Field>
          {kind === 'event_invitation' && (
            <Field label={t('mailEvent')}>
              <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
                <option value="">{t('mailChooseEvent')}</option>
                {upcoming.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.titleI18n[i18n.language === 'it' ? 'it' : 'de']} ·{' '}
                    {new Date(e.startAt).toLocaleDateString(i18n.language)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {kind === 'newsletter' && (
            <NewsletterPicker value={newsletterId} onChange={setNewsletterId} />
          )}
          <Button
            disabled={
              busy ||
              (kind === 'event_invitation' && !eventId) ||
              (kind === 'newsletter' && !newsletterId)
            }
            onClick={() => void prepare()}
          >
            <Eye size={17} />
            {t('mailPreview')}
          </Button>
        </div>
        {kind === 'event_invitation' && events.isError && <ErrorState error={events.error} />}
        <p className="mail-help">
          {t(
            kind === 'fee_reminder'
              ? 'mailFeeHint'
              : kind === 'newsletter'
                ? 'mailNewsletterHint'
                : 'mailEventHint',
          )}
        </p>
      </div>
      <section className="panel mail-outbox" aria-label={t('mailOutbox')}>
        <div className="mail-section-title">
          <div>
            <h2>{t('mailOutbox')}</h2>
            <p>{t('mailOutboxHint')}</p>
          </div>
        </div>
        {messages.isPending ? (
          <Loading />
        ) : messages.isError ? (
          <ErrorState error={messages.error} />
        ) : !messages.data.items.length ? (
          <Empty title={t('mailEmpty')} />
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t('mailRecipient')}</th>
                    <th>{t('mailSubject')}</th>
                    <th>{t('status')}</th>
                    <th>{t('mailCreated')}</th>
                    <th>{t('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.data.items.map((message) => (
                    <tr key={message.id}>
                      <td>{message.recipient}</td>
                      <td>
                        <strong>{message.subject}</strong>
                        <small className="mail-kind-label">{t(`mailKind_${message.kind}`)}</small>
                      </td>
                      <td>
                        <span className="subtle-tag">{t(`mailState_${message.state}`)}</span>
                      </td>
                      <td>{new Date(message.createdAt).toLocaleString(i18n.language)}</td>
                      <td>
                        <Button
                          variant="ghost"
                          aria-label={`${t('details')}: ${message.recipient}`}
                          onClick={() => setDetails(message)}
                        >
                          <Eye size={17} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={20} total={messages.data.total} onChange={setPage} />
          </>
        )}
      </section>
      {preview && (
        <Modal
          wide
          title={t('mailPreview')}
          onClose={() => {
            if (!busy) {
              setPreview(null);
              setError('');
            }
          }}
        >
          <p>{t('mailPreviewCount', { count: preview.items.length })}</p>
          <p className="mail-help">
            {t('mailSkipped', {
              invalid: preview.skipped.invalidEmail,
              noAccount: preview.skipped.noAccount,
              recent: preview.skipped.recentlyContacted,
            })}
          </p>
          {preview.request.kind === 'newsletter' && (
            <p className="mail-help">
              {t('mailSkippedOptOut', { count: preview.skipped.optedOut })}
            </p>
          )}
          {error && <Notice error>{error}</Notice>}
          {!!preview.items.length && (
            <>
              <div
                className="mail-recipient-list"
                role="region"
                aria-label={t('mailPreview')}
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th>{t('name')}</th>
                      <th>{t('mailRecipient')}</th>
                      <th>{t('language')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.items.map((item) => (
                      <tr key={`${item.personId}:${item.sourceId}`}>
                        <td>{item.name}</td>
                        <td>{item.recipient}</td>
                        <td>{item.language.toUpperCase()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3 className="mail-dialog-heading">{t('mailExample')}</h3>
              <strong className="mail-dialog-heading">{preview.items[0]!.subject}</strong>
              <pre className="mail-body">{preview.items[0]!.text}</pre>
            </>
          )}
          <p className="mail-help">{t('mailConfirmHint')}</p>
          <div className="form-actions">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setPreview(null);
                setError('');
              }}
            >
              {t('cancel')}
            </Button>
            <Button
              disabled={
                busy || !preview.items.length || !status.data || status.data.mode === 'disabled'
              }
              onClick={() => void send()}
            >
              <Send size={17} />
              {t(busy ? 'mailQueuing' : 'mailConfirm')}
            </Button>
          </div>
        </Modal>
      )}
      {details && (
        <Modal wide title={t('mailDetails')} onClose={() => setDetails(null)}>
          <p>
            <strong>{t('mailRecipient')}:</strong> {details.recipient}
          </p>
          <p>{t(`mailState_${details.state}`)}</p>
          {details.errorCode && (
            <Notice error={details.state !== 'cancelled'}>
              {t(`mailError_${details.errorCode}`)}
            </Notice>
          )}
          <h3 className="mail-dialog-heading">{details.subject}</h3>
          <pre className="mail-body">{details.text}</pre>
        </Modal>
      )}
      {configure && (
        <Modal title={t('mailAutomation')} onClose={() => setConfigure(false)}>
          <p>{t('mailAutomationHint')}</p>
          {settings.isPending ? (
            <Loading />
          ) : settings.isError ? (
            <ErrorState error={settings.error} />
          ) : (
            settings.data && (
              <DataForm
                schema={mailSettingsInputSchema.extend({
                  reminderIntervalDays: z.coerce.number().int().min(7).max(90),
                })}
                fields={[
                  { name: 'automaticFeeReminders', label: 'mailAutoEnabled', type: 'checkbox' },
                  {
                    name: 'reminderIntervalDays',
                    label: 'mailInterval',
                    inputMode: 'numeric',
                    required: true,
                  },
                  {
                    name: 'automaticDeadlineReminders',
                    label: 'mailAutoDeadlines',
                    type: 'checkbox',
                  },
                  { name: 'automaticLoanReminders', label: 'mailAutoLoans', type: 'checkbox' },
                ]}
                defaults={settings.data}
                onCancel={() => setConfigure(false)}
                onSubmit={async (data) => {
                  const saved = await write<MailSettings>('/mail/settings', data, 'PUT');
                  queryClient.setQueryData(['mail-settings', me.activeOrganizationId], saved);
                  setConfigure(false);
                  setNotice({ key: 'mailSettingsSaved' });
                }}
              />
            )
          )}
        </Modal>
      )}
    </>
  );
}
