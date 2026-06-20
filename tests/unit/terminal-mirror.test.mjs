import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyTerminalMirror } from "../../apps/web/src/game/terminal/mirror.ts";

test("createEmptyTerminalMirror provides a connecting placeholder", () => {
  const mirror = createEmptyTerminalMirror(80, 24);
  assert.equal(mirror.cols, 80);
  assert.equal(mirror.rows, 24);
  assert.match(mirror.lines[0], /sandbox/i);
  assert.equal(mirror.commandHistory.length, 0);
});
