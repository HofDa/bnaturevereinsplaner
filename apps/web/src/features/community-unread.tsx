import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { NotificationSettings, Unread } from '@bnature/contracts';
import { apiSend, api, errorMessage, queryClient } from '../lib/api';
import { ErrorState, Loading, Notice } from '../components/ui';
import { useSession } from '../app/session';

export function useUnread() {
  const { me } = useSession();
  return useQuery({
    queryKey: ['community', 'unread', me.activeOrganizationId],
    queryFn: () => api<Unread>('/community/unread'),
    enabled: me.permissions.includes('community:read'),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

/** Mirrors the unread total on the installed PWA icon where the platform supports it. */
export function useAppBadge(total: number | undefined) {
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (total === undefined || !nav.setAppBadge) return;
    (total > 0 ? nav.setAppBadge(total) : nav.clearAppBadge?.())?.catch(() => {});
  }, [total]);
  useEffect(
    () => () => {
      (navigator as Navigator & { clearAppBadge?: () => Promise<void> })
        .clearAppBadge?.()
        .catch(() => {});
    },
    [],
  );
}

/**
 * Marks a channel as read up to `until` (the newest item the user has on screen) while the
 * page is visible. Repeated calls for the same position are skipped.
 */
export function useMarkRead(
  channel: 'news' | 'poll' | 'chat',
  groupId: string | null,
  until: string | null | undefined,
) {
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!until) return;
    const key = `${channel}:${groupId}:${until}`;
    const send = () => {
      if (document.visibilityState !== 'visible' || last.current === key) return;
      last.current = key;
      apiSend('/community/read', {
        method: 'PUT',
        body: JSON.stringify({ channel, groupId, until }),
      })
        .then(() => queryClient.invalidateQueries({ queryKey: ['community', 'unread'] }))
        .catch(() => {
          last.current = null;
        });
    };
    send();
    document.addEventListener('visibilitychange', send);
    return () => document.removeEventListener('visibilitychange', send);
  }, [channel, groupId, until]);
}

// Spans cannot carry aria-label, so screen readers get a hidden sentence instead of the number.
export function UnreadBadge({ count }: { count: number | undefined }) {
  const { t } = useTranslation();
  if (!count) return null;
  return (
    <span className="unread-badge">
      <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
      <span className="sr-only">{t('commUnread', { count })}</span>
    </span>
  );
}

const modes = ['off', 'daily', 'weekly'] as const;

/** Opt-in e-mail digest of unread club news, polls and chat, per account and club. */
export function DigestSettings() {
  const { t } = useTranslation();
  const { me } = useSession();
  const key = ['community', 'notifications', me.activeOrganizationId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api<NotificationSettings>('/community/notifications'),
    enabled: me.permissions.includes('community:read'),
  });
  const [busy, setBusy] = useState(false);
  // Shown immediately while saving; dropped again on success or error.
  const [pending, setPending] = useState<(typeof modes)[number] | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  if (!me.permissions.includes('community:read')) return null;
  async function change(digest: (typeof modes)[number]) {
    setBusy(true);
    setPending(digest);
    setStatus(null);
    try {
      const next = await api<NotificationSettings>('/community/notifications', {
        method: 'PUT',
        body: JSON.stringify({ digest }),
      });
      queryClient.setQueryData(key, next);
      setStatus({ ok: true, text: t('saved') });
    } catch (error) {
      setStatus({ ok: false, text: errorMessage(error) });
    } finally {
      setBusy(false);
      setPending(null);
    }
  }
  return (
    <section className="panel form-panel digest-settings">
      <h2>{t('commDigestTitle')}</h2>
      <p className="muted">{t('commDigestIntro')}</p>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} />
      ) : (
        <>
          <fieldset aria-busy={busy}>
            <legend className="sr-only">{t('commDigestTitle')}</legend>
            {modes.map((mode) => (
              <label key={mode} className="digest-option">
                <input
                  type="radio"
                  name="digest"
                  value={mode}
                  checked={(pending ?? query.data.digest) === mode}
                  onChange={() => {
                    if (!busy) void change(mode);
                  }}
                />
                <span>
                  <strong>{t(`commDigest_${mode}`)}</strong>
                  <small>{t(`commDigest_${mode}Hint`)}</small>
                </span>
              </label>
            ))}
          </fieldset>
          {(pending ?? query.data.digest) !== 'off' && (
            <p className="muted">{t('commDigestAddress', { email: query.data.email })}</p>
          )}
          {!query.data.emailEnabled && <Notice>{t('commDigestDisabled')}</Notice>}
          <div aria-live="polite">
            {status && <Notice error={!status.ok}>{status.text}</Notice>}
          </div>
        </>
      )}
    </section>
  );
}
