import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {verifyTurnstileToken} = await tsImport(
  '../../apps/worker/src/http/turnstile.ts',
  import.meta.url
);

test('verifyTurnstileToken skips when secret is unset', async () => {
  const accepted = await verifyTurnstileToken({}, undefined, '1.2.3.4');
  assert.equal(accepted, true);
});

test('verifyTurnstileToken rejects missing token when secret is set', async () => {
  const accepted = await verifyTurnstileToken(
    {TURNSTILE_SECRET_KEY: 'secret'},
    undefined,
    '1.2.3.4'
  );
  assert.equal(accepted, false);
});

test('verifyTurnstileToken posts token and remoteip to siteverify', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({url, init});
    return new Response(JSON.stringify({success: true}), {status: 200});
  };
  try {
    const accepted = await verifyTurnstileToken(
      {TURNSTILE_SECRET_KEY: 'secret'},
      'token-123',
      '203.0.113.10'
    );
    assert.equal(accepted, true);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      'https://challenges.cloudflare.com/turnstile/v0/siteverify'
    );
    const body = new URLSearchParams(calls[0].init.body);
    assert.equal(body.get('secret'), 'secret');
    assert.equal(body.get('response'), 'token-123');
    assert.equal(body.get('remoteip'), '203.0.113.10');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
