import type {
  GameRenderState,
  RunbookDefinition,
  ScenarioDefinition,
  ChatMessageDefinition,
} from '@incident/shared';

export function visibleRunbooks(
  scenario: ScenarioDefinition,
  elapsedMs: number,
  fileContents?: Record<string, string>
): RunbookDefinition[] {
  return scenario.runbooks
    .filter((runbook) => (runbook.availableAtMs ?? 0) <= elapsedMs)
    .map((runbook) => {
      const liveBody = runbook.file ? fileContents?.[runbook.id] : undefined;
      return liveBody === undefined ? runbook : {...runbook, body: liveBody};
    });
}

export function mergedChatMessages(
  state: GameRenderState
): ChatMessageDefinition[] {
  return [
    ...state.monitors.right.chatMessages,
    ...state.playerChatMessages,
  ].toSorted((a, b) => a.atMs - b.atMs);
}

export function unreadNotificationCount(state: GameRenderState) {
  const unreadAlerts = state.monitors.left.alerts.filter(
    (alert) => !state.notifications.readAlertIds.includes(alert.id)
  ).length;
  const unreadChat = mergedChatMessages(state).filter(
    (message) => !state.seenChatIds.includes(message.id)
  ).length;
  return unreadAlerts + unreadChat;
}

export function unreadAlertCount(state: GameRenderState) {
  return state.monitors.left.alerts.filter(
    (alert) => !state.notifications.readAlertIds.includes(alert.id)
  ).length;
}

export function computeNarrativeHour(elapsedMs: number, timeLimitMs: number) {
  const limitMs = Math.max(timeLimitMs, 1);
  return Math.min(6, (elapsedMs / limitMs) * 6);
}
