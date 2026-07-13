import type {WorkerApp} from '../http/context.js';
import {readRouteJsonObject} from '../http/routeBody.js';
import {err, ok} from '../http/response.js';
import {constantTimeEqual} from '../pure/constantTimeEqual.js';

const ADMIN_REPLAY_UPDATE_BODY_MAX_BYTES = 1024;

export function registerAdminRoutes(app: WorkerApp) {
  app.post('/api/admin/replays/:replayId/featured', async (c) => {
    if (
      c.env.ENVIRONMENT === 'production' &&
      !c.req.header('cf-access-jwt-assertion')
    ) {
      const adminSecret = c.env.ADMIN_SECRET;
      const provided = c.req.header('x-admin-secret');
      if (
        !adminSecret ||
        !provided ||
        !constantTimeEqual(provided, adminSecret)
      ) {
        return c.json(err('unauthorized', 'admin access required'), 401);
      }
    }

    const replayId = c.req.param('replayId');
    const body = await readRouteJsonObject(
      c,
      ADMIN_REPLAY_UPDATE_BODY_MAX_BYTES,
      {emptyValue: {}}
    );
    if (body instanceof Response) return body;
    const featured = body.featured === false || body.featured === 0 ? 0 : 1;
    const replay = await c.env.DB.prepare('select id from replays where id = ?')
      .bind(replayId)
      .first<{id: string}>();
    if (!replay) return c.json(err('not_found', 'replay not found'), 404);

    await c.env.DB.prepare(
      'update replays set featured = ?, updated_at = ? where id = ?'
    )
      .bind(featured, new Date().toISOString(), replayId)
      .run();
    return c.json(ok({replayId, featured}));
  });
}
