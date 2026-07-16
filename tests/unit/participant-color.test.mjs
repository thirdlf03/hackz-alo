import assert from 'node:assert/strict';
import {test} from 'node:test';
import {participantColorIndex} from '../../apps/web/src/pure/participantColor.ts';

test('participantColorIndex is stable for the same participantId', () => {
  const first = participantColorIndex('part_abc123', 5);
  const second = participantColorIndex('part_abc123', 5);
  assert.equal(first, second);
});

test('participantColorIndex stays within the palette bounds', () => {
  for (const id of ['a', 'part_1', 'part_2', 'a-very-long-participant-id']) {
    const index = participantColorIndex(id, 5);
    assert.ok(index >= 0 && index < 5, `index ${index} out of bounds for ${id}`);
  }
});

test('participantColorIndex is independent of position/order (unlike index % length)', () => {
  // Regression guard: two different ids should not need to depend on their
  // position in a list to get a color — the function only takes the id.
  const a = participantColorIndex('part_host', 5);
  const b = participantColorIndex('part_guest', 5);
  // Calling again in a different "order" (simulating the guest joining
  // before the host in a re-render) must not change either result.
  const bAgain = participantColorIndex('part_guest', 5);
  const aAgain = participantColorIndex('part_host', 5);
  assert.equal(a, aAgain);
  assert.equal(b, bAgain);
});

test('participantColorIndex handles a non-positive palette size', () => {
  assert.equal(participantColorIndex('part_abc', 0), 0);
});
