import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {shouldBypassTurnstileForSmoke, verifyTurnstileToken} = await tsImport(
  '../../apps/worker/src/http/turnstile.ts',
  import.meta.url
);

test('shouldBypassTurnstileForSmoke allows the correct admin secret', () => {
  const allowed = shouldBypassTurnstileForSmoke(
    {ADMIN_SECRET: 'top-secret'},
    'top-secret'
  );
  assert.equal(allowed, true);
});

test('shouldBypassTurnstileForSmoke rejects a wrong secret', () => {
  const allowed = shouldBypassTurnstileForSmoke(
    {ADMIN_SECRET: 'top-secret'},
    'wrong-secret'
  );
  assert.equal(allowed, false);
});

test('shouldBypassTurnstileForSmoke rejects when ADMIN_SECRET is unset', () => {
  const allowed = shouldBypassTurnstileForSmoke({}, 'anything');
  assert.equal(allowed, false);
});

test('shouldBypassTurnstileForSmoke rejects when ADMIN_SECRET is empty', () => {
  const allowed = shouldBypassTurnstileForSmoke({ADMIN_SECRET: ''}, 'anything');
  assert.equal(allowed, false);
});

test('shouldBypassTurnstileForSmoke rejects a missing provided secret', () => {
  const allowed = shouldBypassTurnstileForSmoke(
    {ADMIN_SECRET: 'top-secret'},
    undefined
  );
  assert.equal(allowed, false);
});

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

test('verifyTurnstileToken omits remoteip from siteverify body', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({url, init});
    return new Response(JSON.stringify({success: true}), {status: 200});
  };
  try {
    await verifyTurnstileToken(
      {TURNSTILE_SECRET_KEY: 'secret'},
      'token-123',
      '203.0.113.10'
    );
    const body = new URLSearchParams(calls[0].init.body);
    assert.equal(body.get('remoteip'), null);
    assert.equal(body.get('response'), 'token-123');
    assert.match(body.get('idempotency_key') ?? '', /-/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('verifyTurnstileToken retries siteverify on internal-error', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls.push(1);
    if (calls.length === 1) {
      return new Response(
        JSON.stringify({
          success: false,
          'error-codes': ['internal-error'],
        }),
        {status: 200}
      );
    }
    return new Response(JSON.stringify({success: true}), {status: 200});
  };
  try {
    const accepted = await verifyTurnstileToken(
      {TURNSTILE_SECRET_KEY: 'secret'},
      'token-123',
      '203.0.113.10'
    );
    assert.equal(accepted, true);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('verifyTurnstileToken does not retry timeout-or-duplicate', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls.push(1);
    return new Response(
      JSON.stringify({
        success: false,
        'error-codes': ['timeout-or-duplicate'],
      }),
      {status: 200}
    );
  };
  try {
    const accepted = await verifyTurnstileToken(
      {TURNSTILE_SECRET_KEY: 'secret'},
      'token-123',
      '203.0.113.10'
    );
    assert.equal(accepted, false);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
