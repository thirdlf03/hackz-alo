import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {shouldShowEditorOverlay} = await tsImport(
  '../../apps/web/src/pure/editorOverlayVisibility.ts',
  import.meta.url
);

test('shows the editor overlay when the editor tool is active and no confirm modal is open', () => {
  assert.equal(shouldShowEditorOverlay('editor', false), true);
  assert.equal(shouldShowEditorOverlay('editor', undefined), true);
});

test('hides the editor overlay while the retire-confirm modal is open', () => {
  // Regression: the editor overlay is a real, higher-stacked DOM <textarea>
  // (z-index: 20) placed over the same screen region as the retire-confirm
  // modal's buttons (drawRetireConfirmOverlay). Leaving it mounted while
  // retireConfirming is true intercepts clicks meant for the modal's
  // confirm/cancel buttons, so retiring with the editor panel open silently
  // never fires the /retire request. See tests/e2e/editor.spec.ts.
  assert.equal(shouldShowEditorOverlay('editor', true), false);
});

test('never shows the editor overlay when the terminal tool is active', () => {
  assert.equal(shouldShowEditorOverlay('terminal', false), false);
  assert.equal(shouldShowEditorOverlay('terminal', true), false);
});
