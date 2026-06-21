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
  | "file_saved"
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
  params: { jobId: string; path: string; specInComments?: boolean };
};

export type QueueBacklogTrigger = {
  id: string;
  atMs: number;
  type: "queue_backlog";
  params: { count: number };
};

export type BadDeployTrigger = {
  id: string;
  atMs: number;
  type: "bad_deploy";
  params: { configPath: string };
};

export type DbPoolExhaustTrigger = {
  id: string;
  atMs: number;
  type: "db_pool_exhaust";
  params: { maxConnections: number };
};

export type MemoryLeakTrigger = {
  id: string;
  atMs: number;
  type: "memory_leak";
  params: { targetPercent: number };
};

export type DnsMisconfigTrigger = {
  id: string;
  atMs: number;
  type: "dns_misconfig";
  params: { hostsPath: string };
};

export type MonitorBlindTrigger = {
  id: string;
  atMs: number;
  type: "monitor_blind";
  params: { blindMetrics: string[] };
};

export type CompositeRestartLoopTrigger = {
  id: string;
  atMs: number;
  type: "composite_restart_loop";
  params: { diskPath: string; bytes: number; processId: string };
};

export type JanitorPowerPullTrigger = {
  id: string;
  atMs: number;
  type: "janitor_power_pull";
  params: { processId?: string };
};

export type CableJumpropeTrigger = {
  id: string;
  atMs: number;
  type: "cable_jumprope";
  params: { hostsPath?: string };
};

export type KeyboardSpillTrigger = {
  id: string;
  atMs: number;
  type: "keyboard_spill";
  params: { noise?: string };
};

export type AlertSpamTrigger = {
  id: string;
  atMs: number;
  type: "alert_spam";
  params: { count?: number };
};

export type RunbookGaslightTrigger = {
  id: string;
  atMs: number;
  type: "runbook_gaslight";
  params: { replacement?: string };
};

export type ScenarioTrigger =
  | ProcessStopTrigger
  | DiskFullTrigger
  | UnlangBatchFailureTrigger
  | QueueBacklogTrigger
  | BadDeployTrigger
  | DbPoolExhaustTrigger
  | MemoryLeakTrigger
  | DnsMisconfigTrigger
  | MonitorBlindTrigger
  | CompositeRestartLoopTrigger
  | JanitorPowerPullTrigger
  | CableJumpropeTrigger
  | KeyboardSpillTrigger
  | AlertSpamTrigger
  | RunbookGaslightTrigger;

export type NavigationPanel = "metrics" | "terminal" | "editor" | "runbook" | "slack";

export type NavigationStep = {
  id: string;
  atMs: number;
  hint: string;
  panel?: NavigationPanel;
  suggestedCommand?: string;
};

export type EditorPanelState = {
  files: Array<{ path: string; size?: number }>;
  currentPath: string | undefined;
  content: string;
  savedContent: string;
  dirty: boolean;
  status: "idle" | "loading" | "ready" | "saving" | "error";
  error: string | undefined;
  cursor: { line: number; column: number };
};

export type GameNavigationState = {
  dismissedStepIds: string[];
  activeStepId?: string;
};

export type NotificationState = {
  panelOpen: boolean;
  readAlertIds: string[];
  pulseMs: number;
};

export type SuccessCondition =
  | { type: "http_status"; url: string; status: number }
  | { type: "disk_usage_below"; path: string; valuePercent: number }
  | { type: "process_running"; processId: string }
  | { type: "marker_absent"; path: string }
  | { type: "log_absent"; path: string; pattern: string }
  | { type: "unlang_batch_ok"; jobId: string };

export type RunbookDefinition = {
  id: string;
  title: string;
  body: string;
  availableAtMs?: number;
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
  navigationSteps?: NavigationStep[];
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

export type MetricsSource = "loading" | "live" | "offline";

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
    speed: number;
  };
  monitors: {
    left: {
      metrics: MetricsSnapshot;
      metricsHistory: MetricsSnapshot[];
      metricsSource: MetricsSource;
      alerts: AlertDefinition[];
    };
    center: {
      activeTool: "terminal" | "editor";
      terminal: TerminalMirrorState;
      editor: EditorPanelState;
    };
    right: {
      activePanelTab: "runbook" | "slack";
      activeRunbook?: RunbookDefinition | undefined;
      activeRunbookIndex: number;
      slackMessages: SlackMessageDefinition[];
    };
  };
  navigation: GameNavigationState;
  notifications: NotificationState;
  seenSlackIds: string[];
  playerSlackMessages: SlackMessageDefinition[];
  slackCompose: {
    active: boolean;
    draft: string;
  };
  openedRunbookIds: string[];
  alertFlashMs: number;
  warning?: { message: string; flashMs: number };
  world: {
    expandedMonitor: "metrics" | "terminal" | "runbook" | null;
  };
  commandInputFocused: boolean;
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
    saveEnabled: boolean;
  };
};

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };
