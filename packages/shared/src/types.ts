export type Difficulty = "beginner" | "intermediate" | "advanced";

export type SessionStatus =
  | "created"
  | "briefing"
  | "running"
  | "resolved"
  | "failed"
  | "retired"
  | "aborted";

export type ReplayVisibility =
  | "private"
  | "self"
  | "unlisted"
  | "team"
  | "public";

export type Actor = "player" | "system" | "scenario" | "sandbox";

export type ReplayEventType =
  | "session_start"
  | "session_end"
  | "scenario_event"
  | "alert"
  | "monitor_update"
  | "terminal_input"
  | "terminal_output"
  | "command_detected"
  | "ui_click"
  | "ui_panel_open"
  | "runbook_open"
  | "slack_message_read"
  | "file_opened"
  | "service_restart"
  | "recovery_check"
  | "incident_resolved"
  | "player_note"
  | "recording_chunk_created"
  | "recording_error"
  | "sandbox_error";

export type ReplayEvent = {
  id: string;
  replayId: string;
  type: ReplayEventType;
  at: number;
  wallTime?: string;
  actor: Actor;
  payload: Record<string, unknown>;
  visibility: "public_safe" | "private" | "sensitive";
};

export type AlertDefinition = {
  id: string;
  atMs: number;
  severity: "info" | "warning" | "critical";
  message: string;
  source: "scenario" | "monitor";
};

export type ProcessStopTrigger = {
  id: string;
  atMs: number;
  type: "process_stop";
  params: { processId: string };
};

export type DiskFullTrigger = {
  id: string;
  atMs: number;
  type: "disk_full";
  params: { path: string; bytes: number };
};

export type UnlangBatchFailureTrigger = {
  id: string;
  atMs: number;
  type: "unlang_batch_failure";
  params: { jobId: string; path: string };
};

export type ScenarioTrigger = ProcessStopTrigger | DiskFullTrigger | UnlangBatchFailureTrigger;

export type SuccessCondition =
  | { type: "http_status"; url: string; status: number }
  | { type: "disk_usage_below"; path: string; valuePercent: number }
  | { type: "process_running"; processId: string }
  | { type: "log_absent"; path: string; pattern: string }
  | { type: "unlang_batch_ok"; jobId: string };

export type RunbookDefinition = {
  id: string;
  title: string;
  body: string;
};

export type SlackMessageDefinition = {
  id: string;
  atMs: number;
  from: string;
  body: string;
};

export type ScenarioDefinition = {
  id: string;
  version: number;
  title: string;
  difficulty: Difficulty;
  timeLimitMinutes: number;
  service: {
    name: string;
    healthUrl: string;
  };
  briefing: string[];
  startup: Array<{
    id: string;
    command: string;
    waitForPort?: number;
  }>;
  triggers: ScenarioTrigger[];
  alerts: AlertDefinition[];
  successConditions: SuccessCondition[];
  runbooks: RunbookDefinition[];
  slackMessages: SlackMessageDefinition[];
};

export type MetricsSnapshot = {
  at: number;
  cpu: number;
  memory: number;
  disk: number;
  http5xxRate: number;
  latencyP95Ms: number;
  rps: number;
  dbConnections: number;
  queueDepth: number;
};

export type TerminalMirrorState = {
  cols: number;
  rows: number;
  lines: string[];
  cursor: { x: number; y: number; visible: boolean };
  title?: string;
  commandDraft: string;
  commandHistory: Array<{ at: number; command: string }>;
};

export type GameRenderState = {
  session: {
    sessionId: string;
    replayId: string;
    scenarioId: string;
    scenarioTitle: string;
    difficulty: Difficulty;
    status: SessionStatus;
  };
  clock: {
    elapsedMs: number;
    timeLimitMs: number;
  };
  monitors: {
    left: {
      metrics: MetricsSnapshot;
      alerts: AlertDefinition[];
    };
    center: {
      terminal: TerminalMirrorState;
    };
    right: {
      activeRunbook?: RunbookDefinition | undefined;
      slackMessages: SlackMessageDefinition[];
    };
  };
  cursor: { x: number; y: number; visible: boolean };
  clickEffects: Array<{ id: string; x: number; y: number; ageMs: number }>;
  recording: {
    status:
      | "idle"
      | "consent_required"
      | "initializing"
      | "recording"
      | "stopping"
      | "finalizing"
      | "ready"
      | "recording_error"
      | "upload_degraded"
      | "finalization_failed"
      | "unsupported_browser";
    mimeType?: string;
    chunkCount: number;
  };
};

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };
