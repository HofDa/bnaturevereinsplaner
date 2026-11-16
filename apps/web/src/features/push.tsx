import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BellOff, BellRing } from 'lucide-react';
import type { NotificationSettings } from '@bnature/contracts';
import { api, errorMessage } from '../lib/api';
import {
  disablePush,
  enablePush,
  pushState,
  pushWanted,
  syncPush,
  type PushState,
} from '../lib/push';
import { Button, ErrorState, Loading, Notice } from '../components/ui';
import { useSession } from '../app/session';

const settingsKey = (organizationId: string) => ['community', 'notifications', organizationId];
const loadSettings = () => api<NotificationSettings>('/community/notifications');

/** Re-registers a device that has pushes switched on, once per visit and club. */
export function usePushSync() {
  const { me } = useSession();
  const wanted = me.permissions.includes('community:read') && pushWanted(me.user.id);
  const { data } = useQuery({
    queryKey: settingsKey(me.activeOrganizationId),
    queryFn: loadSettings,
    enabled: wanted,
  });
  const publicKey = data?.pushPublicKey;
  useEffect(() => {
    if (wanted && publicKey) void syncPush(me.user.id, publicKey).catch(() => undefined);
  }, [wanted, publicKey, me.user.id, me.activeOrganizationId]);
}

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent);

/** Push notifications for news, polls and chat, switched on per device. */
export function PushSettings() {
  const { t } = useTranslation();
  const { me } = useSession();
  const allowed = me.permissions.includes('community:read');
  const query = useQuery({
    queryKey: settingsKey(me.activeOrganizationId),
    queryFn: loadSettings,
    enabled: allowed,
  });
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    void pushState(me.user.id).then((next) => {
      if (current) setState(next);
    });
    return () => {
      current = false;
    };
  }, [me.user.id]);
  if (!allowed) return null;
  const publicKey = query.data?.pushPublicKey;
  async function toggle() {
    if (!publicKey || busy) return;
    setBusy(true);
    setError('');
    try {
      const next =
        state === 'on' ? await disablePush(me.user.id) : await enablePush(me.user.id, publicKey);
      // The permission prompt was closed without an answer: say so instead of doing nothing.
      if (state !== 'on' && next === 'off') setError(t('pushNotGranted'));
      setState(next);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.name !== 'Error' ? t('pushFailed') : errorMessage(cause),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel form-panel push-settings">
      <h2>{t('pushTitle')}</h2>
      <p className="muted">{t('pushIntro')}</p>
      {query.isPending || state === null ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} />
      ) : !publicKey ? (
        <Notice>{t('pushServerOff')}</Notice>
      ) : state === 'unsupported' ? (
        <Notice>{t(isIos() ? 'pushUnsupportedIos' : 'pushUnsupported')}</Notice>
      ) : (
        <>
          <div className="push-toggle">
            <p role="status">
              {state === 'on' ? <BellRing size={18} /> : <BellOff size={18} />}
              <span>{t(state === 'on' ? 'pushOn' : 'pushOff')}</span>
            </p>
            <Button
              variant={state === 'on' ? 'secondary' : 'primary'}
              disabled={busy || state === 'denied'}
              onClick={() => void toggle()}
            >
              {t(state === 'on' ? 'pushDisable' : 'pushEnable')}
            </Button>
          </div>
          {state === 'denied' && <Notice>{t('pushDenied')}</Notice>}
          <div aria-live="polite">{error && <Notice error>{error}</Notice>}</div>
        </>
      )}
    </section>
  );
}
