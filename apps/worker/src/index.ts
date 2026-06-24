import {proxyToSandbox} from '@cloudflare/sandbox';
import {Hono} from 'hono';
import {SessionDurableObject} from './durable/SessionDurableObject.js';
import {perfMiddleware} from '@incident/observability/worker';
import {readRouteJsonObject} from './http/routeBody.js';
import {
  securityHeadersMiddleware,
  serveAssetWithSecurityHeaders,
} from './http/securityHeaders.js';
import {requestIdMiddleware} from './http/writeAuthMiddleware.js';
import {ok} from './http/response.js';
import {registerAdminRoutes} from './routes/adminRoutes.js';
import {registerHealthRoutes} from './routes/healthRoutes.js';
import {registerReplayRoutes} from './routes/replayRoutes.js';
import {registerScenarioRoutes} from './routes/scenarioRoutes.js';
import {registerSessionRoutes} from './routes/sessionRoutes.js';
import {sweepExpiredReplays} from './storage/replayPurge.js';
import {sweepStaleSessions} from './sessionSweep.js';
import type {Bindings} from './types.js';

export {SessionDurableObject};
export {Sandbox} from '@cloudflare/sandbox';

const app = new Hono<{Bindings: Bindings}>();
const DEV_TERMINAL_DEBUG_BODY_MAX_BYTES = 8 * 1024;

app.use('*', requestIdMiddleware());
app.use('*', perfMiddleware());
app.use('*', securityHeadersMiddleware());

app.post('/api/dev/terminal-debug', async (c) => {
  if (c.env.ENVIRONMENT === 'production') {
    return c.json(
      {ok: false, error: {code: 'not_found', message: 'not found'}},
      404
    );
  }
  const parsedBody = await readRouteJsonObject(
    c,
    DEV_TERMINAL_DEBUG_BODY_MAX_BYTES,
    {emptyValue: {}}
  );
  if (parsedBody instanceof Response) return parsedBody;
  const body = parsedBody as {
    event?: string;
    detail?: Record<string, unknown>;
    at?: number;
  };
  console.log(
    '[terminal-debug]',
    body.event ?? 'unknown',
    JSON.stringify(body.detail ?? {})
  );
  return c.json(ok({logged: true}));
});

registerHealthRoutes(app);
registerScenarioRoutes(app);
registerSessionRoutes(app);
registerReplayRoutes(app);
registerAdminRoutes(app);

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    const sandboxResponse = await proxyToSandbox(request, env);
    if (sandboxResponse) return sandboxResponse;
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith('/api/')) {
      return app.fetch(request, env, ctx);
    }
    return serveAssetWithSecurityHeaders(request, env.ASSETS);
  },
  scheduled(_event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(sweepStaleSessions(env));
    const now = new Date();
    if (
      now.getUTCDay() === 0 &&
      now.getUTCHours() === 3 &&
      now.getUTCMinutes() < 10
    ) {
      ctx.waitUntil(sweepExpiredReplays(env));
    }
  },
};
