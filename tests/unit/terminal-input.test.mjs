import test from "node:test";
import assert from "node:assert/strict";
import { keyboardEventToTerminalInput } from "../../apps/web/src/game/terminal/input.ts";

function keyboardEvent(overrides) {
  return {
    key: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...overrides
  };
}

test("keyboardEventToTerminalInput maps Ctrl+C and Ctrl+D", () => {
  assert.equal(keyboardEventToTerminalInput(keyboardEvent({ key: "c", ctrlKey: true })), "\u0003");
  assert.equal(keyboardEventToTerminalInput(keyboardEvent({ key: "D", ctrlKey: true })), "\u0004");
});

test("keyboardEventToTerminalInput ignores other modifier combinations", () => {
  assert.equal(keyboardEventToTerminalInput(keyboardEvent({ key: "c", metaKey: true })), null);
  assert.equal(keyboardEventToTerminalInput(keyboardEvent({ key: "c", ctrlKey: true, altKey: true })), null);
  assert.equal(keyboardEventToTerminalInput(keyboardEvent({ key: "v", ctrlKey: true })), null);
});

test("keyboardEventToTerminalInput maps navigation and printable keys", () => {
  assert.equal(keyboardEventToTerminalInput(keyboardEvent({ key: "Enter" })), "\r");
  assert.equal(keyboardEventToTerminalInput(keyboardEvent({ key: "ArrowUp" })), "\u001b[A");
  assert.equal(keyboardEventToTerminalInput(keyboardEvent({ key: "a" })), "a");
});
