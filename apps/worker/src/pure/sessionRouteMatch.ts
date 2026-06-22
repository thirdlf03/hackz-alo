export type SessionRouteName =
  | 'bootstrap'
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
  | 'snapshot';

const routeTable: Record<string, Partial<Record<string, SessionRouteName>>> = {
  POST: {
    bootstrap: 'bootstrap',
    start: 'start',
    resolve: 'resolve',
    retire: 'retire',
    timeout: 'timeout',
    clock: 'updateClock',
    'terminal-resize': 'terminalResize',
    'terminal-interrupt': 'terminalInterrupt',
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
