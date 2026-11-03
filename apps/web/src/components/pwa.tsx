import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Download, WifiOff } from 'lucide-react';
import { Button } from './ui';
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
const PwaContext = createContext<{
  offline: boolean;
  install: InstallEvent | null;
  needRefresh: boolean;
  setNeedRefresh: (value: boolean) => void;
  updateServiceWorker: (reload?: boolean) => Promise<void>;
  clearInstall: () => void;
} | null>(null);
export function PwaProvider({ children }: { children: ReactNode }) {
  const [offline, setOffline] = useState(!navigator.onLine),
    [install, setInstall] = useState<InstallEvent | null>(null);
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW: (_url, value) => {
      registration.current = value;
    },
  });
  useEffect(() => {
    const off = () => setOffline(true),
      on = () => {
        setOffline(false);
        void registration.current?.update();
      },
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
    <PwaContext.Provider
      value={{
        offline,
        install,
        needRefresh,
        setNeedRefresh,
        updateServiceWorker,
        clearInstall: () => setInstall(null),
      }}
    >
      {children}
    </PwaContext.Provider>
  );
}
export function PwaStatus() {
  const { t } = useTranslation();
  const context = useContext(PwaContext);
  if (!context) throw new Error('PWA provider missing');
  const { offline, install, needRefresh, setNeedRefresh, updateServiceWorker, clearInstall } =
    context;
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
            clearInstall();
          }}
        >
          <Download size={16} />
          {t('install')}
        </Button>
      )}
    </>
  );
}
