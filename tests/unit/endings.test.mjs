import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveEndingId } from "../../packages/shared/src/endings.ts";

test("resolveEndingId maps session results to stable ids", () => {
  assert.equal(resolveEndingId("resolved"), "clear-shift");
  assert.equal(resolveEndingId("failed"), "overtime");
  assert.equal(resolveEndingId("timeout"), "overtime");
  assert.equal(resolveEndingId("retired"), "early-exit");
  assert.equal(resolveEndingId("aborted"), "aborted");
  assert.equal(resolveEndingId("unknown"), "unknown");
});
