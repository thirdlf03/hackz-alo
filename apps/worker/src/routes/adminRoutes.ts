import type {WorkerApp} from '../http/context.js';
import {err, ok} from '../http/response.js';

export function registerAdminRoutes(app: WorkerApp) {
  app.post('/api/admin/replays/:replayId/featured', async (c) => {
    if (
      c.env.ENVIRONMENT === 'production' &&
      !c.req.header('cf-access-jwt-assertion')
    ) {
      const adminSecret = c.env.ADMIN_SECRET;
      const provided = c.req.header('x-admin-secret');
      if (!adminSecret || provided !== adminSecret) {
        return c.json(err('unauthorized', 'admin access required'), 401);
      }
    }

    const replayId = c.req.param('replayId');
    const body = (await c.req.json().catch(() => ({}))) as {featured?: unknown};
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
