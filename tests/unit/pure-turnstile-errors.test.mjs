import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {isTurnstileVerificationError, TURNSTILE_VERIFICATION_FAILED} =
  await tsImport('../../apps/web/src/pure/turnstileErrors.ts', import.meta.url);
const {turnstileClientRetryDelayMs} = await tsImport(
  '../../apps/web/src/pure/turnstileRetry.ts',
  import.meta.url
);

test('isTurnstileVerificationError matches server forbidden message', () => {
  assert.equal(
    isTurnstileVerificationError(TURNSTILE_VERIFICATION_FAILED),
    true
  );
  assert.equal(isTurnstileVerificationError('rate limited'), false);
});

test('turnstileClientRetryDelayMs scales with attempt number', () => {
  assert.equal(turnstileClientRetryDelayMs(1), 400);
  assert.equal(turnstileClientRetryDelayMs(2), 800);
});

test('shouldRetryCreateSessionAfterTurnstileFailure gates client retry', async () => {
  const {shouldRetryCreateSessionAfterTurnstileFailure} = await tsImport(
    '../../apps/web/src/pure/turnstileErrors.ts',
    import.meta.url
  );
  assert.equal(
    shouldRetryCreateSessionAfterTurnstileFailure(
      true,
      TURNSTILE_VERIFICATION_FAILED
    ),
    true
  );
  assert.equal(
    shouldRetryCreateSessionAfterTurnstileFailure(true, 'rate limited'),
    false
  );
  assert.equal(
    shouldRetryCreateSessionAfterTurnstileFailure(
      false,
      TURNSTILE_VERIFICATION_FAILED
    ),
    false
  );
});
