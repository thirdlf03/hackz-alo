export type SessionRouteName =
  | 'bootstrap'
  | 'prepare'
  | 'start'
  | 'resolve'
  | 'recoveryCheck'
  | 'retire'
  | 'timeout'
  | 'delete'
  | 'updateClock'
  | 'terminalResize'
  | 'events'
  | 'clock'
  | 'metrics'
  | 'logs'
  | 'storage'
  | 'files'
  | 'readFile'
  | 'writeFile'
  | 'terminal'
  | 'terminalInterrupt'
  | 'participantJoin'
  | 'participantHeartbeat'
  | 'participantCursor'
  | 'participantRole'
  | 'participantLeave'
  | 'participantOffline'
  | 'exerciseState'
  | 'exerciseReady'
  | 'taskCreate'
  | 'taskUpdate'
  | 'taskDelete'
  | 'injectFire'
  | 'exercisePhase'
  | 'incidentLog'
  | 'incidentLogUpdate'
  | 'incidentLogDelete'
  | 'hotwash'
  | 'aar'
  | 'rtcSignal'
  | 'snapshot';

const routeTable: Record<string, Partial<Record<string, SessionRouteName>>> = {
  POST: {
    bootstrap: 'bootstrap',
    prepare: 'prepare',
    start: 'start',
    resolve: 'resolve',
    retire: 'retire',
    timeout: 'timeout',
    clock: 'updateClock',
    'terminal-resize': 'terminalResize',
    'terminal-interrupt': 'terminalInterrupt',
    'participant-join': 'participantJoin',
    'participant-heartbeat': 'participantHeartbeat',
    'participant-cursor': 'participantCursor',
    'participant-role': 'participantRole',
    'participant-leave': 'participantLeave',
    'participant-offline': 'participantOffline',
    'exercise-ready': 'exerciseReady',
    'task-create': 'taskCreate',
    'task-update': 'taskUpdate',
    'task-delete': 'taskDelete',
    'incident-log-update': 'incidentLogUpdate',
    'inject-fire': 'injectFire',
    phase: 'exercisePhase',
    'incident-log': 'incidentLog',
    'incident-log-delete': 'incidentLogDelete',
    hotwash: 'hotwash',
    signal: 'rtcSignal',
  },
  GET: {
    events: 'events',
    'recovery-check': 'recoveryCheck',
    clock: 'clock',
    metrics: 'metrics',
    logs: 'logs',
    storage: 'storage',
    files: 'files',
    file: 'readFile',
    terminal: 'terminal',
    exercise: 'exerciseState',
    aar: 'aar',
  },
  PUT: {
    file: 'writeFile',
  },
  DELETE: {
    delete: 'delete',
  },
};

export function matchSessionRoute(
  request: Request
): SessionRouteName | undefined {
  const url = new URL(request.url);
  const action = url.pathname.split('/').filter(Boolean).at(-1);
  if (!action) return undefined;

  const methodRoutes = routeTable[request.method];
  const matched = methodRoutes?.[action];
  if (matched) return matched;
  if (request.method === 'GET') return 'snapshot';
  return undefined;
}
