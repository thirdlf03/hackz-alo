export interface PagerNotificationScenario {
  title: string;
  briefing: string[];
}

export interface PagerNotificationPayload {
  title: string;
  body: string;
  tag: string;
  data: {url: string};
}

export interface PagerAlertInput {
  message: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface PagerChatInput {
  from: string;
  body: string;
}

export const PAGER_ALERT_MIN_INTERVAL_MS = 20_000;

export function pagerNotificationTag(sessionId: string): string {
  return `pager-${sessionId}`;
}

export function buildPagerNotificationPayload(
  scenario: PagerNotificationScenario,
  sessionUrl: string,
  sessionId: string
): PagerNotificationPayload {
  const title = `【P1】${scenario.title}`;
  const summary = scenario.briefing[0];
  const bodyLines = [
    ...(summary ? [summary] : []),
    'オンコールはあなた一人。朝6時までに復旧せよ。',
  ];
  return {
    title,
    body: bodyLines.join(' '),
    tag: pagerNotificationTag(sessionId),
    data: {url: sessionUrl},
  };
}

export function buildPagerAlertPayload(
  scenario: PagerNotificationScenario,
  alert: PagerAlertInput,
  sessionUrl: string,
  sessionId: string
): PagerNotificationPayload {
  const severityLabel =
    alert.severity === 'critical'
      ? '【P1】'
      : alert.severity === 'warning'
        ? '【警告】'
        : '【通知】';
  return {
    title: `${severityLabel}${scenario.title}`,
    body: alert.message,
    tag: pagerNotificationTag(sessionId),
    data: {url: sessionUrl},
  };
}

export function buildPagerChatPayload(
  chat: PagerChatInput,
  sessionUrl: string,
  sessionId: string
): PagerNotificationPayload {
  return {
    title: `📟 ${chat.from}`,
    body: chat.body,
    tag: pagerNotificationTag(sessionId),
    data: {url: sessionUrl},
  };
}

export function shouldThrottlePagerAlert(
  lastSentAtMs: number,
  nowMs: number,
  minIntervalMs: number = PAGER_ALERT_MIN_INTERVAL_MS
): boolean {
  return nowMs - lastSentAtMs < minIntervalMs;
}
