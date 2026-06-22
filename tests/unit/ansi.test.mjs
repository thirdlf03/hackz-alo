import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  parseAnsiLine,
  stripAnsi,
} from '../../apps/web/src/game/terminal/ansi.ts';

test('stripAnsi removes escape sequences', () => {
  assert.equal(stripAnsi('\u001b[31merror\u001b[0m'), 'error');
});

test('parseAnsiLine splits colored spans', () => {
  const spans = parseAnsiLine('\u001b[1m\u001b[31mfail\u001b[0m ok');
  assert.equal(spans.length, 2);
  assert.equal(spans[0]?.text, 'fail');
  assert.equal(spans[0]?.color, '#f87171');
  assert.equal(spans[0]?.bold, true);
  assert.equal(spans[1]?.text, ' ok');
});

test('parseAnsiLine returns plain text for non-ansi lines', () => {
  const spans = parseAnsiLine('plain');
  assert.deepEqual(spans, [{text: 'plain'}]);
});
