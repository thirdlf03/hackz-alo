import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  normalizeOptionalMs,
  parseOptionalNumber,
  parsePartNumber,
  parseSequence,
} = await tsImport('../../apps/worker/src/http/params.ts', import.meta.url);

test('parseSequence accepts bounded integer sequences and defaults missing values', () => {
  assert.equal(parseSequence(undefined), 0);
  assert.equal(parseSequence('0'), 0);
  assert.equal(parseSequence('999999'), 999999);
  assert.equal(parseSequence('-1'), undefined);
  assert.equal(parseSequence('1000000'), undefined);
  assert.equal(parseSequence('1.5'), undefined);
  assert.equal(parseSequence('abc'), undefined);
});

test('parsePartNumber accepts multipart upload part bounds', () => {
  assert.equal(parsePartNumber('1'), 1);
  assert.equal(parsePartNumber('10000'), 10000);
  assert.equal(parsePartNumber('0'), undefined);
  assert.equal(parsePartNumber('10001'), undefined);
  assert.equal(parsePartNumber('2.5'), undefined);
});

test('parseOptionalNumber distinguishes missing, valid, and invalid query values', () => {
  assert.equal(parseOptionalNumber(undefined), undefined);
  assert.equal(parseOptionalNumber('0'), 0);
  assert.equal(parseOptionalNumber('12.5'), 12.5);
  assert.equal(parseOptionalNumber('-1'), null);
  assert.equal(parseOptionalNumber('abc'), null);
});

test('normalizeOptionalMs rounds valid non-negative numbers and rejects invalid values', () => {
  assert.equal(normalizeOptionalMs(undefined), null);
  assert.equal(normalizeOptionalMs(null), null);
  assert.equal(normalizeOptionalMs(12.6), 13);
  assert.equal(normalizeOptionalMs(0), 0);
  assert.equal(normalizeOptionalMs(-1), null);
  assert.equal(normalizeOptionalMs('12'), null);
  assert.equal(normalizeOptionalMs(Number.POSITIVE_INFINITY), null);
});
