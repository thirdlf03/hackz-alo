import {proxyToSandbox} from '@cloudflare/sandbox';
import {Hono} from 'hono';
import {SessionDurableObject} from './durable/SessionDurableObject.js';
import {logStructured} from './http/requestLog.js';
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

app.use('*', requestIdMiddleware());

app.post('/api/dev/terminal-debug', async (c) => {
  if (c.env.ENVIRONMENT === 'production') {
    return c.json(
      {ok: false, error: {code: 'not_found', message: 'not found'}},
      404
    );
  }
  const body = (await c.req.json().catch(() => ({}))) as {
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
    return app.fetch(request, env, ctx);
  },
  scheduled(_event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(
      sweepStaleSessions(env).then((cleaned) => {
        if (cleaned > 0) {
          logStructured('session_sweep', {cleaned});
        }
      })
    );
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
