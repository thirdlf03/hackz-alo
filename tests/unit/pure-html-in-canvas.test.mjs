import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {supportsDrawElementImage, transformToCss, HTML_IN_CANVAS_TRIAL} =
  await tsImport('../../apps/web/src/pure/htmlInCanvas.ts', import.meta.url);

test('supportsDrawElementImage detects the experimental method', () => {
  assert.equal(supportsDrawElementImage({drawElementImage() {}}), true);
});

test('supportsDrawElementImage is false without the method', () => {
  assert.equal(supportsDrawElementImage({}), false);
  assert.equal(supportsDrawElementImage({drawElementImage: 42}), false);
  assert.equal(supportsDrawElementImage({drawElementImage: null}), false);
});

test('transformToCss stringifies a matrix-like value', () => {
  const matrix = {toString: () => 'matrix(1, 0, 0, 1, 10, 20)'};
  assert.equal(transformToCss(matrix), 'matrix(1, 0, 0, 1, 10, 20)');
});

test('transformToCss passes through a string', () => {
  assert.equal(transformToCss('translate(5px, 6px)'), 'translate(5px, 6px)');
});

test('transformToCss falls back to none for empty or missing values', () => {
  assert.equal(transformToCss(undefined), 'none');
  assert.equal(transformToCss(null), 'none');
  assert.equal(transformToCss(''), 'none');
  assert.equal(transformToCss({toString: () => ''}), 'none');
});

test('HTML_IN_CANVAS_TRIAL names the origin trial', () => {
  assert.equal(HTML_IN_CANVAS_TRIAL, 'HTMLInCanvas');
});
