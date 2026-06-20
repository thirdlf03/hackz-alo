import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyTerminalMirror, terminalToMirrorState } from "../../apps/web/src/game/terminal/mirror.ts";

test("createEmptyTerminalMirror provides a connecting placeholder", () => {
  const mirror = createEmptyTerminalMirror(80, 24);
  assert.equal(mirror.cols, 80);
  assert.equal(mirror.rows, 24);
  assert.match(mirror.lines[0], /sandbox/i);
  assert.equal(mirror.commandHistory.length, 0);
});

test("terminalToMirrorState reads only the visible xterm page", () => {
  const requested = [];
  const terminal = {
    cols: 80,
    rows: 3,
    buffer: {
      active: {
        baseY: 100,
        cursorX: 4,
        cursorY: 1,
        length: 103,
        getLine(index) {
          requested.push(index);
          return { translateToString: () => `line-${index}` };
        }
      }
    }
  };

  const mirror = terminalToMirrorState(terminal);

  assert.deepEqual(requested, [100, 101, 102, 101]);
  assert.deepEqual(mirror.lines, ["line-100", "line-101", "line-102"]);
  assert.deepEqual(mirror.cursor, { x: 4, y: 1, visible: true });
  assert.equal(mirror.commandDraft, "line-101");
});
