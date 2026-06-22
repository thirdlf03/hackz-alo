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
