import type {Bindings} from '../types.js';
import {logStructured} from '../http/requestLog.js';
import {messageFrom} from '../http/response.js';
import {sendPagerNotification} from '../effect/pagerPush.js';
import {
  buildPagerAlertPayload,
  buildPagerChatPayload,
  PAGER_ALERT_MIN_INTERVAL_MS,
  shouldThrottlePagerAlert,
  type PagerNotificationPayload,
} from '../pure/pagerNotification.js';
import {requireScenario} from './sessionExerciseHandlers.js';
import type {StoredSession} from './sessionState.js';
import type {PagerTimelineEvent} from './sessionTimeline.js';

/**
 * Fans a pager timeline event out to web-push subscribers. Critical
 * alerts are throttled; returns the updated last-alert timestamp the
 * caller should keep for the next invocation (unchanged when nothing
 * was sent).
 */
export function handleSessionPagerEvent(
  env: Bindings,
  session: StoredSession,
  event: PagerTimelineEvent,
  lastAlertPagerSentAt: number,
  now = Date.now()
): number {
  try {
    if (!session.pagerOriginUrl) return lastAlertPagerSentAt;
    const sessionUrl = `${session.pagerOriginUrl}/`;
    const scenario = requireScenario(session.scenarioId);
    if (event.kind === 'alert') {
      if (event.alert.severity !== 'critical') return lastAlertPagerSentAt;
      if (
        shouldThrottlePagerAlert(
          lastAlertPagerSentAt,
          now,
          PAGER_ALERT_MIN_INTERVAL_MS
        )
      ) {
        return lastAlertPagerSentAt;
      }
      const payload = buildPagerAlertPayload(
        scenario,
        event.alert,
        sessionUrl,
        session.sessionId
      );
      sendPagerNotificationSafe(env, session.sessionId, payload);
      return now;
    }
    const payload = buildPagerChatPayload(
      event.chat,
      sessionUrl,
      session.sessionId
    );
    sendPagerNotificationSafe(env, session.sessionId, payload);
    return lastAlertPagerSentAt;
  } catch (error: unknown) {
    logStructured('pager_event_failed', {
      sessionId: session.sessionId,
      message: messageFrom(error),
    });
    return lastAlertPagerSentAt;
  }
}

function sendPagerNotificationSafe(
  env: Bindings,
  sessionId: string,
  payload: PagerNotificationPayload
) {
  sendPagerNotification(env, sessionId, payload).catch((error: unknown) => {
    logStructured('pager_push_failed', {
      sessionId,
      message: messageFrom(error),
    });
  });
}
