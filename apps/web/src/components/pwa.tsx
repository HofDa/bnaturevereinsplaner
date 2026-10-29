import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Download, WifiOff } from 'lucide-react';
import { Button } from './ui';
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
export function PwaStatus() {
  const { t } = useTranslation();
  const [offline, setOffline] = useState(!navigator.onLine),
    [install, setInstall] = useState<InstallEvent | null>(null);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW: (_url, registration) => {
      if (registration) window.addEventListener('online', () => void registration.update());
    },
  });
  useEffect(() => {
    const off = () => setOffline(true),
      on = () => setOffline(false),
      ready = (event: Event) => {
        event.preventDefault();
        setInstall(event as InstallEvent);
      };
    window.addEventListener('offline', off);
    window.addEventListener('online', on);
    window.addEventListener('beforeinstallprompt', ready);
    return () => {
      window.removeEventListener('offline', off);
      window.removeEventListener('online', on);
      window.removeEventListener('beforeinstallprompt', ready);
    };
  }, []);
  return (
    <>
      {offline && (
        <div className="connectivity" role="status">
          <WifiOff size={16} />
          {t('offline')}
        </div>
      )}
      {needRefresh && (
        <div className="update-toast" role="status">
          <p>{t('updateAvailable')}</p>
          <Button onClick={() => void updateServiceWorker(true)}>{t('updateNow')}</Button>
          <Button variant="ghost" onClick={() => setNeedRefresh(false)}>
            {t('later')}
          </Button>
        </div>
      )}
      {install && (
        <Button
          className="install-button"
          variant="secondary"
          onClick={async () => {
            await install.prompt();
            await install.userChoice;
            setInstall(null);
          }}
        >
          <Download size={16} />
          {t('install')}
        </Button>
      )}
    </>
  );
}
