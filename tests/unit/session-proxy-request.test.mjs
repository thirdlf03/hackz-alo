import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {createSessionProxyRequest, INTERNAL_WRITE_ACCESS_HEADER} =
  await tsImport(
    '../../apps/worker/src/http/sessionProxyRequest.ts',
    import.meta.url
  );

test('bodyless session proxy request does not clone or consume source body', async () => {
  const controller = new AbortController();
  const source = new Request('https://worker/api/sessions/s1/retire', {
    method: 'POST',
    headers: {
      authorization: 'Bearer secret',
      'content-type': 'application/json',
      traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
      'x-request-id': 'request-1',
      upgrade: 'websocket',
      connection: 'Upgrade',
      'sec-websocket-protocol': 'terminal',
      'last-event-id': 'event-42',
    },
    body: '{}',
    signal: controller.signal,
  });

  const proxied = createSessionProxyRequest(
    source,
    new URL('https://session.internal/internal/sessions/s1/retire')
  );

  assert.equal(source.bodyUsed, false);
  assert.equal(proxied.method, 'POST');
  assert.equal(proxied.body, null);
  assert.equal(proxied.headers.get('authorization'), null);
  assert.equal(proxied.headers.get('content-type'), null);
  assert.equal(proxied.headers.get('x-request-id'), 'request-1');
  assert.equal(proxied.headers.get('upgrade'), 'websocket');
  assert.equal(proxied.headers.get('connection'), 'Upgrade');
  assert.equal(proxied.headers.get('sec-websocket-protocol'), 'terminal');
  assert.equal(proxied.headers.get('last-event-id'), 'event-42');
  assert.equal(
    proxied.headers.get('traceparent'),
    '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01'
  );
  assert.equal(await source.text(), '{}');
  assert.equal(proxied.signal.aborted, false);
  controller.abort();
  assert.equal(proxied.signal.aborted, true);
});

test('session proxy request serializes an explicit body', async () => {
  const source = new Request('https://worker/api/sessions/s1/clock', {
    method: 'GET',
  });
  const proxied = createSessionProxyRequest(
    source,
    new URL('https://session.internal/internal/sessions/s1/clock'),
    {speed: 2}
  );
  assert.equal(proxied.method, 'POST');
  assert.equal(proxied.headers.get('content-type'), 'application/json');
  assert.deepEqual(JSON.parse(await proxied.text()), {speed: 2});
});

test('session proxy request strips a client-supplied write-access header', async () => {
  const source = new Request('https://worker/api/sessions/s1/ws/terminal', {
    headers: {[INTERNAL_WRITE_ACCESS_HEADER]: '1'},
  });
  const proxied = createSessionProxyRequest(
    source,
    new URL('https://session.internal/internal/sessions/s1/terminal')
  );
  assert.equal(proxied.headers.get(INTERNAL_WRITE_ACCESS_HEADER), null);
});

test('session proxy request applies extraHeaders after stripping the client-supplied one', async () => {
  const source = new Request('https://worker/api/sessions/s1/ws/terminal', {
    headers: {[INTERNAL_WRITE_ACCESS_HEADER]: 'spoofed'},
  });
  const proxied = createSessionProxyRequest(
    source,
    new URL('https://session.internal/internal/sessions/s1/terminal'),
    undefined,
    {[INTERNAL_WRITE_ACCESS_HEADER]: '1'}
  );
  assert.equal(proxied.headers.get(INTERNAL_WRITE_ACCESS_HEADER), '1');
});
