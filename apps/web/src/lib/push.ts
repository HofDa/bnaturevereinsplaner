import { apiSend } from './api';

/** `unsupported`: this browser (or a not yet installed iOS web app) cannot receive pushes. */
export type PushState = 'unsupported' | 'denied' | 'off' | 'on';

// Remembers per account that this device wants pushes, so they come back after signing in
// again or after the browser replaced its subscription.
const flagKey = (userId: string) => `bnature-push:${userId}`;
function flag(userId: string, value?: boolean) {
  try {
    if (value === undefined) return localStorage.getItem(flagKey(userId)) === '1';
    if (value) localStorage.setItem(flagKey(userId), '1');
    else localStorage.removeItem(flagKey(userId));
  } catch {
    // Private mode: pushes still work, they are just not restored automatically.
  }
  return value ?? false;
}
export const pushWanted = (userId: string) =>
  flag(userId) && typeof Notification !== 'undefined' && Notification.permission === 'granted';

/** `wait` is for screens that can show a spinner; background callers take what is there. */
async function registration(wait = false): Promise<ServiceWorkerRegistration | null> {
  if (
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  )
    return null;
  // `ready` never settles without a service worker (development server), hence the timeout.
  const found = wait
    ? await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ])
    : await navigator.serviceWorker.getRegistration();
  return found?.active && found.pushManager ? found : null;
}

function keyBytes(base64url: string) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function subscribe(reg: ServiceWorkerRegistration, publicKey: string) {
  const options = { userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) };
  try {
    return await reg.pushManager.subscribe(options);
  } catch (error) {
    // A subscription made with an earlier server key blocks a new one: replace it.
    const stale = await reg.pushManager.getSubscription();
    if (!stale) throw error;
    await stale.unsubscribe();
    return reg.pushManager.subscribe(options);
  }
}

const register = (subscription: PushSubscription) => {
  const { endpoint, keys } = subscription.toJSON();
  return apiSend('/community/push-subscriptions', {
    method: 'PUT',
    body: JSON.stringify({ endpoint, keys: { p256dh: keys?.p256dh, auth: keys?.auth } }),
  });
};

export async function pushState(userId: string): Promise<PushState> {
  const reg = await registration(true);
  if (!reg) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return flag(userId) && (await reg.pushManager.getSubscription()) ? 'on' : 'off';
}

/** Asks for permission if needed; must be called from a click (required by iOS and Firefox). */
export async function enablePush(userId: string, publicKey: string): Promise<PushState> {
  const reg = await registration(true);
  if (!reg) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  await register(await subscribe(reg, publicKey));
  flag(userId, true);
  return 'on';
}

export async function disablePush(userId: string): Promise<PushState> {
  flag(userId, false);
  const reg = await registration();
  if (!reg) return 'unsupported';
  const subscription = await reg.pushManager.getSubscription();
  if (subscription) {
    await apiSend('/community/push-subscriptions/remove', {
      method: 'POST',
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    await subscription.unsubscribe();
  }
  return Notification.permission === 'denied' ? 'denied' : 'off';
}

/**
 * Keeps the server in step with the browser for an account that switched pushes on: registers
 * the device for the club that is open now and renews a subscription the browser dropped.
 */
export async function syncPush(userId: string, publicKey: string) {
  if (!pushWanted(userId)) return;
  const reg = await registration();
  if (!reg) return;
  await register((await reg.pushManager.getSubscription()) ?? (await subscribe(reg, publicKey)));
}

/**
 * On sign-out the device stops receiving pushes for that account; the remembered preference
 * stays, so signing in again restores them. Never blocks signing out.
 */
export async function releasePush() {
  try {
    const reg = await registration();
    const subscription = await reg?.pushManager.getSubscription();
    // Clear notifications already displayed on a shared device, even without a subscription.
    const notifications = await reg?.getNotifications().catch(() => []);
    notifications?.forEach((notification) => notification.close());
    if (!subscription) return;
    try {
      await apiSend('/community/push-subscriptions/remove', {
        method: 'POST',
        body: JSON.stringify({ endpoint: subscription.endpoint }),
        signal: AbortSignal.timeout(5000),
      });
    } finally {
      // Browser cleanup must also happen when the session expired or the server is offline.
      await subscription.unsubscribe();
    }
  } catch {
    // Best effort: an unreachable server must not keep anyone signed in.
  }
}
