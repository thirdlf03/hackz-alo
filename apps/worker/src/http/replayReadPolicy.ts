import type {WorkerContext} from './context.js';
import {err} from './response.js';
import {verifyReplayWriteToken} from './writeAuthMiddleware.js';
import {
  hashWriteToken,
  parseBearerToken,
  verifyWriteTokenHash,
} from '../pure/writeAuth.js';
import {decideReplayReadPolicy} from '../pure/replayReadPolicy.js';
import {getReplay, type ReplayRow} from '../repositories/replayRepository.js';
import type {Bindings} from '../types.js';

export interface ReplayReadAccess {
  replay: ReplayRow;
  includePrivateEvents: boolean;
  authorizedBy: 'public' | 'write_token' | 'read_token';
}

export async function requireReplayReadAccess(
  c: WorkerContext,
  replayId: string
): Promise<ReplayReadAccess | Response> {
  const replay = await getReplay(c.env, replayId);
  if (!replay) return c.json(err('not_found', 'replay not found'), 404);

  const authorization = c.req.header('authorization');
  const hasWriteToken = await verifyReplayWriteToken(
    c.env,
    replayId,
    authorization
  );
  const hasReadToken =
    !hasWriteToken &&
    (await verifyReplayReadToken(c.env, replayId, {
      authorization,
      readToken: c.req.query('readToken'),
    }));
  const decision = decideReplayReadPolicy(replay.visibility, {
    hasWriteToken,
    hasReadToken,
  });

  if (!decision.allowed) {
    return c.json(err('unauthorized', 'replay read token required'), 401);
  }

  return {
    replay,
    includePrivateEvents: decision.includePrivateEvents,
    authorizedBy: hasWriteToken
      ? 'write_token'
      : hasReadToken
        ? 'read_token'
        : 'public',
  };
}

export async function verifyReplayReadToken(
  env: Bindings,
  replayId: string,
  input: {authorization?: string | undefined; readToken?: string | undefined}
) {
  const tokens = [
    parseBearerToken(input.authorization),
    cleanToken(input.readToken),
  ].filter((token): token is string => token !== undefined);
  if (tokens.length === 0) return false;

  for (const token of tokens) {
    const tokenHash = await hashWriteToken(token);
    const row = await env.DB.prepare(
      `select token_hash
       from replay_read_tokens
       where replay_id = ?
         and token_hash = ?
         and revoked_at is null
         and expires_at > ?`
    )
      .bind(replayId, tokenHash, new Date().toISOString())
      .first<{token_hash: string}>();
    if (row && verifyWriteTokenHash(row.token_hash, tokenHash)) return true;
  }
  return false;
}

function cleanToken(value: string | undefined) {
  const token = value?.trim();
  return token && token.length > 0 ? token : undefined;
}
