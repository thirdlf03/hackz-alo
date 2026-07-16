import assert from 'node:assert/strict';
import {test} from 'node:test';
import {screenForExercisePhase} from '../../apps/web/src/pure/exercisePhaseScreen.ts';

test('screenForExercisePhase maps each exercise phase to its resume screen', () => {
  assert.equal(screenForExercisePhase('lobby'), 'lobby');
  assert.equal(screenForExercisePhase('briefing'), 'briefing');
  assert.equal(screenForExercisePhase('running'), 'play');
  assert.equal(screenForExercisePhase('resolved'), 'result');
  assert.equal(screenForExercisePhase('hotwash'), 'hotwash');
  assert.equal(screenForExercisePhase('aar'), 'hotwash');
});
