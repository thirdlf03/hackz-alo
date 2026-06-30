export type SessionRouteName =
  | 'bootstrap'
  | 'prepare'
  | 'start'
  | 'resolve'
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
  | 'exerciseState'
  | 'exerciseReady'
  | 'taskCreate'
  | 'taskUpdate'
  | 'injectFire'
  | 'incidentLog'
  | 'hotwash'
  | 'aar'
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
    'exercise-ready': 'exerciseReady',
    'task-create': 'taskCreate',
    'task-update': 'taskUpdate',
    'inject-fire': 'injectFire',
    'incident-log': 'incidentLog',
    hotwash: 'hotwash',
  },
  GET: {
    events: 'events',
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
