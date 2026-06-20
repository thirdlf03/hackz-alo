import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultRecordingMimeTypes,
  pickSupportedMimeType,
  recordingChunkMs,
  recordingMultipartPartSize
} from "../../packages/shared/src/recording.ts";

test("recording defaults keep chunk cadence and multipart part size separate", () => {
  assert.equal(recordingChunkMs, 5000);
  assert.equal(recordingMultipartPartSize, 8 * 1024 * 1024);
});

test("recording MIME selection prefers the first supported candidate", () => {
  const calls = [];
  const selected = pickSupportedMimeType((candidate) => {
    calls.push(candidate);
    return candidate === "video/webm";
  });

  assert.equal(selected, "video/webm");
  assert.deepEqual(calls, [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ]);
});

test("recording MIME selection falls back past unsupported and throwing candidates", () => {
  const selected = pickSupportedMimeType(
    (candidate) => {
      if (candidate.includes("vp9")) throw new Error("browser probe failed");
      return candidate === "video/webm";
    },
    ["video/webm;codecs=vp9,opus", "", "video/webm"]
  );

  assert.equal(selected, "video/webm");
});

test("recording MIME selection returns undefined when no candidate is supported", () => {
  assert.equal(pickSupportedMimeType(() => false, defaultRecordingMimeTypes), undefined);
});
