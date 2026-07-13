import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {shouldDiscardOfflineUploadFailure} = await tsImport(
  '../../apps/web/src/game/recording/offlineQueue.ts',
  import.meta.url
);
const {isMissingReplayVideoFinalizeFailure, shouldPollForReplayVideo} =
  await tsImport(
    '../../apps/web/src/game/recording/finalizationPolicy.ts',
    import.meta.url
  );
const {canMixRecordingAudio} = await tsImport(
  '../../apps/web/src/game/recording/audioMixer.ts',
  import.meta.url
);

test('offline upload queue discards permanent failures but retries transient ones', () => {
  for (const status of [401, 403, 404]) {
    assert.equal(shouldDiscardOfflineUploadFailure(status, 'not_found'), true);
  }
  assert.equal(shouldDiscardOfflineUploadFailure(409, 'conflict'), true);
  for (const status of [429, 500, 503]) {
    assert.equal(
      shouldDiscardOfflineUploadFailure(status, 'unavailable'),
      false
    );
  }
});

test('missing finalize result is terminal and terminal recording states skip polling', () => {
  assert.equal(isMissingReplayVideoFinalizeFailure(404, 'not_found'), true);
  assert.equal(isMissingReplayVideoFinalizeFailure(503, 'unavailable'), false);
  for (const status of [
    'idle',
    'recording_error',
    'upload_degraded',
    'finalization_failed',
    'unsupported_browser',
  ]) {
    assert.equal(shouldPollForReplayVideo(status), false);
  }
  for (const status of ['recording', 'finalizing', 'ready', undefined]) {
    assert.equal(shouldPollForReplayVideo(status), true);
  }
});

test('recording audio is only mixed when the shared AudioContext is running', () => {
  assert.equal(canMixRecordingAudio('running'), true);
  assert.equal(canMixRecordingAudio('suspended'), false);
  assert.equal(canMixRecordingAudio('closed'), false);
});
