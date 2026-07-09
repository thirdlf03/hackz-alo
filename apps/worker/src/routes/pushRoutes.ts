import type {WorkerApp} from '../http/context.js';
import {ok} from '../http/response.js';

export function registerPushRoutes(app: WorkerApp) {
  app.get('/api/push/public-key', (c) => {
    const publicKey = c.env.VAPID_PUBLIC_KEY;
    if (!publicKey) return c.json(ok({publicKey: null}));
    return c.json(ok({publicKey}));
  });
}
