import { useEffect, useSyncExternalStore } from 'react';
import { apiStream, ApiError, queryClient } from './api';

type LiveEvent =
  | { type: 'chat'; groupId: string | null }
  | { type: 'posts'; groupId: string | null }
  | { type: 'read' };

// Whether the event stream is up. Views poll slowly while it is, at their old pace otherwise.
let connected = false;
const listeners = new Set<() => void>();
function setConnected(value: boolean) {
  if (connected === value) return;
  connected = value;
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const useLiveConnected = () =>
  useSyncExternalStore(
    subscribe,
    () => connected,
    () => false,
  );
/** Polling interval for a view: `fallback` without the stream, a slow safety net with it. */
export const liveInterval = (live: boolean, fallback: number, safety = 60_000) =>
  live ? safety : fallback;

function apply(organizationId: string, event: LiveEvent) {
  const unread = ['community', 'unread', organizationId];
  if (event.type === 'chat') {
    void queryClient.invalidateQueries({
      queryKey: ['community', 'chat', organizationId, event.groupId],
    });
    void queryClient.invalidateQueries({ queryKey: unread });
  } else if (event.type === 'posts') {
    void queryClient.invalidateQueries({ queryKey: ['community', 'posts', organizationId] });
    void queryClient.invalidateQueries({ queryKey: ['community', 'post', organizationId] });
    void queryClient.invalidateQueries({ queryKey: unread });
  } else void queryClient.invalidateQueries({ queryKey: unread });
}

/** Reads one stream until it ends. Resolves 'busy' when the server asks to stay away. */
async function read(organizationId: string, signal: AbortSignal, first: boolean) {
  const response = await apiStream('/community/stream', signal);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('stream unsupported');
  // Anything that happened while there was no stream is unknown: refresh once.
  if (!first) void queryClient.invalidateQueries({ queryKey: ['community'] });
  setConnected(true);
  const decoder = new TextDecoder();
  let buffer = '';
  let busy = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return busy ? 'busy' : 'ended';
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (block.startsWith('event: busy')) busy = true;
      const data = block.split('\n').find((line) => line.startsWith('data: '));
      if (!data || block.startsWith('event:')) continue;
      try {
        apply(organizationId, JSON.parse(data.slice(6)) as LiveEvent);
      } catch {
        // An unreadable event is skipped; the safety polling covers it.
      }
    }
  }
}

/**
 * Keeps one event stream open while the app is visible. It closes when the tab is hidden (the
 * server should not hold connections for background tabs) and reconnects with a growing pause
 * after failures. Without it everything still works through polling.
 */
export function useLiveUpdates(organizationId: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof ReadableStream === 'undefined') return;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let first = true;
    let pause = 1000;
    const run = async () => {
      if (stopped || controller || document.visibilityState !== 'visible') return;
      controller = new AbortController();
      const { signal } = controller;
      let next = pause;
      try {
        const outcome = await read(organizationId, signal, first);
        first = false;
        pause = 1000;
        // The server ends streams regularly; reconnect right away unless it is overloaded.
        next = outcome === 'busy' ? 60_000 : 250;
      } catch (error) {
        // Signed out or no access any more: polling and the session handling take over.
        if (error instanceof ApiError && [401, 403].includes(error.status)) stopped = true;
        pause = Math.min(pause * 2, 30_000);
      }
      setConnected(false);
      controller = null;
      if (!stopped && !signal.aborted) timer = setTimeout(() => void run(), next);
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timer);
        void run();
      } else {
        clearTimeout(timer);
        controller?.abort();
      }
    };
    document.addEventListener('visibilitychange', visibility);
    void run();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', visibility);
      setConnected(false);
    };
  }, [organizationId, enabled]);
}
