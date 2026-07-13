import {traceHeaders} from '@incident/observability/worker';

function proxyTraceHeaders(source: Headers, contentType?: string) {
  const headers = new Headers(source);
  for (const name of [
    'authorization',
    'cookie',
    'content-length',
    'content-type',
    'host',
  ]) {
    headers.delete(name);
  }
  if (contentType) headers.set('content-type', contentType);
  return traceHeaders(headers);
}

export function createSessionProxyRequest(
  source: Request,
  target: URL,
  body?: unknown
) {
  if (body === undefined) {
    return new Request(target, {
      method: source.method,
      headers: proxyTraceHeaders(source.headers),
      signal: source.signal,
    });
  }
  return new Request(target, {
    method: source.method === 'GET' ? 'POST' : source.method,
    headers: proxyTraceHeaders(source.headers, 'application/json'),
    body: JSON.stringify(body),
    signal: source.signal,
  });
}
