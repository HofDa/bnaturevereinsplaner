import React, { useEffect, useState, type ReactNode } from 'react';
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
import { Members, MemberDetail } from '../features/members';
import { Groups } from '../features/groups';
import { Board } from '../features/board';
import { Settings, applyTheme, type Theme } from '../features/settings';
import { OrganizationPage } from '../features/organization';
import { UsersPage } from '../features/users';
import { Profile } from '../features/profile';
import { Audit } from '../features/audit';
import { Empty, ErrorState, Loading } from '../components/ui';
import { shellDatabase } from '../lib/offline';
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
function App() {
  const [epoch, setEpoch] = useState(0),
    [org, setOrg] = useState<string | undefined>(),
    [expired, setExpired] = useState(false);
  const { t } = useTranslation(),
    location = useLocation();
  const query = useQuery({
    queryKey: ['me', epoch, org],
    queryFn: () => api<Me>('/me'),
    retry: false,
  });
  useEffect(() => {
    const expire = () => setExpired(true);
    const channel =
      typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('bnature-session');
    if (channel)
      channel.onmessage = () => {
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
  if (expired || (query.isError && query.error instanceof ApiError && query.error.status === 401))
    return <Login onSuccess={refresh} />;
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  return (
    <SessionContext.Provider
      value={{
        me: query.data,
        switchOrganization: (id) => {
          queryClient.clear();
          setOrganization(id);
          setOrg(id);
        },
      }}
    >
      <Routes>
        <Route element={<Shell onLogout={refresh} />}>
          <Route index element={<Dashboard />} />
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
          <Route path="groups" element={<Groups />} />
          <Route path="board" element={<Board />} />
          <Route path="organization" element={<OrganizationPage />} />
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
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
