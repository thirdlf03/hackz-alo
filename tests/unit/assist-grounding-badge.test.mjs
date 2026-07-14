import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {describeGroundingBadge} = await tsImport(
  '../../apps/web/src/pure/assistGroundingBadge.ts',
  import.meta.url
);

test('describeGroundingBadge maps ok to the agreement badge', () => {
  const badge = describeGroundingBadge({status: 'ok', nextStep: 'ss -ltnp'});
  assert.deepEqual(badge, {tone: 'ok', label: '✓ 画面の手順と一致'});
});

test('describeGroundingBadge maps repaired to a badge with the repaired detail line', () => {
  const badge = describeGroundingBadge({
    status: 'repaired',
    nextStep: 'ss -lt',
    repairedNextStep: 'ss -ltnp',
  });
  assert.deepEqual(badge, {
    tone: 'repaired',
    label: '修復済み',
    detail: '補完された手順: ss -ltnp',
  });
});

test('describeGroundingBadge maps repaired without a repairedNextStep to a badge with no detail', () => {
  const badge = describeGroundingBadge({
    status: 'repaired',
    nextStep: 'ss -lt',
  });
  assert.deepEqual(badge, {tone: 'repaired', label: '修復済み'});
});

test('describeGroundingBadge maps rejected to the warning badge', () => {
  const badge = describeGroundingBadge({
    status: 'rejected',
    nextStep: 'kubectl rollout restart deployment/api',
    reason: 'unverifiable command: kubectl rollout restart deployment/api',
  });
  assert.deepEqual(badge, {
    tone: 'rejected',
    label: '⚠ 画面内に確認できないコマンドが含まれています',
  });
});

test('describeGroundingBadge maps unverified to the caution badge', () => {
  const badge = describeGroundingBadge({
    status: 'unverified',
    nextStep: 'DBを再起動する',
    reason: 'no-grounded-command',
  });
  assert.deepEqual(badge, {
    tone: 'unverified',
    label: '⚠ 画面の手順からは確認できませんでした',
  });
});

test('describeGroundingBadge maps no_next_step to no badge', () => {
  const badge = describeGroundingBadge({status: 'no_next_step'});
  assert.equal(badge, undefined);
});
