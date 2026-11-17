import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { readConfig } from '../../apps/api/src/plugins/config';
import { createPushSender } from '../../apps/api/src/services/push';

const { sendNotification } = vi.hoisted(() => ({ sendNotification: vi.fn() }));
vi.mock('../../apps/api/node_modules/web-push', () => ({
  sendNotification,
  WebPushError: class extends Error {},
}));

it('rejects unsafe persisted endpoints before any outbound push request', async () => {
  const send = createPushSender(
    readConfig({
      DATABASE_URL: 'postgres://localhost/unused',
      AUTH_SECRET: 'test-only-secret-more-than-32-characters',
      VAPID_PUBLIC_KEY: 'test-public',
      VAPID_PRIVATE_KEY: 'test-private',
    }),
  )!;
  const payload = { title: 'Test', body: '', url: '/', tag: 'test' };
  for (const endpoint of [
    'https://127.0.0.1/private',
    'https://fcm.googleapis.com.evil.test/push',
    'http://fcm.googleapis.com/push',
  ]) {
    expect(await send({ endpoint, p256dh: 'key', auth: 'key' }, payload, 60)).toBe('gone');
  }
  expect(sendNotification).not.toHaveBeenCalled();
  expect(
    await send(
      { endpoint: 'https://fcm.googleapis.com/push', p256dh: 'key', auth: 'key' },
      payload,
      60,
    ),
  ).toBe('sent');
  expect(sendNotification).toHaveBeenCalledOnce();
});

function worker() {
  const handlers: Record<string, (event: unknown) => void> = {};
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const openWindow = vi.fn().mockResolvedValue(undefined);
  runInNewContext(readFileSync('apps/web/public/push-sw.js', 'utf8'), {
    URL,
    self: {
      addEventListener: (name: string, handler: (event: unknown) => void) => {
        handlers[name] = handler;
      },
      registration: { scope: 'https://club.example/app/', showNotification },
      clients: { matchAll: vi.fn().mockResolvedValue([]), openWindow },
    },
  });
  return { handlers, showNotification, openWindow };
}

describe('push service worker', () => {
  it.each([null, [], 123, 'text'])(
    'shows a fallback notification for malformed payload %j',
    async (payload) => {
      const { handlers, showNotification } = worker();
      let pending: Promise<unknown> | undefined;
      handlers.push!({
        data: { json: () => payload },
        waitUntil: (p: Promise<unknown>) => {
          pending = p;
        },
      });
      await pending;
      expect(showNotification).toHaveBeenCalledWith(
        'b*nature',
        expect.objectContaining({ body: '' }),
      );
    },
  );
  it.each(['https://outside.example/', 'https://[', '../private', 'javascript:alert(1)'])(
    'keeps unsafe notification URL %s inside the app',
    async (url) => {
      const { handlers, openWindow } = worker();
      let pending: Promise<unknown> | undefined;
      handlers.notificationclick!({
        notification: { close: vi.fn(), data: { url } },
        waitUntil: (p: Promise<unknown>) => {
          pending = p;
        },
      });
      await pending;
      expect(openWindow).toHaveBeenCalledWith('https://club.example/app/');
    },
  );
  it('opens a valid app-relative notification destination', async () => {
    const { handlers, openWindow } = worker();
    let pending: Promise<unknown> | undefined;
    handlers.notificationclick!({
      notification: { close: vi.fn(), data: { url: '/community?kind=chat' } },
      waitUntil: (p: Promise<unknown>) => {
        pending = p;
      },
    });
    await pending;
    expect(openWindow).toHaveBeenCalledWith('https://club.example/app/community?kind=chat');
  });
});
