import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Download, Share2, WifiOff, X } from 'lucide-react';
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
        void registration.current?.update().catch(() => undefined);
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
const IOS_DISMISSED_KEY = 'bnature-ios-install-dismissed';

function isIosSafariBrowser() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua);
  const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    Boolean((navigator as { standalone?: boolean }).standalone);
  return ios && safari && !standalone;
}

export function PwaStatus() {
  const { t } = useTranslation();
  const context = useContext(PwaContext);
  if (!context) throw new Error('PWA provider missing');
  const { offline, install, needRefresh, setNeedRefresh, updateServiceWorker, clearInstall } =
    context;
  const [iosDismissed, setIosDismissed] = useState(() => {
    try {
      return localStorage.getItem(IOS_DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const showIosHint = !install && !iosDismissed && isIosSafariBrowser();
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
      {showIosHint && (
        <aside className="ios-install-hint" aria-label={t('pwaIosHintTitle')}>
          <Share2 size={16} aria-hidden="true" />
          <div>
            <strong>{t('pwaIosHintTitle')}</strong>
            <p>{t('pwaIosHintBody')}</p>
          </div>
          <Button
            variant="ghost"
            aria-label={t('pwaDismiss')}
            onClick={() => {
              setIosDismissed(true);
              try {
                localStorage.setItem(IOS_DISMISSED_KEY, '1');
              } catch {
                // Ignore private-mode storage failures.
              }
            }}
          >
            <X size={16} />
          </Button>
        </aside>
      )}
    </>
  );
}
