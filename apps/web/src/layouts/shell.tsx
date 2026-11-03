import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  Wallet,
  Users,
  Layers,
  ShieldCheck,
  Building2,
  Settings2,
  ScrollText,
  UserRound,
  LogOut,
  ArrowUpRight,
  Globe2,
  ChevronDown,
  FileText,
  CalendarDays,
  HandHeart,
  ClipboardCheck,
  Mail,
  Package,
  Newspaper,
} from 'lucide-react';
import type { Permission } from '@bnature/contracts';
import { useSession } from '../app/session';
import { authClient } from '../lib/auth';
import { purgeAttendance } from '../lib/attendance-offline';
import { broadcastSessionChange } from '../lib/session-events';
import { queryClient, setOrganization } from '../lib/api';
import { Avatar, Notice } from '../components/ui';
import { PwaStatus } from '../components/pwa';
import { UnreadBadge, useAppBadge, useUnread } from '../features/community-unread';
export function Shell({ onLogout }: { onLogout: () => void }) {
  const { t, i18n } = useTranslation(),
    { me, switchOrganization } = useSession(),
    navigate = useNavigate();
  const [error, setError] = useState('');
  const unread = useUnread().data?.total;
  useAppBadge(unread);
  const primary = [
    { to: '/', key: 'overview', icon: LayoutDashboard },
    { to: '/community', key: 'commTitle', icon: Newspaper, permission: 'community:read' },
    { to: '/members', key: 'members', icon: Users, permission: 'members:read' },
    { to: '/events', key: 'events', icon: CalendarDays, permission: 'events:read' },
    { to: '/volunteers', key: 'volunteers', icon: HandHeart, permission: 'volunteers:read' },
    { to: '/finance', key: 'finance', icon: Wallet, permission: 'finance:read' },
    { to: '/inventory', key: 'inventory', icon: Package, permission: 'inventory:read' },
    { to: '/groups', key: 'groups', icon: Layers },
    { to: '/board', key: 'board', icon: ShieldCheck },
  ] as const;
  const secondary = [
    { to: '/organization', key: 'organization', icon: Building2, permission: 'organization:read' },
    { to: '/documents', key: 'documents', icon: FileText, permission: 'documents:read' },
    { to: '/compliance', key: 'compliance', icon: ClipboardCheck, permission: 'compliance:read' },
    { to: '/mail', key: 'mailTitle', icon: Mail, permission: 'mail:read' },
    { to: '/users', key: 'users', icon: Users, permission: 'users:manage' },
    { to: '/audit', key: 'audit', icon: ScrollText, permission: 'audit:read' },
    { to: '/settings', key: 'settings', icon: Settings2 },
  ] as const;
  const visible = (item: { to: string; permission?: string }) =>
    !item.permission || me.permissions.includes(item.permission as Permission);
  const link = (item: { to: string; key: string; icon: typeof Users }) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
    >
      <item.icon size={19} />
      <span>{t(item.key)}</span>
      {item.to === '/community' && <UnreadBadge count={unread} />}
    </NavLink>
  );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        {t('skip')}
      </a>
      <aside className="sidebar">
        <a href="/" className="brand">
          b<span>*</span>nature<small>{t('app')}</small>
        </a>
        <div className="organization-switch">
          <span className="organization-symbol">b*</span>
          <div>
            <strong>{me.organizations.find((o) => o.id === me.activeOrganizationId)?.name}</strong>
            <small>{t('association')}</small>
          </div>
          {me.organizations.length > 1 && (
            <>
              <select
                aria-label={t('selectOrganization')}
                value={me.activeOrganizationId}
                onChange={(event) => {
                  switchOrganization(event.target.value);
                  navigate('/');
                }}
              >
                {me.organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} />
            </>
          )}
        </div>
        <nav aria-label={t('workspace')}>
          <p className="nav-label">{t('workspace')}</p>
          {primary.filter((item) => visible(item)).map(link)}
          <p className="nav-label secondary-label">{t('management')}</p>
          {secondary.filter((item) => visible(item)).map(link)}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="tiny-star">✳</span>
            <p>
              Für ein lebendiges Morgen.
              <br />
              <span>Per un domani più vivo.</span>
            </p>
          </div>
          <NavLink to="/profile" className="user-panel">
            <Avatar
              firstName={me.user.name.split(' ')[0] ?? ''}
              lastName={me.user.name.split(' ')[1] ?? ''}
            />
            <div>
              <strong>{me.user.name}</strong>
              <small>{t(me.role)}</small>
            </div>
            <ArrowUpRight size={16} />
          </NavLink>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>b*nature</span>
            <span>/</span>
            <strong>{t('association')}</strong>
          </div>
          <div className="topbar-actions">
            <button
              className="language-switch"
              aria-label={`${t('language')}: ${i18n.language.toUpperCase()}`}
              onClick={() => void i18n.changeLanguage(i18n.language === 'de' ? 'it' : 'de')}
            >
              <Globe2 size={16} />
              {i18n.language.toUpperCase()}
            </button>
            <NavLink to="/profile" className="icon-button" aria-label={t('profile')}>
              <UserRound size={18} />
            </NavLink>
            <button
              className="icon-button"
              aria-label={t('logout')}
              onClick={async () => {
                setError('');
                try {
                  await purgeAttendance();
                  const result = await authClient.signOut();
                  if (result.error) {
                    setError(t('logoutFailed'));
                    return;
                  }
                  broadcastSessionChange('logout');
                  queryClient.clear();
                  setOrganization(undefined);
                  onLogout();
                  navigate('/');
                } catch {
                  setError(t('logoutFailed'));
                }
              }}
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <PwaStatus />
        <main id="main" className="main-content" tabIndex={-1}>
          {error && <Notice error>{error}</Notice>}
          <Outlet />
        </main>
        <footer className="workspace-footer">
          <span>b*nature</span>
          <span>{t('privacyNote')}</span>
        </footer>
      </div>
      <nav className="bottom-nav" aria-label={t('workspace')}>
        {primary.filter((item) => visible(item)).map(link)}
        {link({ to: '/settings', key: 'settings', icon: Settings2 })}
      </nav>
    </div>
  );
}
