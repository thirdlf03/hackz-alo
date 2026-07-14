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

test('multi-stage rm: the most severe level wins regardless of which rm appears first', () => {
  const confirmThenBlocked =
    'rm -rf /workspace/logs/batch.log を削除してから rm -rf / でクリーンアップする';
  const blockedThenConfirm =
    'rm -rf / でクリーンアップしてから rm -rf /workspace/logs/batch.log も削除する';

  for (const classify of [classifyCommandSafetyTs, classifyCommandSafetyMjs]) {
    assert.equal(
      classify(confirmThenBlocked).level,
      'blocked',
      'a later blocked-level rm must not be shadowed by an earlier confirm-level rm'
    );
    assert.equal(
      classify(blockedThenConfirm).level,
      'blocked',
      'an earlier blocked-level rm must not be downgraded by a later confirm-level rm'
    );
  }
});
