import test from "node:test";
import assert from "node:assert/strict";

function replayId(id) {
  if (!/^[a-zA-Z0-9_-]{6,80}$/.test(id)) throw new Error("invalid replayId");
  return id;
}

function replayChunkKey(id, seq) {
  if (!Number.isInteger(seq) || seq < 0 || seq > 999999) throw new Error("invalid sequence number");
  return `replays/${replayId(id)}/chunks/${String(seq).padStart(6, "0")}.webm`;
}

function pickSupportedMimeType(isTypeSupported, candidates = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4"
]) {
  return candidates.find((candidate) => isTypeSupported(candidate));
}

test("R2 replay chunk keys are deterministic and scoped", () => {
  assert.equal(replayChunkKey("repl_abcdef", 7), "replays/repl_abcdef/chunks/000007.webm");
  assert.throws(() => replayChunkKey("../bad", 1), /invalid replayId/);
  assert.throws(() => replayChunkKey("repl_abcdef", -1), /invalid sequence/);
});

test("recording MIME fallback uses first supported candidate", () => {
  const picked = pickSupportedMimeType((mime) => mime === "video/webm");
  assert.equal(picked, "video/webm");
  assert.equal(pickSupportedMimeType(() => false), undefined);
});
