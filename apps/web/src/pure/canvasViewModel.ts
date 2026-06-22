import type {
  AlertDefinition,
  GameRenderState,
  RunbookDefinition,
  ScenarioDefinition,
  SlackMessageDefinition,
} from '@incident/shared';
import {
  mergedSlackMessages,
  unreadNotificationCount,
  visibleRunbooks,
} from '../game/state/gameSelectors.js';

export type NotificationPanelItem =
  | {
      kind: 'alert';
      atMs: number;
      alert: AlertDefinition;
      unread: boolean;
    }
  | {
      kind: 'slack';
      atMs: number;
      message: SlackMessageDefinition;
      unread: boolean;
    };

export interface CanvasViewModel {
  unreadNotificationCount: number;
  mergedSlackMessages: SlackMessageDefinition[];
  visibleRunbooks: RunbookDefinition[];
  unreadSlack: boolean;
  recentSlackMessages: SlackMessageDefinition[];
  notificationPanelItems: NotificationPanelItem[];
}

export function buildCanvasViewModel(
  state: GameRenderState,
  scenario?: ScenarioDefinition
): CanvasViewModel {
  const slackMessages = mergedSlackMessages(state);
  const runbooks = scenario
    ? visibleRunbooks(scenario, state.clock.elapsedMs)
    : state.monitors.right.activeRunbook
      ? [state.monitors.right.activeRunbook]
      : [];

  const notificationPanelItems: NotificationPanelItem[] = [
    ...state.monitors.left.alerts.map((alert) => ({
      kind: 'alert' as const,
      atMs: alert.atMs,
      alert,
      unread: !state.notifications.readAlertIds.includes(alert.id),
    })),
    ...slackMessages.map((message) => ({
      kind: 'slack' as const,
      atMs: message.atMs,
      message,
      unread: !state.seenSlackIds.includes(message.id),
    })),
  ].toSorted((left, right) => right.atMs - left.atMs);

  return {
    unreadNotificationCount: unreadNotificationCount(state),
    mergedSlackMessages: slackMessages,
    visibleRunbooks: runbooks,
    unreadSlack: slackMessages.some(
      (message) => !state.seenSlackIds.includes(message.id)
    ),
    recentSlackMessages: slackMessages.slice(-12),
    notificationPanelItems,
  };
}
