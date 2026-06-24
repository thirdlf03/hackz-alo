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
  const tokens = readTokensFromRequest(c);
  const hasWriteToken = await anyToken(tokens, (token) =>
    verifySessionWriteTokenValue(c.env, sessionId, token)
  );
  const hasReadToken =
    !hasWriteToken &&
    (await anyToken(tokens, (token) =>
      verifySessionReadTokenValue(c.env, sessionId, token)
    ));
  const decision = decideSessionReadPolicy({hasWriteToken, hasReadToken});
  if (decision.allowed) return undefined;
  return c.json(err('unauthorized', 'session read token required'), 401);
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

function readTokensFromRequest(c: WorkerContext) {
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
