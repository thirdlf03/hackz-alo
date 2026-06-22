import type {WorkerApp} from '../http/context.js';
import {err, ok} from '../http/response.js';

export function registerHealthRoutes(app: WorkerApp) {
  app.get('/api/health', (c) => c.json(ok({status: 'ok'})));

  app.get('/api/ready', async (c) => {
    try {
      await c.env.DB.prepare('select 1 as ok').first();
      await c.env.REPLAY_BUCKET.list({limit: 1});
      return c.json(
        ok({
          status: 'ready',
          d1: true,
          r2: true,
        })
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'not ready';
      return c.json(err('not_ready', message), 503);
    }
  });
}
