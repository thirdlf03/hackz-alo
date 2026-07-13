import {
  buildPushPayload,
  type PushMessage,
  type PushSubscription,
  type VapidKeys,
} from '@block65/webcrypto-web-push';
import {logStructured} from '../http/requestLog.js';
import {
  deletePagerSubscription,
  listPagerSubscriptionsForSession,
} from '../repositories/pagerSubscriptionRepository.js';
import type {PagerNotificationPayload} from '../pure/pagerNotification.js';
import type {Bindings} from '../types.js';

export async function sendPagerNotification(
  env: Bindings,
  sessionId: string,
  payload: PagerNotificationPayload
): Promise<void> {
  const vapid: VapidKeys = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };
  if (!vapid.subject || !vapid.publicKey || !vapid.privateKey) return;

  const subscriptions = await listPagerSubscriptionsForSession(env, sessionId);
  if (subscriptions.length === 0) return;

  await Promise.allSettled(
    subscriptions.map(async (subscription) => {
      try {
        const parsed = JSON.parse(
          subscription.subscriptionJson
        ) as PushSubscription;
        const request = await buildPushPayload(
          {data: payload as unknown as PushMessage['data']},
          parsed,
          vapid
        );
        const response = await fetch(parsed.endpoint, request as RequestInit);
        if (response.status === 404 || response.status === 410) {
          await deletePagerSubscription(env, sessionId, subscription.endpoint);
        } else if (!response.ok) {
          logStructured('pager_push_rejected', {
            sessionId,
            endpoint: subscription.endpoint,
            status: response.status,
          });
        }
      } catch (error) {
        logStructured('pager_push_failed', {
          sessionId,
          endpoint: subscription.endpoint,
          message: error instanceof Error ? error.message : 'unknown error',
        });
      }
    })
  );
}
