import type {WorkerContext} from './context.js';
import {err} from './response.js';
import {verifySessionWriteTokenValue} from './writeAuthMiddleware.js';
import {
  hashWriteToken,
  parseBearerToken,
  verifyWriteTokenHash,
} from '../pure/writeAuth.js';
import {decideSessionReadPolicy} from '../pure/sessionReadPolicy.js';
import type {Bindings} from '../types.js';

export async function requireSessionReadAccess(
  c: WorkerContext,
  sessionId: string
) {
  const hasWriteToken = await hasSessionWriteAccess(c, sessionId);
  const hasReadToken =
    !hasWriteToken &&
    (await anyToken(readTokensFromRequest(c), (token) =>
      verifySessionReadTokenValue(c.env, sessionId, token)
    ));
  const decision = decideSessionReadPolicy({hasWriteToken, hasReadToken});
  if (decision.allowed) return undefined;
  return c.json(err('unauthorized', 'session read token required'), 401);
}

/**
 * Whether the request carries a token (Authorization bearer or
 * accessToken/readToken query param — see readTokensFromRequest) that is
 * a *valid write token* for this session. Used by the ws/terminal route
 * to decide whether to grant sandbox operate access, in addition to the
 * canOperateSandbox role check (see SessionDurableObject.terminal()).
 */
export async function hasSessionWriteAccess(
  c: WorkerContext,
  sessionId: string
) {
  return anyToken(readTokensFromRequest(c), (token) =>
    verifySessionWriteTokenValue(c.env, sessionId, token)
  );
}

async function verifySessionReadTokenValue(
  env: Bindings,
  sessionId: string,
  token: string
) {
  const tokenHash = await hashWriteToken(token);
  const row = await env.DB.prepare(
    `select token_hash
     from session_read_tokens
     where session_id = ?
       and token_hash = ?
       and revoked_at is null
       and expires_at > ?`
  )
    .bind(sessionId, tokenHash, new Date().toISOString())
    .first<{token_hash: string}>();
  if (!row) return false;
  return verifyWriteTokenHash(row.token_hash, tokenHash);
}

export function readTokensFromRequest(c: WorkerContext) {
  return [
    parseBearerToken(c.req.header('authorization')),
    cleanToken(c.req.query('accessToken')),
    cleanToken(c.req.query('readToken')),
  ].filter((token): token is string => token !== undefined);
}

async function anyToken(
  tokens: string[],
  verify: (token: string) => Promise<boolean>
) {
  for (const token of tokens) {
    if (await verify(token)) return true;
  }
  return false;
}

function cleanToken(value: string | undefined) {
  const token = value?.trim();
  return token && token.length > 0 ? token : undefined;
}
