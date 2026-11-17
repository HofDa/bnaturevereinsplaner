// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../apps/web/src/lib/api', () => ({ apiSend: vi.fn() }));
import { apiSend } from '../../apps/web/src/lib/api';
import { releasePush } from '../../apps/web/src/lib/push';

afterEach(() => vi.unstubAllGlobals());
it('unsubscribes and closes displayed notifications even if server cleanup fails', async () => {
  const unsubscribe = vi.fn().mockResolvedValue(true);
  const close = vi.fn();
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', class {});
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistration: vi.fn().mockResolvedValue({
        active: {},
        pushManager: {
          getSubscription: vi
            .fn()
            .mockResolvedValue({ endpoint: 'https://fcm.googleapis.com/test', unsubscribe }),
        },
        getNotifications: vi.fn().mockResolvedValue([{ close }]),
      }),
    },
  });
  vi.mocked(apiSend).mockRejectedValue(new Error('Offline'));
  await expect(releasePush()).resolves.toBeUndefined();
  expect(apiSend).toHaveBeenCalledOnce();
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});
