import type {
  GameRenderState,
  IncidentLogEntryKind,
  ServiceHealth,
} from '@incident/shared';

const TERMINAL_RECENT_LINES = 15;
const RECENT_COMMANDS = 5;
const RECENT_ALERTS = 8;
const RECENT_LOG_ENTRIES = 8;
const RECENT_TASKS = 10;

export interface IncidentOverview {
  scenario: {id: string; title: string; difficulty: string; status: string};
  clock: {elapsedSeconds: number; timeLimitSeconds: number; speed: number};
  metrics: {
    source: string;
    cpu: number;
    memory: number;
    disk: number;
    http5xxRate: number;
    latencyP95Ms: number;
    rps: number;
    dbConnections: number;
    queueDepth: number;
  };
  serviceHealth: Record<string, ServiceHealth>;
  alerts: Array<{severity: string; message: string}>;
  terminal: {recentLines: string[]; recentCommands: string[]};
  tasks: Array<{id: string; title: string; status: string}>;
  incidentLog: Array<{kind: string; body: string}>;
  injects: Array<{id: string; title: string; fired: boolean}>;
  participants: Array<{name: string; role: string; online: boolean}>;
}

export function summarizeIncidentState(
  state: GameRenderState | undefined
): IncidentOverview | undefined {
  if (!state) return undefined;
  const terminal = state.monitors.center.terminal;
  const lines = terminal.lines.map((line) => line.trimEnd());
  while (lines.length > 0 && lines.at(-1) === '') {
    lines.pop();
  }
  return {
    scenario: {
      id: state.session.scenarioId,
      title: state.session.scenarioTitle,
      difficulty: state.session.difficulty,
      status: state.session.status,
    },
    clock: {
      elapsedSeconds: Math.round(state.clock.elapsedMs / 1000),
      timeLimitSeconds: Math.round(state.clock.timeLimitMs / 1000),
      speed: state.clock.speed,
    },
    metrics: {
      source: state.monitors.left.metricsSource,
      cpu: state.monitors.left.metrics.cpu,
      memory: state.monitors.left.metrics.memory,
      disk: state.monitors.left.metrics.disk,
      http5xxRate: state.monitors.left.metrics.http5xxRate,
      latencyP95Ms: state.monitors.left.metrics.latencyP95Ms,
      rps: state.monitors.left.metrics.rps,
      dbConnections: state.monitors.left.metrics.dbConnections,
      queueDepth: state.monitors.left.metrics.queueDepth,
    },
    serviceHealth: state.monitors.left.serviceHealth ?? {},
    alerts: state.monitors.left.alerts
      .slice(-RECENT_ALERTS)
      .map((alert) => ({severity: alert.severity, message: alert.message})),
    terminal: {
      recentLines: lines.slice(-TERMINAL_RECENT_LINES),
      recentCommands: terminal.commandHistory
        .slice(-RECENT_COMMANDS)
        .map((entry) => entry.command),
    },
    tasks: state.room.tasks
      .slice(-RECENT_TASKS)
      .map((task) => ({id: task.id, title: task.title, status: task.status})),
    incidentLog: state.room.incidentLog
      .slice(-RECENT_LOG_ENTRIES)
      .map((entry) => ({kind: entry.kind, body: entry.body})),
    injects: state.room.injects.map((inject) => ({
      id: inject.id,
      title: inject.title,
      fired: inject.fired,
    })),
    participants: state.room.participants.map((participant) => ({
      name: participant.displayName,
      role: participant.role,
      online: participant.online,
    })),
  };
}

export const INCIDENT_LOG_KINDS: IncidentLogEntryKind[] = [
  'note',
  'decision',
  'hypothesis',
  'comms',
  'follow_up',
];

export interface WebMcpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {readOnlyHint?: boolean};
}

export const WEBMCP_TOOL_DEFS = {
  overview: {
    name: 'get_incident_overview',
    description:
      '進行中のインシデント対応訓練の現在状況を JSON で返す。シナリオ、経過時間、メトリクス、サービスヘルス、アラート、ターミナル画面の直近出力、タスク、インシデントログ、インジェクト一覧、参加者を含む。まずこのツールで状況を把握すること。',
    inputSchema: {type: 'object', properties: {}},
    annotations: {readOnlyHint: true},
  },
  createTask: {
    name: 'create_incident_task',
    description:
      '対応タスクをチームのタスクボードに追加する。具体的で短いタイトルにすること。',
    inputSchema: {
      type: 'object',
      properties: {
        title: {type: 'string', description: 'タスクのタイトル(日本語可)'},
      },
      required: ['title'],
    },
  },
  appendLog: {
    name: 'append_incident_log',
    description:
      'インシデントログ(タイムライン)に記録を追記する。気づき・判断・仮説などを簡潔に残す。',
    inputSchema: {
      type: 'object',
      properties: {
        body: {type: 'string', description: '記録する本文'},
        kind: {
          type: 'string',
          enum: INCIDENT_LOG_KINDS,
          description: '記録の種類(省略時は note)',
        },
      },
      required: ['body'],
    },
  },
  fireInject: {
    name: 'fire_inject',
    description:
      '訓練シナリオのインジェクト(追加イベント)を発火させる。get_incident_overview の injects にある未発火 id のみ指定可能。発火すると訓練の難度が上がるため、参加者の合意がある場合のみ使うこと。',
    inputSchema: {
      type: 'object',
      properties: {
        injectId: {type: 'string', description: '発火させるインジェクトの id'},
      },
      required: ['injectId'],
    },
  },
} as const satisfies Record<string, WebMcpToolDefinition>;

export function parseCreateTaskArgs(
  args: unknown
): {title: string} | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const title = (args as {title?: unknown}).title;
  if (typeof title !== 'string' || title.trim() === '') return undefined;
  return {title: title.trim().slice(0, 200)};
}

export function parseAppendLogArgs(
  args: unknown
): {body: string; kind: IncidentLogEntryKind} | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const {body, kind} = args as {body?: unknown; kind?: unknown};
  if (typeof body !== 'string' || body.trim() === '') return undefined;
  const resolvedKind = INCIDENT_LOG_KINDS.find((value) => value === kind);
  return {
    body: body.trim().slice(0, 1000),
    kind: resolvedKind ?? 'note',
  };
}

export function parseFireInjectArgs(
  args: unknown
): {injectId: string} | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const injectId = (args as {injectId?: unknown}).injectId;
  if (typeof injectId !== 'string' || injectId.trim() === '') return undefined;
  return {injectId: injectId.trim()};
}
