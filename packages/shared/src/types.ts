import type {ReplayEventType} from './replayEventTypes.js';

export type Difficulty = 'beginner' | 'intermediate' | 'advanced';

export type SessionStatus =
  | 'created'
  | 'briefing'
  | 'running'
  | 'resolved'
  | 'failed'
  | 'retired'
  | 'aborted';

export {
  REPLAY_VISIBILITY_VALUES,
  type ReplayVisibility,
} from './replayVisibility.js';

export type Actor = 'player' | 'system' | 'scenario' | 'sandbox';

export type {ReplayEventType} from './replayEventTypes.js';
export {REPLAY_EVENT_TYPES} from './replayEventTypes.js';

export interface ReplayEvent {
  id: string;
  replayId: string;
  type: ReplayEventType;
  at: number;
  wallTime?: string;
  actor: Actor;
  payload: Record<string, unknown>;
  visibility: 'public_safe' | 'private' | 'sensitive';
}

export interface AlertDefinition {
  id: string;
  atMs: number;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  source: 'scenario' | 'monitor';
}

export interface ProcessStopTrigger {
  id: string;
  atMs: number;
  type: 'process_stop';
  params: {processId: string};
}

export interface ProcessHangTrigger {
  id: string;
  atMs: number;
  type: 'process_hang';
  params: {processId: string};
}

export interface PortConflictTrigger {
  id: string;
  atMs: number;
  type: 'port_conflict';
  params: {port?: number; processId?: string};
}

export interface DiskFullTrigger {
  id: string;
  atMs: number;
  type: 'disk_full';
  params: {path: string; bytes: number};
}

export interface KodamaBatchFailureTrigger {
  id: string;
  atMs: number;
  type: 'kodama_batch_failure';
  params: {jobId: string; path: string; specInComments?: boolean};
}

export interface QueueBacklogTrigger {
  id: string;
  atMs: number;
  type: 'queue_backlog';
  params: {count: number};
}

export interface BadDeployTrigger {
  id: string;
  atMs: number;
  type: 'bad_deploy';
  params: {configPath?: string};
}

export interface DbPoolExhaustTrigger {
  id: string;
  atMs: number;
  type: 'db_pool_exhaust';
  params: {connections?: number; maxConnections?: number};
}

export interface DnsMisconfigTrigger {
  id: string;
  atMs: number;
  type: 'dns_misconfig';
  params: {hostsPath?: string};
}

export interface MonitorBlindTrigger {
  id: string;
  atMs: number;
  type: 'monitor_blind';
  params: {blindMetrics: string[]};
}

export interface CompositeRestartLoopTrigger {
  id: string;
  atMs: number;
  type: 'composite_restart_loop';
  params: {diskPath: string; bytes: number; processId: string};
}

export interface JanitorPowerPullTrigger {
  id: string;
  atMs: number;
  type: 'janitor_power_pull';
  params: {processId?: string};
}

export interface CableJumpropeTrigger {
  id: string;
  atMs: number;
  type: 'cable_jumprope';
  params: {processId?: string};
}

export interface RunawayLoadgenTrigger {
  id: string;
  atMs: number;
  type: 'runaway_loadgen';
  params: {targetUrl?: string};
}

export interface AlertSpamTrigger {
  id: string;
  atMs: number;
  type: 'alert_spam';
  params: {count?: number};
}

export interface RunbookGaslightTrigger {
  id: string;
  atMs: number;
  type: 'runbook_gaslight';
  params: {replacement?: string};
}

export type ScenarioTrigger =
  | ProcessStopTrigger
  | ProcessHangTrigger
  | PortConflictTrigger
  | DiskFullTrigger
  | KodamaBatchFailureTrigger
  | QueueBacklogTrigger
  | BadDeployTrigger
  | DbPoolExhaustTrigger
  | DnsMisconfigTrigger
  | MonitorBlindTrigger
  | CompositeRestartLoopTrigger
  | JanitorPowerPullTrigger
  | CableJumpropeTrigger
  | RunawayLoadgenTrigger
  | AlertSpamTrigger
  | RunbookGaslightTrigger;

export type NavigationPanel =
  | 'metrics'
  | 'terminal'
  | 'editor'
  | 'runbook'
  | 'chat';

export interface NavigationStep {
  id: string;
  atMs: number;
  hint: string;
  panel?: NavigationPanel;
  suggestedCommand?: string;
}

export const PARTICIPANT_ROLES = [
  'incident_commander',
  'ops',
  'scribe',
  'comms',
  'facilitator',
  'observer',
] as const;

export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

