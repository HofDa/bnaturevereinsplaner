import { ApiError } from './api';

declare const __APP_RELEASE__: string | undefined;
type Kind = 'error' | 'rejection' | 'render' | 'chunk';

const MAX_PER_VISIT = 10;
const sent = new Set<string>();
// The demo has no server to report to.
const enabled = import.meta.env.VITE_DEMO !== '1' && import.meta.env.MODE !== 'test';

/** A lazy page of an older release that the server no longer has: fixed by reloading. */
export function isChunkError(error: unknown) {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /ChunkLoadError|dynamically imported module|Importing a module script failed|error loading dynamically imported/i.test(
    text,
  );
}

// Expected or outside the app's control: answered requests, cancelled or offline requests,
// a benign browser warning, and code injected by extensions.
export function ignorable(error: unknown, stack: string) {
  if (error instanceof ApiError) return true;
  // Not every thrown object is an Error (older DOMException implementations are not).
  const like = typeof error === 'object' && error !== null ? (error as Partial<Error>) : {};
  const name = typeof like.name === 'string' ? like.name : '';
  const message = typeof like.message === 'string' ? like.message : String(error);
  if (name === 'AbortError') return true;
  if (/Failed to fetch|NetworkError|Load failed|ResizeObserver loop/i.test(message)) return true;
  return /(chrome|moz|safari(-web)?)-extension:\/\//.test(stack);
}

/** Tells the server about an unexpected failure. Never throws, never blocks, never retries. */
export function reportError(error: unknown, kind: Kind = 'error') {
  try {
    if (!enabled) return;
    const failure = error instanceof Error ? error : new Error(String(error));
    const stack = failure.stack ?? '';
    if (kind !== 'chunk' && isChunkError(failure)) kind = 'chunk';
    if (ignorable(error, stack)) return;
    const signature = `${failure.name}|${failure.message}|${stack.split('\n')[1] ?? ''}`;
    if (sent.has(signature) || sent.size >= MAX_PER_VISIT) return;
    sent.add(signature);
    void fetch('/api/v1/client-errors', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind,
        name: failure.name.slice(0, 100),
        message: failure.message.slice(0, 500),
        stack: stack.slice(0, 4000),
        path: window.location.pathname.slice(0, 300),
        release: typeof __APP_RELEASE__ === 'string' ? __APP_RELEASE__.slice(0, 60) : '',
      }),
    }).catch(() => undefined);
  } catch {
    // Reporting is best effort.
  }
}

/** Failures outside React rendering: event handlers, timers and unhandled promises. */
export function installErrorReporting() {
  window.addEventListener('error', (event) => {
    // Resource load failures (images, scripts) arrive without an error object.
    if (event.error) reportError(event.error, 'error');
  });
  window.addEventListener('unhandledrejection', (event) => reportError(event.reason, 'rejection'));
}
