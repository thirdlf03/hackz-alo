import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {createInflightTtlCache} = await tsImport(
  '../../apps/worker/src/pure/inflightTtlCache.ts',
  import.meta.url
);

// This is the caching primitive SessionDurableObject.getRecoveryCheckResult
// wraps checkRecoveryAction (the sandbox-exec-driving evaluation) with —
// verified in isolation here since SessionDurableObject itself can't be
// imported under plain node:test (it transitively imports '@cloudflare/
// sandbox', which does a top-level `import ... from 'cloudflare:workers'`
// that only resolves inside the real Workers runtime).

test('concurrent calls merge into a single in-flight compute', async () => {
  let calls = 0;
  let resolveCompute;
  const cached = createInflightTtlCache(
    () =>
      new Promise((resolve) => {
        calls += 1;
        resolveCompute = resolve;
      }),
    5000
  );

  const first = cached('a');
  const second = cached('a');
  resolveCompute('result');
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(calls, 1, 'compute only invoked once for concurrent callers');
  assert.equal(firstResult, 'result');
  assert.equal(secondResult, 'result');
});

test('a call within the TTL after settling reuses the cached result', async () => {
  let calls = 0;
  let now = 1000;
  const cached = createInflightTtlCache(
    async () => {
      calls += 1;
      return `result-${calls}`;
    },
    5000,
    () => now
  );

  const first = await cached();
  now += 4999;
  const second = await cached();

  assert.equal(calls, 1);
  assert.equal(first, 'result-1');
  assert.equal(second, 'result-1');
});

test('a call after the TTL expires recomputes', async () => {
  let calls = 0;
  let now = 1000;
  const cached = createInflightTtlCache(
    async () => {
      calls += 1;
      return `result-${calls}`;
    },
    5000,
    () => now
  );

  const first = await cached();
  now += 5001;
  const second = await cached();

  assert.equal(calls, 2);
  assert.equal(first, 'result-1');
  assert.equal(second, 'result-2');
});

test('a rejected compute is not cached and is retried on the next call', async () => {
  let calls = 0;
  const cached = createInflightTtlCache(async () => {
    calls += 1;
    if (calls === 1) throw new Error('boom');
    return 'ok';
  }, 5000);

  await assert.rejects(cached(), /boom/);
  const second = await cached();

  assert.equal(calls, 2);
  assert.equal(second, 'ok');
});
