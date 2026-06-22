export interface TimelineEntry {
  id?: string;
  at: number;
  label: string;
  type?: string;
}
export interface BuiltTimelineEntry {
  id: string;
  at: number;
  label: string;
  type?: string;
}

export interface RecordingClockSegment {
  gameMs: number;
  videoMs: number;
  speed: number;
}

export interface IndexedReplayEvent {
  event_id: string;
  type: string;
  at_ms: number;
  summary?: string | null;
}

const timelineEventTypes = new Set([
  'session_start',
  'session_end',
  'alert',
  'scenario_event',
  'monitor_update',
  'command_detected',
  'ui_panel_open',
  'runbook_open',
  'file_opened',
  'file_saved',
  'service_restart',
  'recovery_check',
  'incident_resolved',
  'player_note',
]);

export function isTimelineEventType(type: string) {
  return timelineEventTypes.has(type);
}

export function buildTimelineFromEvents(
  events: IndexedReplayEvent[],
  fallback: TimelineEntry[] = []
): BuiltTimelineEntry[] {
  const fromEvents = events
    .filter((event) => isTimelineEventType(event.type))
    .map((event) => ({
      id: event.event_id,
      at: event.at_ms / 1000,
      type: event.type,
      label: timelineLabel(event),
    }));
  const source =
    fromEvents.length > 0
      ? fromEvents
      : fallback.filter((entry) => entry.label.length > 0);
  return source
    .map((event, index) => ({
      id:
        event.id ??
        `fallback-${String(index)}-${String(event.at)}-${event.label}`,
      at: event.at,
      ...(event.type === undefined ? {} : {type: event.type}),
      label: event.label,
    }))
    .toSorted((a, b) => a.at - b.at);
}

export function filterImportantEvents(events: IndexedReplayEvent[]) {
  const important = new Set([
    'alert',
    'incident_resolved',
    'recovery_check',
    'player_note',
    'runbook_open',
    'service_restart',
    'session_end',
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
export function inferRecordingStartedAtGameMs(
  durationMs: number,
  videoDurationSec: number
) {
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
  if (
    browserInfo &&
    typeof browserInfo === 'object' &&
    !Array.isArray(browserInfo)
  ) {
    const value = (browserInfo as {recordingStartedAtGameMs?: unknown})
      .recordingStartedAtGameMs;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return inferRecordingStartedAtGameMs(durationMs, videoDurationSec);
}

export function parseRecordingClockSegments(
  browserInfo: unknown
): RecordingClockSegment[] | undefined {
  if (
    !browserInfo ||
    typeof browserInfo !== 'object' ||
    Array.isArray(browserInfo)
  ) {
    return undefined;
  }
  const raw = (browserInfo as {recordingClockSegments?: unknown})
    .recordingClockSegments;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const segments = raw
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return undefined;
      }
      const {gameMs, videoMs, speed} = item as Record<string, unknown>;
      if (
        !isValidMs(gameMs) ||
        !isValidMs(videoMs) ||
        typeof speed !== 'number' ||
        !Number.isFinite(speed) ||
        speed <= 0
      ) {
        return undefined;
      }
      return {gameMs, videoMs, speed};
    })
    .filter(
      (segment): segment is RecordingClockSegment => segment !== undefined
    )
    .sort((a, b) => a.gameMs - b.gameMs);
  return segments.length > 0 ? segments : undefined;
}

/** Map game-clock seconds to wall-clock video position. */
export function gameTimeToVideoSeekSeconds(
  gameSeconds: number,
  videoDurationSec: number,
  durationMs: number,
  recordingStartedAtGameMs?: number | null,
  recordingClockSegments?: RecordingClockSegment[] | null
) {
  if (recordingClockSegments?.length) {
    return clampSeconds(
      gameTimeToVideoSeekSecondsFromSegments(
        gameSeconds,
        recordingClockSegments
      ),
      videoDurationSec
    );
  }
  const recordStartMs =
    typeof recordingStartedAtGameMs === 'number' &&
    recordingStartedAtGameMs >= 0
      ? recordingStartedAtGameMs
      : inferRecordingStartedAtGameMs(durationMs, videoDurationSec);
  const recordStartSec = recordStartMs / 1000;
  const gameDurationSec = durationMs / 1000;
  const recordedGameSpanSec = Math.max(0.001, gameDurationSec - recordStartSec);
  const gameSecondsInRecording = Math.max(0, gameSeconds - recordStartSec);
  if (!Number.isFinite(videoDurationSec) || videoDurationSec <= 0) {
    return gameSecondsInRecording;
  }
  return clampSeconds(
    (gameSecondsInRecording / recordedGameSpanSec) * videoDurationSec,
    videoDurationSec
  );
}

export function timelineDisplaySeconds(
  gameSeconds: number,
  hasVideo: boolean,
  videoDurationSec: number,
  durationMs: number,
  recordingStartedAtGameMs?: number | null,
  recordingClockSegments?: RecordingClockSegment[] | null
) {
  if (!hasVideo) return gameSeconds;
  return gameTimeToVideoSeekSeconds(
    gameSeconds,
    videoDurationSec,
    durationMs,
    recordingStartedAtGameMs,
    recordingClockSegments
  );
}

export function formatSeconds(seconds: number) {
  const min = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const sec = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${min}:${sec}`;
}

export function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const sec = (totalSeconds % 60).toString().padStart(2, '0');
  return `${min}:${sec}`;
}

function gameTimeToVideoSeekSecondsFromSegments(
  gameSeconds: number,
  segments: RecordingClockSegment[]
) {
  const gameMs = Math.max(0, gameSeconds * 1000);
  const firstSegment = segments[0];
  if (!firstSegment) return 0;
  let segment = firstSegment;
  for (const candidate of segments) {
    if (candidate.gameMs > gameMs) break;
    segment = candidate;
  }
  const deltaGameMs = Math.max(0, gameMs - segment.gameMs);
  return (segment.videoMs + deltaGameMs / segment.speed) / 1000;
}

function clampSeconds(seconds: number, durationSec: number) {
  if (!Number.isFinite(seconds)) return 0;
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return Math.max(0, seconds);
  }
  return Math.min(durationSec, Math.max(0, seconds));
}

function isValidMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function timelineLabel(event: IndexedReplayEvent) {
  const summary = event.summary?.trim();
  if (summary && summary !== event.type) return summary;
  return defaultTimelineLabel(event.type);
}

function defaultTimelineLabel(type: string) {
  switch (type) {
    case 'session_start':
      return 'シナリオ開始';
    case 'session_end':
      return 'セッション終了';
    case 'incident_resolved':
      return '復旧宣言';
    case 'monitor_update':
      return 'メトリクス更新';
    default:
      return type;
  }
}
