import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {runKodama} from '../../sandbox/bin/kodama.mjs';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const kodamaCli = path.join(rootDir, 'sandbox/bin/kodama.mjs');

test('kodama evaluates assignment, arithmetic, and return statements', () => {
  const result = runKodama(`
やまびこ帳 nightly sales math
よぶ base = 6
よぶ divisor = 2
よぶ total = base わる divisor たす こだま
かえす total
`);

  assert.equal(result, 4);
});

test('kodama evaluator keeps internal error code while exposing vague message', () => {
  assert.throws(
    () =>
      runKodama(`
よぶ x = 100
よぶ y = しずか
かえす x わる y
`),
    (error) => {
      assert.equal(error.message, 'こだまが返ってきません');
      assert.equal(error.code, 'DIVISION_BY_ZERO');
      assert.equal(error.line, 4);
      return true;
    }
  );
});

test('kodama CLI masks structured runtime errors from player-facing output', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'incident-kodama-'));
  const file = path.join(dir, 'sales.kdm');

  try {
    await writeFile(
      file,
      'よぶ x = 100\nよぶ y = しずか\nかえす x わる y\n',
      'utf8'
    );
    const result = spawnSync(process.execPath, [kodamaCli, 'run', file], {
      encoding: 'utf8',
    });

    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'こだまが返ってきません\n');
    assert.doesNotMatch(
      result.stderr,
      /DIVISION_BY_ZERO|line|column|100|わる/u
    );
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('kodama CLI check prints ok for valid source without the computed result', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'incident-kodama-'));
  const file = path.join(dir, 'sales.kdm');

  try {
    await writeFile(file, 'よぶ x = 3\nかえす x たす 2\n', 'utf8');
    const result = spawnSync(process.execPath, [kodamaCli, 'check', file], {
      encoding: 'utf8',
    });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'ok\n');
    assert.equal(result.stderr, '');
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});
