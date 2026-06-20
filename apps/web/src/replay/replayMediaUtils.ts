export type TimelineEntry = { at: number; label: string };

export type IndexedReplayEvent = {
  event_id: string;
  type: string;
  at_ms: number;
  summary?: string | null;
};

export function buildTimelineFromEvents(
  events: IndexedReplayEvent[],
  fallback: TimelineEntry[] = []
): TimelineEntry[] {
  const fromEvents = events
    .filter((event) => event.type !== "recording_chunk_created")
    .map((event) => ({ at: event.at_ms / 1000, label: event.summary || event.type }));
  const source = fromEvents.length > 0 ? fromEvents : fallback;
  return [...source].sort((a, b) => a.at - b.at);
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
