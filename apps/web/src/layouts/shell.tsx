import { Loading } from '../components/ui';
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useIsFetching, useIsMutating } from '@tanstack/react-query';
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
  ChartColumn,
  Ellipsis,
  X,
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
import { prefetchPage, prefetchWhenIdle } from '../app/routes';

type NavItem = { to: string; key: string; icon: typeof Users; permission?: string };
/** Destinations kept in the phone tab bar; everything else lives in the “More” sheet. */
const TAB_COUNT = 4;
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
  const profileItem: NavItem = { to: '/profile', key: 'profile', icon: UserRound };
  const secondary = [
    { to: '/organization', key: 'organization', icon: Building2, permission: 'organization:read' },
    { to: '/reports', key: 'reportsTitle', icon: ChartColumn, permission: 'members:read' },
    { to: '/documents', key: 'documents', icon: FileText, permission: 'documents:read' },
    { to: '/compliance', key: 'compliance', icon: ClipboardCheck, permission: 'compliance:read' },
    { to: '/mail', key: 'mailTitle', icon: Mail, permission: 'mail:read' },
    { to: '/users', key: 'users', icon: Users, permission: 'users:manage' },
    { to: '/audit', key: 'audit', icon: ScrollText, permission: 'audit:read' },
    { to: '/settings', key: 'settings', icon: Settings2 },
  ] as const;
  const visible = (item: NavItem) =>
    !item.permission || me.permissions.includes(item.permission as Permission);
  const primaryItems: NavItem[] = primary.filter(visible),
    secondaryItems: NavItem[] = secondary.filter(visible);
  const tabs = primaryItems.slice(0, TAB_COUNT),
    overflow = [...primaryItems.slice(TAB_COUNT), ...secondaryItems];
  const { pathname } = useLocation();
  // The section the current page belongs to: the longest matching navigation prefix.
  const current = [...primaryItems, ...secondaryItems, profileItem]
    .filter((item) =>
      item.to === '/'
        ? pathname === '/'
        : pathname === item.to || pathname.startsWith(`${item.to}/`),
    )
    .sort((a, b) => b.to.length - a.to.length)[0];
  const section = current ? t(current.key) : t('association');
  useEffect(() => {
    document.title = `${section} · b*nature`;
  }, [section]);
  // Warm the code of the main sections once the first page has settled (skipped on data saver).
  const prefetchKey = primaryItems.map((item) => item.to).join();
  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } })
      .connection;
    if (connection?.saveData) return;
    return prefetchWhenIdle(prefetchKey.split(','));
  }, [prefetchKey]);
  const [moreOpen, setMoreOpen] = useState(false),
    moreButton = useRef<HTMLButtonElement>(null);
  const moreActive = !!current && overflow.some((item) => item.to === current.to);
  const link = (item: NavItem, onNavigate?: () => void) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
      onPointerEnter={() => prefetchPage(item.to)}
      onFocus={() => prefetchPage(item.to)}
      onTouchStart={() => prefetchPage(item.to)}
      onClick={onNavigate}
    >
      <item.icon size={19} aria-hidden="true" />
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
          {primaryItems.map((item) => link(item))}
          <p className="nav-label secondary-label">{t('management')}</p>
          {secondaryItems.map((item) => link(item))}
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
            <span aria-hidden="true">/</span>
            <strong aria-current="page">{section}</strong>
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
        <ActivityBar />
        <PwaStatus />
        <main id="main" className="main-content" tabIndex={-1}>
          {error && <Notice error>{error}</Notice>}
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
        </main>
        <footer className="workspace-footer">
          <span>b*nature</span>
          <span>{t('privacyNote')}</span>
        </footer>
      </div>
      <nav className="bottom-nav" aria-label={t('workspace')}>
        {tabs.map((item) => link(item))}
        <button
          ref={moreButton}
          type="button"
          className={`nav-link ${moreActive ? 'active' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
        >
          <Ellipsis size={19} aria-hidden="true" />
          <span>{t('moreNavigation')}</span>
        </button>
      </nav>
      {moreOpen && (
        <NavSheet
          title={t('moreNavigationTitle')}
          onClose={() => {
            // Dismissed without choosing: hand focus back to the tab that opened the sheet.
            setMoreOpen(false);
            moreButton.current?.focus();
          }}
        >
          {overflow.map((item) => link(item, () => setMoreOpen(false)))}
          {link(profileItem, () => setMoreOpen(false))}
        </NavSheet>
      )}
    </div>
  );
}

/** Phone-only sheet listing every section that does not fit into the tab bar. */
function NavSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    { t } = useTranslation();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  // Close the modal first: while it is open, everything behind it (the opener too) is inert.
  const dismiss = () => {
    ref.current?.close();
    onClose();
  };
  return (
    <dialog
      ref={ref}
      className="nav-sheet"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      // A click on the backdrop lands on the dialog element itself.
      onClick={(event) => event.target === event.currentTarget && dismiss()}
    >
      <header>
        <h2>{title}</h2>
        <button type="button" className="icon-button" aria-label={t('close')} onClick={dismiss}>
          <X size={20} />
        </button>
      </header>
      <nav aria-label={title}>{children}</nav>
    </dialog>
  );
}

/** A hairline progress bar while data loads or saves; it only appears after a short delay. */
function ActivityBar() {
  const busy = useIsFetching() + useIsMutating() > 0;
  return <div className="activity-bar" data-active={busy} aria-hidden="true" />;
}
