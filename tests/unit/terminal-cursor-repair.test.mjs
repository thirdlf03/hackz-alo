import test from "node:test";
import assert from "node:assert/strict";
import { tabCompletionCursorColumn } from "../../apps/web/src/game/terminal/cursorRepair.ts";

const prompt = "root@135f9fa46121:/workspace# ";

test("tabCompletionCursorColumn repairs cursor stuck at prompt start after completion", () => {
  const line = `${prompt}cat /workspace/`;
  assert.equal(tabCompletionCursorColumn(0, line), line.trimEnd().length);
});

test("tabCompletionCursorColumn leaves a correctly placed cursor alone", () => {
  const line = `${prompt}cat /workspace/`;
  assert.equal(tabCompletionCursorColumn(line.trimEnd().length, line), null);
});

test("tabCompletionCursorColumn ignores prompt-only lines", () => {
  assert.equal(tabCompletionCursorColumn(0, prompt), null);
});

test("tabCompletionCursorColumn ignores cursors already inside typed input", () => {
  const line = `${prompt}cat /workspace/`;
  assert.equal(tabCompletionCursorColumn(prompt.length + 4, line), null);
});
