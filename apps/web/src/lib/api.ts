import { QueryClient } from '@tanstack/react-query';
import i18n from './i18n';
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 300_000,
      retry: (n, error) =>
        n < 1 && !(error instanceof ApiError && [401, 403, 404].includes(error.status)),
      refetchOnWindowFocus: true,
    },
  },
});
let organizationId: string | undefined;
export function setOrganization(id: string | undefined) {
  organizationId = id;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public fields?: Record<string, string[]>,
  ) {
    super(code);
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(organizationId ? { 'X-Organization-Id': organizationId } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) {
      queryClient.clear();
      window.dispatchEvent(new Event('bnature-session-expired'));
    }
    throw new ApiError(response.status, body.error?.code ?? 'INTERNAL_ERROR', body.error?.fields);
  }
  return response.json() as Promise<T>;
}
export function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    const keys: Record<string, string> = {
      UNAUTHENTICATED: 'sessionExpired',
      FORBIDDEN: 'forbidden',
      CONFLICT: 'conflict',
      INVALID_RELATION: 'invalidRelation',
      VALIDATION_ERROR: 'validation',
      INVALID_ORIGIN: 'invalidOrigin',
      LAST_ADMIN: 'lastAdmin',
      RATE_LIMITED: 'rateLimited',
      NOT_FOUND: 'notFound',
    };
    return i18n.t(keys[error.code] ?? 'serverError');
  }
  return i18n.t('loginNetwork');
}
export async function allPages<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  for (;;) {
    const data = await api<{ items: T[]; total: number }>(
      `${path}${path.includes('?') ? '&' : '?'}pageSize=100&page=${page}`,
    );
    items.push(...data.items);
    if (items.length >= data.total || !data.items.length) break;
    page++;
  }
  return items;
}
