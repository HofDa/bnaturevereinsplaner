import { PwaProvider } from '../components/pwa';
import React, { useEffect, useState, lazy, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { Me, Permission } from '@bnature/contracts';
import '../lib/i18n';
import '../styles/global.css';
import { api, ApiError, queryClient, setOrganization } from '../lib/api';
import { Shell } from '../layouts/shell';
import { SessionContext, useSession } from './session';
import { Login } from '../features/login';
import { Dashboard } from '../features/dashboard';
import { Settings, applyTheme, type Theme } from '../features/settings';
import { OfflineAttendanceHub, AttendanceSyncManager } from '../features/events/offline-attendance';
import { purgeAttendance, attendanceOwner, preparedAttendance } from '../lib/attendance-offline';
import { Link } from 'react-router';
import { Empty, ErrorState, Loading } from '../components/ui';
import { shellDatabase } from '../lib/offline';

const ScheduleDetailPage = lazy(() =>
  import('../features/community-schedules').then((module) => ({
    default: module.ScheduleDetailPage,
  })),
);
const Planning = lazy(() =>
  import('../features/planning').then((module) => ({ default: module.Planning })),
);
const Reports = lazy(() =>
  import('../features/reports').then((module) => ({ default: module.Reports })),
);
const Members = lazy(() =>
  import('../features/members').then((module) => ({ default: module.Members })),
);
const MemberDetail = lazy(() =>
  import('../features/members').then((module) => ({ default: module.MemberDetail })),
);
const Groups = lazy(() =>
  import('../features/groups').then((module) => ({ default: module.Groups })),
);
const Board = lazy(() => import('../features/board').then((module) => ({ default: module.Board })));
const OrganizationPage = lazy(() =>
  import('../features/organization').then((module) => ({ default: module.OrganizationPage })),
);
const UsersPage = lazy(() =>
  import('../features/users').then((module) => ({ default: module.UsersPage })),
);
const Profile = lazy(() =>
  import('../features/profile').then((module) => ({ default: module.Profile })),
);
const Audit = lazy(() => import('../features/audit').then((module) => ({ default: module.Audit })));
const Finance = lazy(() =>
  import('../features/finance').then((module) => ({ default: module.Finance })),
);
const Events = lazy(() =>
  import('../features/events').then((module) => ({ default: module.Events })),
);
const EventDetails = lazy(() =>
  import('../features/events').then((module) => ({ default: module.EventDetails })),
);
const EventCategories = lazy(() =>
  import('../features/events').then((module) => ({ default: module.EventCategories })),
);
const EventAttendanceIndex = lazy(() =>
  import('../features/events').then((module) => ({ default: module.EventAttendanceIndex })),
);
const Documents = lazy(() =>
  import('../features/documents').then((module) => ({ default: module.Documents })),
);
const VolunteerOverview = lazy(() =>
  import('../features/volunteers').then((module) => ({ default: module.VolunteerOverview })),
);
const VolunteerList = lazy(() =>
  import('../features/volunteers').then((module) => ({ default: module.VolunteerList })),
);
const VolunteerDetailPage = lazy(() =>
  import('../features/volunteers').then((module) => ({ default: module.VolunteerDetailPage })),
);
const VolunteerAssignments = lazy(() =>
  import('../features/volunteers/work').then((module) => ({
    default: module.VolunteerAssignments,
  })),
);
const VolunteerHours = lazy(() =>
  import('../features/volunteers/work').then((module) => ({ default: module.VolunteerHours })),
);
const VolunteerInsurance = lazy(() =>
  import('../features/volunteers/insurance').then((module) => ({
    default: module.VolunteerInsurance,
  })),
);
const VolunteerRegister = lazy(() =>
  import('../features/volunteers/register').then((module) => ({
    default: module.VolunteerRegister,
  })),
);
const Compliance = lazy(() =>
  import('../features/compliance').then((module) => ({ default: module.Compliance })),
);
const MailPage = lazy(() =>
  import('../features/mail').then((module) => ({ default: module.MailPage })),
);
const InventoryItems = lazy(() =>
  import('../features/inventory').then((module) => ({ default: module.InventoryItems })),
);
const InventoryLoans = lazy(() =>
  import('../features/inventory').then((module) => ({ default: module.InventoryLoans })),
);
const CommunityIndex = lazy(() =>
  import('../features/community').then((module) => ({ default: module.CommunityIndex })),
);
const CommunityDetail = lazy(() =>
  import('../features/community').then((module) => ({ default: module.CommunityDetail })),
);
applyTheme((localStorage.getItem('bnature-theme') as Theme) || 'system');
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (localStorage.getItem('bnature-theme') === 'system') applyTheme('system');
});
void shellDatabase.metadata.put({ key: 'schema-version', value: '1' }).catch(() => undefined);
function Guard({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { me } = useSession(),
    { t } = useTranslation();
  return me.permissions.includes(permission) ? children : <Empty title={t('forbidden')} />;
}
function OfflineMeFallback({ error, retry }: { error: Error; retry: () => void }) {
  const { t } = useTranslation();
  const [hasPrepared, setHasPrepared] = useState(false);
  useEffect(() => {
    let active = true;
    void preparedAttendance()
      .then((copies) => {
        if (active) setHasPrepared(copies.length > 0);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return (
    <>
      <ErrorState error={error} retry={retry} />
      {hasPrepared && (
        <div className="offline-attendance-page">
          <Link className="button button-secondary" to="/offline-attendance">
            {t('eventOpenOffline')}
          </Link>
        </div>
      )}
    </>
  );
}
function App() {
  const [epoch, setEpoch] = useState(0),
    [org, setOrg] = useState<string | undefined>(),
    [expired, setExpired] = useState(false);
  const location = useLocation();
  const { t } = useTranslation();
  const offlineRoute = location.pathname === '/offline-attendance';
  const query = useQuery({
    queryKey: ['me', epoch, org],
    enabled: !offlineRoute,
    queryFn: async () => {
      const owner = !org ? await attendanceOwner().catch(() => undefined) : undefined;
      if (owner) {
        try {
          return await api<Me>('/me', { headers: { 'X-Organization-Id': owner.organizationId } });
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 403)) throw error;
          await purgeAttendance();
        }
      }
      return api<Me>('/me');
    },
    retry: (count, error) =>
      count < 1 && !(error instanceof ApiError && [400, 401, 403, 404, 422].includes(error.status)),
  });
  useEffect(() => {
    const expire = () => setExpired(true);
    const channel =
      typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('bnature-session');
    if (channel)
      channel.onmessage = (event) => {
        if (event.data === 'logout') void purgeAttendance();
        queryClient.clear();
        setOrganization(undefined);
        setOrg(undefined);
        setExpired(false);
        setEpoch((value) => value + 1);
      };
    window.addEventListener('bnature-session-expired', expire);
    return () => {
      window.removeEventListener('bnature-session-expired', expire);
      channel?.close();
    };
  }, []);
  useEffect(() => {
    if (query.data) setOrganization(query.data.activeOrganizationId);
  }, [query.data]);
  useEffect(() => {
    document.getElementById('main')?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [location.pathname]);
  const refresh = () => {
    setExpired(false);
    setOrganization(undefined);
    setOrg(undefined);
    queryClient.clear();
    setEpoch((value) => value + 1);
  };
  if (offlineRoute) return <OfflineAttendanceHub />;
  if (expired || (query.isError && query.error instanceof ApiError && query.error.status === 401))
    return <Login onSuccess={refresh} />;
  if (query.isPending) return <Loading />;
  if (query.isError)
    return <OfflineMeFallback error={query.error} retry={() => void query.refetch()} />;
  return (
    <SessionContext.Provider
      value={{
        me: query.data,
        switchOrganization: (id) => {
          void purgeAttendance();
          queryClient.clear();
          setOrganization(id);
          setOrg(id);
        },
      }}
    >
      <AttendanceSyncManager me={query.data} />
      <Routes>
        <Route element={<Shell onLogout={refresh} />}>
          <Route index element={<Dashboard />} />
          <Route
            path="community"
            element={
              <Guard permission="community:read">
                <CommunityIndex key={query.data.activeOrganizationId} />
              </Guard>
            }
          />
          <Route
            path="community/schedules/:id"
            element={
              <Guard permission="community:read">
                <ScheduleDetailPage />
              </Guard>
            }
          />
          <Route
            path="community/:id"
            element={
              <Guard permission="community:read">
                <CommunityDetail key={`${query.data.activeOrganizationId}:${location.pathname}`} />
              </Guard>
            }
          />
          <Route
            path="mail"
            element={
              <Guard permission="mail:read">
                <MailPage key={query.data.activeOrganizationId} />
              </Guard>
            }
          />
          <Route
            path="members"
            element={
              <Guard permission="members:read">
                <Members />
              </Guard>
            }
          />
          <Route
            path="members/:id"
            element={
              <Guard permission="members:read">
                <MemberDetail />
              </Guard>
            }
          />
          <Route
            path="planning"
            element={
              <Guard permission="planning:read">
                <Planning key={query.data.activeOrganizationId} />
              </Guard>
            }
          />
          <Route
            path="finance"
            element={
              <Guard permission="finance:read">
                <Finance />
              </Guard>
            }
          />
          <Route
            path="documents"
            element={
              <Guard permission="documents:read">
                <Documents />
              </Guard>
            }
          />
          <Route
            path="events"
            element={
              <Guard permission="events:read">
                <Events />
              </Guard>
            }
          />
          <Route
            path="events/categories"
            element={
              <Guard permission="events:read">
                <EventCategories />
              </Guard>
            }
          />
          <Route
            path="events/attendance"
            element={
              <Guard permission="events:write">
                <EventAttendanceIndex />
              </Guard>
            }
          />
          <Route
            path="events/:id"
            element={
              <Guard permission="events:read">
                <EventDetails />
              </Guard>
            }
          />
          <Route
            path="volunteers"
            element={
              <Guard permission="volunteers:read">
                <VolunteerOverview />
              </Guard>
            }
          />
          <Route
            path="volunteers/list"
            element={
              <Guard permission="volunteers:read">
                <VolunteerList />
              </Guard>
            }
          />
          <Route
            path="volunteers/assignments"
            element={
              <Guard permission="volunteers:read">
                <VolunteerAssignments />
              </Guard>
            }
          />
          <Route
            path="volunteers/hours"
            element={
              <Guard permission="volunteers:read">
                <VolunteerHours />
              </Guard>
            }
          />
          <Route
            path="volunteers/insurance"
            element={
              <Guard permission="insurance:read">
                <VolunteerInsurance />
              </Guard>
            }
          />
          <Route
            path="inventory"
            element={
              <Guard permission="inventory:read">
                <InventoryItems key={query.data.activeOrganizationId} />
              </Guard>
            }
          />
          <Route
            path="inventory/loans"
            element={
              <Guard permission="inventory:read">
                <InventoryLoans key={query.data.activeOrganizationId} />
              </Guard>
            }
          />
          <Route
            path="volunteers/register"
            element={
              <Guard permission="register:read">
                <VolunteerRegister />
              </Guard>
            }
          />
          <Route
            path="volunteers/:id"
            element={
              <Guard permission="volunteers:read">
                <VolunteerDetailPage />
              </Guard>
            }
          />
          <Route
            path="compliance"
            element={
              <Guard permission="compliance:read">
                <Compliance />
              </Guard>
            }
          />
          <Route path="groups" element={<Groups />} />
          <Route path="board" element={<Board />} />
          <Route path="organization" element={<OrganizationPage />} />
          <Route
            path="reports"
            element={
              <Guard permission="members:read">
                <Reports />
              </Guard>
            }
          />
          <Route path="settings" element={<Settings />} />
          <Route path="profile" element={<Profile />} />
          <Route
            path="users"
            element={
              <Guard permission="users:manage">
                <UsersPage />
              </Guard>
            }
          />
          <Route
            path="audit"
            element={
              <Guard permission="audit:read">
                <Audit />
              </Guard>
            }
          />
          <Route path="login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Empty title={t('notFoundPage')} />} />
        </Route>
      </Routes>
    </SessionContext.Provider>
  );
}
const routerBase =
  import.meta.env.BASE_URL === '/' ? undefined : import.meta.env.BASE_URL.replace(/\/$/, '');
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <PwaProvider>
        <BrowserRouter basename={routerBase}>
          <App />
        </BrowserRouter>
      </PwaProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
