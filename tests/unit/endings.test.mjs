import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeReplayResult, resolveEndingId } from "../../packages/shared/src/endings.ts";

test("resolveEndingId maps session results to stable ids", () => {
  assert.equal(resolveEndingId("resolved"), "clear-shift");
  assert.equal(resolveEndingId("false_resolve"), "false-resolve");
  assert.equal(resolveEndingId("failed"), "overtime");
  assert.equal(resolveEndingId("timeout"), "overtime");
  assert.equal(resolveEndingId("retired"), "early-exit");
  assert.equal(resolveEndingId("aborted"), "aborted");
  assert.equal(resolveEndingId("unknown"), "unknown");
});

test("normalizeReplayResult stores timeout and false resolve as failed", () => {
  assert.equal(normalizeReplayResult("timeout"), "failed");
  assert.equal(normalizeReplayResult("false_resolve"), "failed");
  assert.equal(normalizeReplayResult("resolved"), "resolved");
});
