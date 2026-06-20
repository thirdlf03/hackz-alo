import type { Actor, ReplayEvent, ReplayEventType } from "./types.js";

let localCounter = 0;

export function createReplayEvent(input: {
  replayId: string;
  type: ReplayEventType;
  at: number;
  actor: Actor;
  payload?: Record<string, unknown>;
  visibility?: ReplayEvent["visibility"];
}): ReplayEvent {
  localCounter += 1;
  return {
    id: `evt_${Date.now().toString(36)}_${localCounter.toString(36)}`,
    replayId: input.replayId,
    type: input.type,
    at: Math.max(0, Math.floor(input.at)),
    wallTime: new Date().toISOString(),
    actor: input.actor,
    payload: input.payload ?? {},
    visibility: input.visibility ?? "public_safe"
  };
}

export function toJsonLine(event: ReplayEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function replayEventSummary(event: ReplayEvent): string {
  if (event.type === "terminal_input" && typeof event.payload.data === "string") {
    return `command: ${event.payload.data.trim()}`;
  }
  if (event.type === "alert" && typeof event.payload.message === "string") {
    return `alert: ${event.payload.message}`;
  }
  if (event.type === "runbook_open" && typeof event.payload.runbookId === "string") {
    return `runbook: ${event.payload.runbookId}`;
  }
  return event.type;
}
