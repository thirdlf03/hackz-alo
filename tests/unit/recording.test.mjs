import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultRecordingMimeTypes,
  pickSupportedMimeType,
  recordingChunkMs,
  recordingMultipartPartSize,
  splitBufferIntoParts
} from "../../packages/shared/src/recording.ts";
import { replayEventSummary, createReplayEvent } from "../../packages/shared/src/events.ts";

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

test("splitBufferIntoParts creates fixed-size parts with a smaller tail", () => {
  const buffer = new Uint8Array(8 * 1024 * 1024 + 123);
  const parts = splitBufferIntoParts(buffer, 8 * 1024 * 1024);
  assert.equal(parts.length, 2);
  assert.equal(parts[0]?.length, 8 * 1024 * 1024);
  assert.equal(parts[1]?.length, 123);
});

test("replayEventSummary formats player slack reports", () => {
  const summary = replayEventSummary(
    createReplayEvent({
      replayId: "repl_test",
      type: "player_note",
      at: 1000,
      actor: "player",
      payload: { body: "API が落ちています", channel: "slack" }
    })
  );
  assert.equal(summary, "Slack報告: API が落ちています");
});

test("replayEventSummary formats session lifecycle labels", () => {
  assert.equal(
    replayEventSummary(
      createReplayEvent({
        replayId: "repl_test",
        type: "session_start",
        at: 0,
        actor: "system",
        payload: { scenarioId: "process-stop-001" }
      })
    ),
    "シナリオ開始"
  );
  assert.equal(
    replayEventSummary(
      createReplayEvent({
        replayId: "repl_test",
        type: "session_end",
        at: 1000,
        actor: "player",
        payload: { result: "retired" }
      })
    ),
    "解雇！"
  );
});
