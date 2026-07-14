import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {describeSuccessCondition} = await tsImport(
  '../../apps/web/src/pure/successConditionLabels.ts',
  import.meta.url
);

test('describeSuccessCondition labels http_status with the trailing path segment', () => {
  assert.equal(
    describeSuccessCondition({
      type: 'http_status',
      url: 'http://localhost:8080/health',
      status: 200,
    }),
    'health が 200'
  );
});

test('describeSuccessCondition falls back to the raw url when it fails to parse', () => {
  assert.equal(
    describeSuccessCondition({
      type: 'http_status',
      url: 'not a url /health',
      status: 200,
    }),
    'health が 200'
  );
});

test('describeSuccessCondition labels disk_usage_below', () => {
  assert.equal(
    describeSuccessCondition({
      type: 'disk_usage_below',
      path: '/workspace',
      valuePercent: 80,
    }),
    '/workspace のディスク使用率 80% 未満'
  );
});

test('describeSuccessCondition labels process_running', () => {
  assert.equal(
    describeSuccessCondition({type: 'process_running', processId: 'api'}),
    'api プロセス稼働'
  );
});

test('describeSuccessCondition labels process_absent', () => {
  assert.equal(
    describeSuccessCondition({type: 'process_absent', processId: 'zombie'}),
    'zombie プロセス停止済み'
  );
});

test('describeSuccessCondition labels log_absent', () => {
  assert.equal(
    describeSuccessCondition({
      type: 'log_absent',
      path: '/workspace/logs/batch.log',
      pattern: 'こだまが返ってきません',
    }),
    '/workspace/logs/batch.log に「こだまが返ってきません」が含まれない'
  );
});

test('describeSuccessCondition labels kodama_batch_ok', () => {
  assert.equal(
    describeSuccessCondition({type: 'kodama_batch_ok', jobId: 'sales-nightly'}),
    'sales-nightly バッチが正常終了'
  );
});
