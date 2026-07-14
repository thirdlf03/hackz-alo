import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {splitAnswerForMasking} = await tsImport(
  '../../apps/web/src/pure/assistAnswerMask.ts',
  import.meta.url
);

test('splitAnswerForMasking shows everything before the "次の一手" marker appears', () => {
  const partial = 'ログを確認したところディスク使用率が高くなっています。';
  const result = splitAnswerForMasking(partial);
  assert.deepEqual(result, {visible: partial, maskedPending: false});
});

test('splitAnswerForMasking masks the command right after the marker streams in', () => {
  const partial =
    'ディスク使用率が高くなっています。\n次の一手: sudo rm -rf /workspace';
  const result = splitAnswerForMasking(partial);
  assert.equal(result.visible, 'ディスク使用率が高くなっています。\n');
  assert.equal(result.maskedPending, true);
});

test('splitAnswerForMasking reveals prose once the "根拠" section starts, but keeps masking the command', () => {
  const partial =
    'ディスク使用率が高くなっています。\n次の一手: sudo rm -rf /workspace\n根拠: 画面にsudo rm -rf /workspaceの記載があります。';
  const result = splitAnswerForMasking(partial);
  assert.equal(
    result.visible,
    'ディスク使用率が高くなっています。\n' +
      '根拠: 画面にsudo rm -rf /workspaceの記載があります。'
  );
  assert.equal(result.maskedPending, true);
});

test('splitAnswerForMasking detects the marker case/width-insensitively', () => {
  const partial = '次の一手: ss -ltnp';
  const result = splitAnswerForMasking(partial);
  assert.equal(result.visible, '');
  assert.equal(result.maskedPending, true);
});
