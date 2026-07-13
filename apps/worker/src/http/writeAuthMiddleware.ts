import type {WorkerContext} from './context.js';
import {err} from './response.js';
import {
  hashWriteToken,
  parseBearerToken,
  verifyWriteTokenHash,
} from '../pure/writeAuth.js';
import type {Bindings} from '../types.js';

const WRITE_TOKEN_CACHE_TTL_MS = 60_000;
const WRITE_TOKEN_CACHE_MAX_ENTRIES = 500;

// Module-level cache of successfully verified (sessionId, tokenHash) pairs,
// scoped to the current isolate. Avoids a D1 round-trip on every write
// request once a token has been verified once. Failures are never cached.
const writeTokenVerificationCache = new Map<string, number>();

function writeTokenCacheKey(sessionId: string, tokenHash: string) {
  return `${sessionId}:${tokenHash}`;
}

function isWriteTokenCached(sessionId: string, tokenHash: string) {
  const key = writeTokenCacheKey(sessionId, tokenHash);
  const expiresAt = writeTokenVerificationCache.get(key);
  if (expiresAt === undefined) return false;
  if (expiresAt <= Date.now()) {
    writeTokenVerificationCache.delete(key);
    return false;
  }
  return true;
}

function rememberVerifiedWriteToken(sessionId: string, tokenHash: string) {
  purgeWriteTokenCacheIfNeeded();
  const key = writeTokenCacheKey(sessionId, tokenHash);
  writeTokenVerificationCache.set(key, Date.now() + WRITE_TOKEN_CACHE_TTL_MS);
}

function purgeWriteTokenCacheIfNeeded() {
  if (writeTokenVerificationCache.size < WRITE_TOKEN_CACHE_MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, expiresAt] of writeTokenVerificationCache) {
    if (expiresAt <= now) writeTokenVerificationCache.delete(key);
  }
  while (writeTokenVerificationCache.size >= WRITE_TOKEN_CACHE_MAX_ENTRIES) {
    const oldestKey = writeTokenVerificationCache.keys().next().value;
    if (oldestKey === undefined) break;
    writeTokenVerificationCache.delete(oldestKey);
  }
}

export async function verifySessionWriteToken(
  env: Bindings,
  sessionId: string,
  authorization: string | undefined
) {
  const token = parseBearerToken(authorization);
  if (!token) return false;
  return verifySessionWriteTokenValue(env, sessionId, token);
}

export async function verifySessionWriteTokenValue(
  env: Bindings,
  sessionId: string,
  token: string
) {
  const tokenHash = await hashWriteToken(token);
  if (isWriteTokenCached(sessionId, tokenHash)) return true;
  const row = await env.DB.prepare(
    'select write_token_hash from play_sessions where id = ?'
  )
    .bind(sessionId)
    .first<{write_token_hash: string | null}>();
  if (!row?.write_token_hash) return false;
  const verified = verifyWriteTokenHash(row.write_token_hash, tokenHash);
  if (verified) rememberVerifiedWriteToken(sessionId, tokenHash);
  return verified;
}

export async function verifyReplayWriteToken(
  env: Bindings,
  replayId: string,
  authorization: string | undefined
) {
  const token = parseBearerToken(authorization);
  if (!token) return false;
  const row = await env.DB.prepare(
    'select write_token_hash from play_sessions where replay_id = ?'
  )
    .bind(replayId)
    .first<{write_token_hash: string | null}>();
  if (!row?.write_token_hash) return false;
  const tokenHash = await hashWriteToken(token);
  return verifyWriteTokenHash(row.write_token_hash, tokenHash);
}

export async function requireSessionWriteAccess(
  c: WorkerContext,
  sessionId: string
) {
  const authorized = await verifySessionWriteToken(
    envFrom(c),
    sessionId,
    c.req.header('authorization')
  );
  if (!authorized) {
    return c.json(err('unauthorized', 'write token required'), 401);
  }
  return undefined;
}

export async function requireReplayWriteAccess(
  c: WorkerContext,
  replayId: string
) {
  const authorized = await verifyReplayWriteToken(
    envFrom(c),
    replayId,
    c.req.header('authorization')
  );
  if (!authorized) {
    return c.json(err('unauthorized', 'write token required'), 401);
  }
  return undefined;
}

export function requestIdMiddleware() {
  return async (c: WorkerContext, next: () => Promise<void>) => {
    const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();
    c.header('x-request-id', requestId);
    await next();
  };
}

export function bodySizeLimit(maxBytes: number) {
  return async (c: WorkerContext, next: () => Promise<void>) => {
    const contentLength = c.req.header('content-length');
    if (contentLength) {
      const size = Number.parseInt(contentLength, 10);
      if (Number.isFinite(size) && size > maxBytes) {
        return c.json(err('payload_too_large', 'request body too large'), 413);
      }
    }
    await next();
  };
}

function envFrom(c: WorkerContext) {
  return c.env;
}
