import type {
  AlertDefinition,
  GameRenderState,
  RunbookDefinition,
  ScenarioDefinition,
  ChatMessageDefinition,
} from '@incident/shared';
import {
  mergedChatMessages,
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
      kind: 'chat';
      atMs: number;
      message: ChatMessageDefinition;
      unread: boolean;
    };

export interface CanvasViewModel {
  unreadNotificationCount: number;
  mergedChatMessages: ChatMessageDefinition[];
  visibleRunbooks: RunbookDefinition[];
  unreadChat: boolean;
  recentChatMessages: ChatMessageDefinition[];
  notificationPanelItems: NotificationPanelItem[];
}

export function buildCanvasViewModel(
  state: GameRenderState,
  scenario?: ScenarioDefinition
): CanvasViewModel {
  const chatMessages = mergedChatMessages(state);
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
    ...chatMessages.map((message) => ({
      kind: 'chat' as const,
      atMs: message.atMs,
      message,
      unread: !state.seenChatIds.includes(message.id),
    })),
  ].toSorted((left, right) => right.atMs - left.atMs);

  return {
    unreadNotificationCount: unreadNotificationCount(state),
    mergedChatMessages: chatMessages,
    visibleRunbooks: runbooks,
    unreadChat: chatMessages.some(
      (message) => !state.seenChatIds.includes(message.id)
    ),
    recentChatMessages: chatMessages.slice(-12),
    notificationPanelItems,
  };
}