export type ExercisePhase =
  | 'lobby'
  | 'briefing'
  | 'running'
  | 'resolved'
  | 'hotwash'
  | 'aar';

export interface ParticipantCursor {
  x: number;
  y: number;
  visible: boolean;
  updatedAt: string;
}

export interface ParticipantCursorEvent {
  sessionId: string;
  participantId: string;
  x: number;
  y: number;
  visible: boolean;
  updatedAt: string;
}

export interface ParticipantPresence {
  participantId: string;
  displayName: string;
  role: ParticipantRole;
  teamId?: string | undefined;
  ready: boolean;
  online: boolean;
  joinedAt: string;
  lastSeenAt: string;
  cursor?: ParticipantCursor | undefined;
}

export type ExerciseTaskStatus = 'open' | 'in_progress' | 'done' | 'blocked';

export interface ExerciseTask {
  id: string;
  title: string;
  status: ExerciseTaskStatus;
  assigneeParticipantId?: string | undefined;
  createdByParticipantId?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface ExerciseInjectDefinition {
  id: string;
  atMs?: number;
  title: string;
  body: string;
  roleHint?: ParticipantRole;
}

export interface ExerciseInject {
  id: string;
  title: string;
  body: string;
  fired: boolean;
  firedAt?: string | undefined;
  firedByParticipantId?: string | undefined;
  atMs?: number | undefined;
  roleHint?: ParticipantRole | undefined;
}

export type IncidentLogEntryKind =
  | 'note'
  | 'decision'
  | 'hypothesis'
  | 'comms'
  | 'follow_up'
  | 'role_deviation';

export interface IncidentLogEntry {
  id: string;
  kind: IncidentLogEntryKind;
  body: string;
  actorParticipantId?: string | undefined;
  createdAt: string;
  updatedAt?: string | undefined;
}

export interface HotwashNote {
  id: string;
  participantId?: string | undefined;
  wentWell: string;
  improve: string;
  followUp: string;
  createdAt: string;
}

export interface AfterActionReport {
  sessionId: string;
  generatedAt: string;
  participants: ParticipantPresence[];
  tasks: ExerciseTask[];
  injects: ExerciseInject[];
  incidentLog: IncidentLogEntry[];
  hotwashNotes: HotwashNote[];
}

export interface ExerciseSnapshot {
  sessionId: string;
  phase: ExercisePhase;
  hostParticipantId: string | null;
  participants: ParticipantPresence[];
  tasks: ExerciseTask[];
  injects: ExerciseInject[];
  incidentLog: IncidentLogEntry[];
  hotwashNotes: HotwashNote[];
}

export interface ScenarioExerciseDefinition {
  injects?: ExerciseInjectDefinition[];
}

export interface EditorPanelState {
  files: Array<{path: string; size?: number}>;
  currentPath: string | undefined;
  content: string;
  savedContent: string;
  dirty: boolean;
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'error';
  error: string | undefined;
  cursor: {line: number; column: number};
}

export interface GameNavigationState {
  dismissedStepIds: string[];
  activeStepId?: string;
}

export interface NotificationState {
  panelOpen: boolean;
  readAlertIds: string[];
  pulseMs: number;
}

export type SuccessCondition =
  | {type: 'http_status'; url: string; status: number}
  | {type: 'disk_usage_below'; path: string; valuePercent: number}
  | {type: 'process_running'; processId: string}
  | {type: 'process_absent'; processId: string}
  | {type: 'log_absent'; path: string; pattern: string}
  | {type: 'kodama_batch_ok'; jobId: string};

export type RunbookStepStatus =
  | 'pending'
  | 'current'
  | 'done'
  | 'failed'
  | 'skipped';

export interface RunbookStepDefinition {
  id: string;
  instruction: string;
  command?: string;
}

/** コマンド履歴との正規化後完全一致で見つかった、手順が実行された痕跡。 */
export interface RunbookStepEvidence {
  kind: 'command_executed';
  command: string;
  at: number;
}

export interface RunbookDefinition {
  id: string;
  title: string;
  body: string;
  availableAtMs?: number;
  /** Sandbox path whose live content should override `body` once fetched. */
  file?: string;
  /** 番号付き行のパース結果を上書きする明示的な手順一覧(任意)。 */
  steps?: RunbookStepDefinition[];
}

export interface ChatMessageDefinition {
  id: string;
  atMs: number;
  from: string;
  body: string;
}

export type ScenarioTopologyNodeKind =
  | 'external'
  | 'service'
  | 'datastore'
  | 'batch';

export interface ScenarioTopologyNode {
  /** Unique within the graph. */
  id: string;
  /** Display name (Japanese allowed). */
  label: string;
  kind: ScenarioTopologyNodeKind;
  /** Reference to scenario.startup[].id. Only set for nodes backed by a real process. */
  processId?: string;
}

export interface ScenarioTopologyEdge {
  /** Caller node id (from depends on to). */
  from: string;
  to: string;
}

export interface ScenarioTopology {
  nodes: ScenarioTopologyNode[];
  edges: ScenarioTopologyEdge[];
}

export type ServiceHealth = 'healthy' | 'degraded' | 'down';

export interface ScenarioDefinition {
  id: string;
  version: number;
  title: string;
  difficulty: Difficulty;
  /** 難易度区分内の表示順・細かい難易度を表す整数(小さいほど易しい)。 */
  difficultyScore: number;
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
  chatMessages: ChatMessageDefinition[];
  navigationSteps?: NavigationStep[];
  exercise?: ScenarioExerciseDefinition;
  topology?: ScenarioTopology;
}

export interface MetricsSnapshot {
  at: number;
  /** null when the monitoring source is blind (agent dead or data stale). */
  cpu: number | null;
  /** null when the monitoring source is blind (agent dead or data stale). */
  memory: number | null;
  disk: number;
  http5xxRate: number;
  latencyP95Ms: number;
  rps: number;
  dbConnections: number;
  queueDepth: number;
  /** Live sandbox file content for file-backed runbooks, keyed by runbook id. */
  runbookFiles?: Record<string, string>;
}

export type MetricsSource = 'loading' | 'live' | 'offline';

export interface TerminalMirrorState {
  cols: number;
  rows: number;
  lines: string[];
  cursor: {x: number; y: number; visible: boolean};
  title?: string;
  commandDraft: string;
  commandHistory: Array<{at: number; command: string}>;
}

export interface GameRenderState {
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
      /** Browser round-trip to GET /api/sessions/:id/clock (verification only). */
      edgeRttMs: number | null;
      edgeRttHistory: number[];
      alerts: AlertDefinition[];
      /** Per scenario.topology node id. Wiring from worker state is a follow-up task. */
      serviceHealth?: Record<string, ServiceHealth>;
    };
    center: {
      activeTool: 'terminal' | 'editor';
      terminal: TerminalMirrorState;
      editor: EditorPanelState;
    };
    right: {
      activePanelTab: 'runbook' | 'chat';
      activeRunbook?: RunbookDefinition | undefined;
      activeRunbookIndex: number;
      chatMessages: ChatMessageDefinition[];
      /** Live sandbox file content for file-backed runbooks, keyed by runbook id. */
      runbookFileContents?: Record<string, string>;
    };
  };
  navigation: GameNavigationState;
  notifications: NotificationState;
  seenChatIds: string[];
  playerChatMessages: ChatMessageDefinition[];
  chatCompose: {
    active: boolean;
    draft: string;
  };
  openedRunbookIds: string[];
  /**
   * アクティブな Runbook の手順進捗。runbookId+bodyHash がキー
   * (gaslight 等で本文が書き換わると自然に破棄・再構築される)。
   */
  runbookProgress?: {
    runbookId: string;
    bodyHash: string;
    steps: Array<{
      stepId: string;
      manualStatus?: 'done' | 'failed' | 'skipped';
      evidence?: RunbookStepEvidence;
    }>;
  };
  alertFlashMs: number;
  warning?: {message: string; flashMs: number};
  world: {
    /** Narrative hour from midnight (0–6) mapped across the session time limit. */
    narrativeHour: number;
    expandedMonitor: 'metrics' | 'terminal' | 'runbook' | null;
  };
  commandInputFocused: boolean;
  cursor: {x: number; y: number; visible: boolean};
  /** Local multiplayer participant id; remote cursor draw skips this id. */
  localParticipantId?: string;
  room: {
    participants: ParticipantPresence[];
    tasks: ExerciseTask[];
    incidentLog: IncidentLogEntry[];
    injects: ExerciseInject[];
  };
  clickEffects: Array<{id: string; x: number; y: number; ageMs: number}>;
  recording: {
    status:
      | 'idle'
      | 'consent_required'
      | 'initializing'
      | 'recording'
      | 'stopping'
      | 'finalizing'
      | 'ready'
      | 'recording_error'
      | 'upload_degraded'
      | 'finalization_failed'
      | 'unsupported_browser';
    mimeType?: string;
    chunkCount: number;
    saveEnabled: boolean;
  };
}

export type ApiResult<T> =
  | {ok: true; data: T}
  | {ok: false; error: {code: string; message: string}};
