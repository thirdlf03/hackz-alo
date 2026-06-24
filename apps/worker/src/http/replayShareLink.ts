import type {WorkerContext} from './context.js';
import {logStructured} from './requestLog.js';
import {err, ok} from './response.js';
import {requireReplayWriteAccess} from './writeAuthMiddleware.js';
import {
  buildReplaySharePath,
  normalizeShareLinkTtlHours,
  replayVisibilityAfterShare,
  SHARE_LINK_SCOPE,
  shareLinkExpiresAt,
  ShareLinkTtlError,
} from '../pure/replayShareLink.js';
import {createWriteToken, hashWriteToken} from '../pure/writeAuth.js';
import {getReplay} from '../repositories/replayRepository.js';
import {
  insertReplayReadToken,
  updateReplayVisibility,
} from '../repositories/replayReadTokenRepository.js';

export async function issueReplayShareLink(
  c: WorkerContext,
  replayId: string,
  body: unknown
) {
  const denied = await requireReplayWriteAccess(c, replayId);
  if (denied) return denied;

  const replay = await getReplay(c.env, replayId);
  if (!replay) return c.json(err('not_found', 'replay not found'), 404);

  let ttlHours: number;
  try {
    ttlHours = normalizeShareLinkTtlHours(
      isRecord(body) ? body.ttlHours : undefined
    );
  } catch (error) {
    if (error instanceof ShareLinkTtlError) {
      return c.json(err('bad_request', error.message), 400);
    }
    throw error;
  }

  const readToken = createWriteToken();
  const tokenHash = await hashWriteToken(readToken);
  const createdAt = new Date().toISOString();
  const expiresAt = shareLinkExpiresAt(Date.now(), ttlHours);
  const tokenId = `rrt_${crypto.randomUUID().replaceAll('-', '')}`;
  await insertReplayReadToken(c.env, {
    id: tokenId,
    replayId: replay.id,
    tokenHash,
    scope: SHARE_LINK_SCOPE,
    expiresAt,
    createdAt,
  });

  const visibility = replayVisibilityAfterShare(replay.visibility);
  if (visibility !== replay.visibility) {
    await updateReplayVisibility(c.env, replay.id, visibility);
  }

  logStructured('replay_share_link_issued', {
    replayId: replay.id,
    scope: SHARE_LINK_SCOPE,
    expiresAt,
    visibility,
    ttlHours,
  });

  return c.json(
    ok({
      scope: SHARE_LINK_SCOPE,
      expiresAt,
      visibility,
      sharePath: buildReplaySharePath(replay.id, readToken),
      readToken,
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
