// Lazy page modules, shared by the router (React.lazy) and the navigation (prefetch on intent).
// Calling an importer twice is free: the browser module cache returns the same promise.
export const pages = {
  members: () => import('../features/members'),
  groups: () => import('../features/groups'),
  board: () => import('../features/board'),
  organization: () => import('../features/organization'),
  users: () => import('../features/users'),
  profile: () => import('../features/profile'),
  audit: () => import('../features/audit'),
  finance: () => import('../features/finance'),
  events: () => import('../features/events'),
  documents: () => import('../features/documents'),
  volunteers: () => import('../features/volunteers'),
  volunteerWork: () => import('../features/volunteers/work'),
  volunteerInsurance: () => import('../features/volunteers/insurance'),
  volunteerRegister: () => import('../features/volunteers/register'),
  compliance: () => import('../features/compliance'),
  mail: () => import('../features/mail'),
  inventory: () => import('../features/inventory'),
  community: () => import('../features/community'),
  schedules: () => import('../features/community-schedules'),
  reports: () => import('../features/reports'),
} as const;

const byPath: Record<string, keyof typeof pages> = {
  '/members': 'members',
  '/groups': 'groups',
  '/board': 'board',
  '/organization': 'organization',
  '/users': 'users',
  '/profile': 'profile',
  '/audit': 'audit',
  '/finance': 'finance',
  '/events': 'events',
  '/documents': 'documents',
  '/volunteers': 'volunteers',
  '/compliance': 'compliance',
  '/mail': 'mail',
  '/inventory': 'inventory',
  '/community': 'community',
  '/reports': 'reports',
};

/** Starts loading the code for a top-level section; failures are ignored (the route retries). */
export function prefetchPage(path: string) {
  const key = byPath[`/${path.split('/')[1] ?? ''}`];
  if (key) void pages[key]().catch(() => undefined);
}

/** Warms the given sections while the browser is idle, a few at a time. */
export function prefetchWhenIdle(paths: string[]) {
  const queue = [...paths];
  const idle =
    window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 200));
  const cancel = window.cancelIdleCallback ?? window.clearTimeout;
  let handle = 0;
  const step = () => {
    const next = queue.shift();
    if (!next) return;
    prefetchPage(next);
    handle = idle(step);
  };
  // Leave the first render and its data requests alone.
  const start = window.setTimeout(() => (handle = idle(step)), 1500);
  return () => {
    window.clearTimeout(start);
    cancel(handle);
  };
}
