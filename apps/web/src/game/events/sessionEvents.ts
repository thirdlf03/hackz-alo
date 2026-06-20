import type { AlertDefinition, GameRenderState, ScenarioDefinition, SlackMessageDefinition } from "@incident/shared";
import type { ReplayEventEmitter } from "./emitReplayEvent.js";

export async function emitNewAlerts(
  emitter: ReplayEventEmitter,
  replayId: string,
  elapsedMs: number,
  previous: AlertDefinition[],
  next: AlertDefinition[]
) {
  const previousIds = new Set(previous.map((alert) => alert.id));
  for (const alert of next) {
    if (previousIds.has(alert.id)) continue;
    await emitter.emitOnce(`alert:${alert.id}`, {
      replayId,
      type: "alert",
      at: elapsedMs,
      actor: "scenario",
      payload: { alertId: alert.id, message: alert.message, severity: alert.severity }
    });
  }
}

export async function emitNewSlackMessages(
  emitter: ReplayEventEmitter,
  replayId: string,
  elapsedMs: number,
  previous: SlackMessageDefinition[],
  next: SlackMessageDefinition[]
) {
  const previousIds = new Set(previous.map((message) => message.id));
  for (const message of next) {
    if (previousIds.has(message.id)) continue;
    await emitter.emitOnce(`slack:${message.id}`, {
      replayId,
      type: "slack_message_read",
      at: elapsedMs,
      actor: "system",
      payload: { messageId: message.id, from: message.from }
    });
  }
}

export function collectStateTransitions(
  previous: GameRenderState | undefined,
  next: GameRenderState,
  scenario: ScenarioDefinition | undefined,
  elapsedMs: number,
  emitter: ReplayEventEmitter,
  replayId: string
) {
  if (!previous || !scenario) return;
  void emitNewSlackMessages(
    emitter,
    replayId,
    elapsedMs,
    previous.monitors.right.slackMessages,
    next.monitors.right.slackMessages
  );
}
