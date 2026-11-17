import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { setLanguage } from '../lib/i18n';
import {
  Monitor,
  Moon,
  Sun,
  ArrowUpRight,
  ShieldCheck,
  UserRound,
  Building2,
  Users,
  ScrollText,
  FileText,
} from 'lucide-react';
import { useSession } from '../app/session';
import { PageHeading } from '../components/ui';
import { applyTheme, readTheme, type Theme } from '../lib/theme';
export function Settings() {
  const { t, i18n } = useTranslation(),
    { me } = useSession();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const links = [
    { to: '/profile', label: 'profile', icon: UserRound },
    {
      to: '/organization',
      label: 'organization',
      icon: Building2,
      permission: 'organization:read',
    },
    { to: '/documents', label: 'documents', icon: FileText, permission: 'documents:read' },
    { to: '/users', label: 'users', icon: Users, permission: 'users:manage' },
    { to: '/audit', label: 'audit', icon: ScrollText, permission: 'audit:read' },
  ];
  return (
    <>
      <PageHeading title={t('settings')} description={t('settingsIntro')} />
      <div className="settings-grid">
        <section className="panel settings-panel">
          <h2>{t('appearance')}</h2>
          <p>{t('appearanceIntro')}</p>
          <div className="theme-options">
            {[
              { value: 'light', icon: Sun },
              { value: 'dark', icon: Moon },
              { value: 'system', icon: Monitor },
            ].map((item) => (
              <button
                key={item.value}
                aria-pressed={theme === item.value}
                className={theme === item.value ? 'selected' : ''}
                onClick={() => {
                  setTheme(item.value as Theme);
                  applyTheme(item.value as Theme);
                }}
              >
                <item.icon size={22} />
                {t(item.value)}
              </button>
            ))}
          </div>
          <hr />
          <h2>{t('language')}</h2>
          <p>{t('languageIntro')}</p>
          <div className="language-options">
            {(['de', 'it'] as const).map((language) => (
              <button
                key={language}
                className={i18n.language === language ? 'selected' : ''}
                aria-pressed={i18n.language === language}
                onClick={() => void setLanguage(language)}
              >
                {language === 'de' ? 'Deutsch' : 'Italiano'}
              </button>
            ))}
          </div>
        </section>
        <section className="panel settings-panel">
          <h2>{t('management')}</h2>
          <div className="settings-links">
            {links
              .filter(
                (link) => !link.permission || me.permissions.some((p) => p === link.permission),
              )
              .map((link) => (
                <Link to={link.to} key={link.to}>
                  <link.icon size={20} />
                  <span>{t(link.label)}</span>
                  <ArrowUpRight size={17} />
                </Link>
              ))}
          </div>
          <div className="security-note">
            <ShieldCheck size={22} />
            <div>
              <strong>{t('security')}</strong>
              <p>{t('securityIntro')}</p>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
