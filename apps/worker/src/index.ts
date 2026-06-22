import {proxyToSandbox} from '@cloudflare/sandbox';
import {Hono} from 'hono';
import {SessionDurableObject} from './durable/SessionDurableObject.js';
import {ok} from './http/response.js';
import {registerReplayRoutes} from './routes/replayRoutes.js';
import {registerScenarioRoutes} from './routes/scenarioRoutes.js';
import {registerSessionRoutes} from './routes/sessionRoutes.js';
import {sweepStaleSessions} from './sessionSweep.js';
import type {Bindings} from './types.js';

export {SessionDurableObject};
export {Sandbox} from '@cloudflare/sandbox';

const app = new Hono<{Bindings: Bindings}>();

app.post('/api/dev/terminal-debug', async (c) => {
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

registerScenarioRoutes(app);
registerSessionRoutes(app);
registerReplayRoutes(app);

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    const sandboxResponse = await proxyToSandbox(request, env);
    if (sandboxResponse) return sandboxResponse;
    return app.fetch(request, env, ctx);
  },
  scheduled(_event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(sweepStaleSessions(env));
  },
};
