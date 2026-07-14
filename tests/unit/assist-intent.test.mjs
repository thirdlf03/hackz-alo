import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {detectAssistIntent} = await tsImport(
  '../../apps/web/src/pure/assistIntent.ts',
  import.meta.url
);

test('detectAssistIntent classifies completion questions', () => {
  assert.equal(detectAssistIntent('復旧した?'), 'completion');
  assert.equal(detectAssistIntent('終わった?'), 'completion');
  assert.equal(detectAssistIntent('完了していい?'), 'completion');
  assert.equal(detectAssistIntent('直った?'), 'completion');
  assert.equal(detectAssistIntent('解決した?'), 'completion');
  assert.equal(detectAssistIntent('もう大丈夫?'), 'completion');
});

test('detectAssistIntent classifies why questions', () => {
  assert.equal(detectAssistIntent('なぜこうなったの?'), 'why');
  assert.equal(detectAssistIntent('なんで落ちたの?'), 'why');
  assert.equal(detectAssistIntent('どうしてエラーが出るの?'), 'why');
  assert.equal(detectAssistIntent('原因は何ですか'), 'why');
  assert.equal(detectAssistIntent('この仕組みを教えて'), 'why');
});

test('detectAssistIntent classifies next-step questions', () => {
  assert.equal(detectAssistIntent('次は何をすればいい?'), 'next_step');
  assert.equal(detectAssistIntent('どうすればいいですか'), 'next_step');
  assert.equal(detectAssistIntent('何をすればいいですか'), 'next_step');
});

test('detectAssistIntent falls back to other', () => {
  assert.equal(detectAssistIntent('今どのサービスが怪しい?'), 'other');
  assert.equal(detectAssistIntent(''), 'other');
  assert.equal(detectAssistIntent('   '), 'other');
});

test('detectAssistIntent: why takes priority over completion when both match', () => {
  assert.equal(detectAssistIntent('なんで直ったの?'), 'why');
});

test('detectAssistIntent: completion matches even without a trailing question mark', () => {
  assert.equal(detectAssistIntent('完了していい?'), 'completion');
});
