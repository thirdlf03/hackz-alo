import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {applySecurityHeaders, securityHeaderValues, withSecurityHeaders} =
  await tsImport(
    '../../apps/worker/src/http/securityHeaders.ts',
    import.meta.url
  );

test('applySecurityHeaders sets production security headers', () => {
  const headers = new Headers();
  applySecurityHeaders(headers);
  assert.equal(
    headers.get('Strict-Transport-Security'),
    securityHeaderValues.strictTransportSecurity
  );
  assert.equal(
    headers.get('X-Content-Type-Options'),
    securityHeaderValues.xContentTypeOptions
  );
  assert.equal(
    headers.get('Referrer-Policy'),
    securityHeaderValues.referrerPolicy
  );
  assert.equal(
    headers.get('Permissions-Policy'),
    securityHeaderValues.permissionsPolicy
  );
  assert.equal(headers.get('Content-Security-Policy'), null);
});

test('applySecurityHeaders adds CSP only when isHtml is true', () => {
  const headers = new Headers();
  applySecurityHeaders(headers, true);
  assert.equal(
    headers.get('Content-Security-Policy'),
    securityHeaderValues.contentSecurityPolicy
  );
});

test('withSecurityHeaders adds CSP to HTML responses and keeps other headers', () => {
  const source = new Response('<!doctype html><html></html>', {
    status: 200,
    headers: {'content-type': 'text/html; charset=utf-8'},
  });
  const secured = withSecurityHeaders(source);
  assert.equal(
    secured.headers.get('Content-Security-Policy'),
    securityHeaderValues.contentSecurityPolicy
  );
  assert.equal(
    secured.headers.get('X-Content-Type-Options'),
    securityHeaderValues.xContentTypeOptions
  );
});

test('withSecurityHeaders omits CSP for non-HTML responses', () => {
  const source = new Response('{"ok":true}', {
    status: 200,
    headers: {'content-type': 'application/json'},
  });
  const secured = withSecurityHeaders(source);
  assert.equal(secured.headers.get('Content-Security-Policy'), null);
  assert.equal(
    secured.headers.get('X-Content-Type-Options'),
    securityHeaderValues.xContentTypeOptions
  );
});

test('withSecurityHeaders passes through WebSocket upgrade responses', () => {
  const source = {
    status: 101,
    webSocket: {},
    headers: new Headers(),
  };
  const secured = withSecurityHeaders(source);
  assert.equal(secured, source);
});

test('withSecurityHeaders clones immutable DO response headers', () => {
  const source = new Response('{"ok":true}', {
    status: 200,
    headers: {'content-type': 'application/json'},
  });
  Object.freeze(source.headers);

  const secured = withSecurityHeaders(source);
  assert.equal(secured.status, 200);
  assert.equal(
    secured.headers.get('X-Content-Type-Options'),
    securityHeaderValues.xContentTypeOptions
  );
});
