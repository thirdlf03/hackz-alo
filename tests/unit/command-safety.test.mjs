import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';
import {classifyCommandSafety as classifyCommandSafetyMjs} from '../../scripts/lib/command-safety.mjs';

const {classifyCommandSafety: classifyCommandSafetyTs} = await tsImport(
  '../../apps/web/src/pure/commandSafety.ts',
  import.meta.url
);

const vectors = JSON.parse(
  readFileSync(
    new URL(
      '../../scripts/fixtures/command-safety-vectors.json',
      import.meta.url
    )
  )
).vectors;

test('command-safety-vectors.json has at least 60 vectors covering all three levels', () => {
  assert.ok(
    vectors.length >= 60,
    `expected >=60 vectors, got ${vectors.length}`
  );
  const levels = new Set(vectors.map((vector) => vector.expected));
  assert.deepEqual(levels, new Set(['blocked', 'confirm', 'ok']));
});

for (const vector of vectors) {
  test(`[TS] ${vector.expected}: ${vector.command}`, () => {
    const result = classifyCommandSafetyTs(vector.command);
    assert.equal(
      result.level,
      vector.expected,
      `${vector.note ?? ''} (got reason: ${result.reason ?? 'none'})`
    );
  });

  test(`[mjs] ${vector.expected}: ${vector.command}`, () => {
    const result = classifyCommandSafetyMjs(vector.command);
    assert.equal(
      result.level,
      vector.expected,
      `${vector.note ?? ''} (got reason: ${result.reason ?? 'none'})`
    );
  });

  test(`[drift] TS and mjs agree: ${vector.command}`, () => {
    const tsResult = classifyCommandSafetyTs(vector.command);
    const mjsResult = classifyCommandSafetyMjs(vector.command);
    assert.deepEqual(
      mjsResult,
      tsResult,
      'scripts/lib/command-safety.mjs drifted from apps/web/src/pure/commandSafety.ts'
    );
  });
}
