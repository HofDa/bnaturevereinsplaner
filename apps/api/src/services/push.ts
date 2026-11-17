import { sendNotification, WebPushError } from 'web-push';
import { isPushServiceEndpoint, type PushPayload } from '@bnature/contracts';
import type { Config } from '../plugins/config';

export type PushTarget = { endpoint: string; p256dh: string; auth: string };
/**
 * Hands one notification to the browser's push service. `gone` means the subscription no
 * longer exists there (expired, or permission withdrawn) and should be forgotten.
 */
export type PushSender = (
  target: PushTarget,
  payload: PushPayload,
  ttlSeconds: number,
) => Promise<'sent' | 'gone'>;

/** Null without VAPID keys: the feature is then switched off on this server. */
export function createPushSender(config: Config): PushSender | null {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey } = config;
  if (!publicKey || !privateKey) return null;
  const subject = config.VAPID_SUBJECT ?? `mailto:${config.EMAIL_FROM}`;
  return async (target, payload, ttlSeconds) => {
    // Revalidate persisted subscriptions at the network boundary as well as on input.
    if (!isPushServiceEndpoint(target.endpoint)) return 'gone';
    try {
      await sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        {
          vapidDetails: { subject, publicKey, privateKey },
          TTL: ttlSeconds,
          urgency: 'normal',
          timeout: 10_000,
        },
      );
      return 'sent';
    } catch (error) {
      if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410))
        return 'gone';
      throw error;
    }
  };
}
