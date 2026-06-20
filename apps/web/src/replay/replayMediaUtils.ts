export type TimelineEntry = { id?: string; at: number; label: string };

export type IndexedReplayEvent = {
  event_id: string;
  type: string;
  at_ms: number;
  summary?: string | null;
};

const timelineEventTypes = new Set([
  "session_start",
  "session_end",
  "alert",
  "scenario_event",
  "monitor_update",
  "command_detected",
  "ui_panel_open",
  "runbook_open",
  "file_opened",
  "file_saved",
  "service_restart",
  "recovery_check",
  "incident_resolved",
  "player_note"
]);

export function isTimelineEventType(type: string) {
  return timelineEventTypes.has(type);
}

export function buildTimelineFromEvents(
  events: IndexedReplayEvent[],
  fallback: TimelineEntry[] = []
): Required<TimelineEntry>[] {
  const fromEvents = events
    .filter((event) => isTimelineEventType(event.type))
    .map((event) => ({
      id: event.event_id,
      at: event.at_ms / 1000,
      label: timelineLabel(event)
    }));
  const source = fromEvents.length > 0 ? fromEvents : fallback.filter((entry) => entry.label.length > 0);
  return source
    .map((event, index) => ({
      id: event.id ?? `fallback-${index}-${event.at}-${event.label}`,
      at: event.at,
      label: event.label
    }))
    .sort((a, b) => a.at - b.at);
}

export function filterImportantEvents(events: IndexedReplayEvent[]) {
  const important = new Set([
    "alert",
    "incident_resolved",
    "recovery_check",
    "player_note",
    "runbook_open",
    "service_restart",
    "session_end"
  ]);
  return events.filter((event) => important.has(event.type));
}

export function parseBrowserInfo(raw: string | null | undefined) {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Infer game-time offset where wall-clock recording likely began. */
export function inferRecordingStartedAtGameMs(durationMs: number, videoDurationSec: number) {
  const gameDurationMs = Math.max(0, durationMs);
  const videoDurationMs = Math.max(0, videoDurationSec * 1000);
  if (gameDurationMs === 0 || videoDurationMs === 0) return 0;
  if (videoDurationMs >= gameDurationMs) return 0;
  return gameDurationMs - videoDurationMs;
}

export function parseRecordingStartedAtGameMs(
  browserInfo: unknown,
  durationMs: number,
  videoDurationSec: number
) {
  if (browserInfo && typeof browserInfo === "object" && !Array.isArray(browserInfo)) {
    const value = (browserInfo as { recordingStartedAtGameMs?: unknown }).recordingStartedAtGameMs;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return inferRecordingStartedAtGameMs(durationMs, videoDurationSec);
}

/** Map game-clock seconds to wall-clock video position. */
export function gameTimeToVideoSeekSeconds(
  gameSeconds: number,
  videoDurationSec: number,
  durationMs: number,
  recordingStartedAtGameMs?: number | null
) {
  const recordStartMs = typeof recordingStartedAtGameMs === "number" && recordingStartedAtGameMs >= 0
    ? recordingStartedAtGameMs
    : inferRecordingStartedAtGameMs(durationMs, videoDurationSec);
  const recordStartSec = recordStartMs / 1000;
  const gameDurationSec = durationMs / 1000;
  const recordedGameSpanSec = Math.max(0.001, gameDurationSec - recordStartSec);
  const gameSecondsInRecording = Math.max(0, gameSeconds - recordStartSec);
  if (!Number.isFinite(videoDurationSec) || videoDurationSec <= 0) return gameSecondsInRecording;
  return (gameSecondsInRecording / recordedGameSpanSec) * videoDurationSec;
}

export function timelineDisplaySeconds(
  gameSeconds: number,
  hasVideo: boolean,
  videoDurationSec: number,
  durationMs: number,
  recordingStartedAtGameMs?: number | null
) {
  if (!hasVideo || videoDurationSec <= 0) return gameSeconds;
  return gameTimeToVideoSeekSeconds(gameSeconds, videoDurationSec, durationMs, recordingStartedAtGameMs);
}

export function formatSeconds(seconds: number) {
  const min = Math.floor(seconds / 60).toString().padStart(2, "0");
  const sec = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${min}:${sec}`;
}

export function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const sec = (totalSeconds % 60).toString().padStart(2, "0");
  return `${min}:${sec}`;
}

function timelineLabel(event: IndexedReplayEvent) {
  const summary = event.summary?.trim();
  if (summary && summary !== event.type) return summary;
  return defaultTimelineLabel(event.type);
}

function defaultTimelineLabel(type: string) {
  switch (type) {
    case "session_start":
      return "シナリオ開始";
    case "session_end":
      return "セッション終了";
    case "incident_resolved":
      return "復旧宣言";
    case "monitor_update":
      return "メトリクス更新";
    default:
      return type;
  }
}
