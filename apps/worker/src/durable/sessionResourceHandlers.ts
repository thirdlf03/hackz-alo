import type {MetricsSnapshot} from '@incident/shared';
import {
  INCIDENT_ATTRS,
  INCIDENT_SPAN_NAMES,
  withWorkerSpan,
} from '@incident/observability/worker';
import type {Bindings} from '../types.js';
import {HttpError, jsonOk} from '../http/response.js';
import {
  fetchSessionLogs,
  fetchSessionMetrics,
  fetchSessionStorage,
  listSessionFiles,
  readSessionFile,
  writeSessionFile,
} from '../sandbox/runtime.js';
import type {StoredSession} from './sessionState.js';

export const SESSION_METRICS_TTL_MS = 3000;

export interface MetricsCache {
  value?: MetricsSnapshot | undefined;
  cachedAt: number;
}

export async function readSessionMetrics(
  env: Bindings,
  session: StoredSession,
  cache: MetricsCache
) {
  if (session.status !== 'running') {
    throw new HttpError(
      409,
      'invalid_state',
      'metrics are only available while the session is running'
    );
  }

  const now = Date.now();
  if (cache.value && now - cache.cachedAt < SESSION_METRICS_TTL_MS) {
    await withWorkerSpan(
      env,
      INCIDENT_SPAN_NAMES.doSnapshotPoll,
      {
        [INCIDENT_ATTRS.sessionId]: session.sessionId,
        [INCIDENT_ATTRS.cached]: true,
      },
      () => undefined
    );
    return jsonOk(cache.value);
  }

  const metrics = await withWorkerSpan(
    env,
    INCIDENT_SPAN_NAMES.doSnapshotPoll,
    {
      [INCIDENT_ATTRS.sessionId]: session.sessionId,
      [INCIDENT_ATTRS.cached]: false,
    },
    async () => await fetchSessionMetrics(env, session.sessionId)
  );
  if (!metrics) {
    throw new HttpError(
      502,
      'sandbox_unavailable',
      'failed to fetch sandbox metrics'
    );
  }
  cache.value = metrics;
  cache.cachedAt = now;
  return jsonOk(metrics);
}

export async function readSessionLogs(
  env: Bindings,
  session: StoredSession,
  request: Request
) {
  if (session.status !== 'running') {
    throw new HttpError(
      409,
      'invalid_state',
      'logs are only available while the session is running'
    );
  }
  const url = new URL(request.url);
  const file = url.searchParams.get('file') ?? 'access';
  const tail = Number(url.searchParams.get('tail') ?? '50');
  const lines = await fetchSessionLogs(env, session.sessionId, file, tail);
  return jsonOk({file, lines});
}

export async function readSessionStorage(
  env: Bindings,
  session: StoredSession
) {
  if (session.status !== 'running') {
    throw new HttpError(
      409,
      'invalid_state',
      'storage is only available while the session is running'
    );
  }
  const entries = await fetchSessionStorage(env, session.sessionId);
  return jsonOk({entries});
}

export async function readSessionFiles(env: Bindings, session: StoredSession) {
  const files = await listSessionFiles(env, session.sessionId);
  return jsonOk({files});
}

export async function readSessionFileContent(
  env: Bindings,
  session: StoredSession,
  request: Request
) {
  const path = new URL(request.url).searchParams.get('path') ?? '';
  if (!path) throw new HttpError(400, 'bad_request', 'path is required');
  const file = await readSessionFile(env, session.sessionId, path);
  return jsonOk(file);
}

export async function writeSessionFileContent(
  env: Bindings,
  session: StoredSession,
  body: {path?: unknown; content?: unknown}
) {
  if (typeof body.path !== 'string') {
    throw new HttpError(400, 'bad_request', 'path is required');
  }
  if (typeof body.content !== 'string') {
    throw new HttpError(400, 'bad_request', 'content is required');
  }
  const file = await writeSessionFile(
    env,
    session.sessionId,
    body.path,
    body.content
  );
  return jsonOk(file);
}
