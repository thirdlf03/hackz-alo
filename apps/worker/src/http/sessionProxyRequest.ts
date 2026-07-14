import {traceHeaders} from '@incident/observability/worker';

// Internal-only marker consumed by SessionDurableObject.terminal() to
// grant sandbox operate access. Always stripped from the inbound client
// request in proxyTraceHeaders below before an authorized caller
// (sessionRoutes.ts) is allowed to (re)set it via extraHeaders, so a
// client can never inject this header itself.
export const INTERNAL_WRITE_ACCESS_HEADER = 'x-incident-write-access';

function proxyTraceHeaders(source: Headers, contentType?: string) {
  const headers = new Headers(source);
  for (const name of [
    'authorization',
    'cookie',
    'content-length',
    'content-type',
    'host',
    INTERNAL_WRITE_ACCESS_HEADER,
  ]) {
    headers.delete(name);
  }
  if (contentType) headers.set('content-type', contentType);
  return traceHeaders(headers);
}

export function createSessionProxyRequest(
  source: Request,
  target: URL,
  body?: unknown,
  extraHeaders?: Record<string, string>
) {
  if (body === undefined) {
    const headers = proxyTraceHeaders(source.headers);
    applyExtraHeaders(headers, extraHeaders);
    return new Request(target, {
      method: source.method,
      headers,
      signal: source.signal,
    });
  }
  const headers = proxyTraceHeaders(source.headers, 'application/json');
  applyExtraHeaders(headers, extraHeaders);
  return new Request(target, {
    // Internal mutation actions consistently use POST so their JSON bodies
    // survive proxies that discard DELETE request bodies.
    method:
      source.method === 'GET' || source.method === 'DELETE'
        ? 'POST'
        : source.method,
    headers,
    body: JSON.stringify(body),
    signal: source.signal,
  });
}

function applyExtraHeaders(
  headers: Headers,
  extraHeaders: Record<string, string> | undefined
) {
  if (!extraHeaders) return;
  for (const [name, value] of Object.entries(extraHeaders)) {
    headers.set(name, value);
  }
}
