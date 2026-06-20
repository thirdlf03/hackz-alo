import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildTimelineFromEvents,
  gameTimeToVideoSeekSeconds,
  inferRecordingStartedAtGameMs,
  isTimelineEventType
} from "../../apps/web/src/replay/replayMediaUtils.ts";

test("isTimelineEventType excludes noisy recording and duplicate command events", () => {
  assert.equal(isTimelineEventType("command_detected"), true);
  assert.equal(isTimelineEventType("session_start"), true);
  assert.equal(isTimelineEventType("terminal_input"), false);
  assert.equal(isTimelineEventType("ui_click"), false);
  assert.equal(isTimelineEventType("recording_chunk_created"), false);
});

test("buildTimelineFromEvents prefers API events and filters timeline types", () => {
  const timeline = buildTimelineFromEvents([
    { event_id: "e1", type: "session_start", at_ms: 0, summary: "session_start" },
    { event_id: "e2", type: "terminal_input", at_ms: 1000, summary: "command: ls" },
    { event_id: "e3", type: "command_detected", at_ms: 1000, summary: "command: ls" },
    { event_id: "e4", type: "ui_click", at_ms: 2000, summary: "ui_click" },
    { event_id: "e5", type: "recording_chunk_created", at_ms: 5000, summary: "recording_chunk_created" }
  ]);

  assert.deepEqual(
    timeline.map((entry) => entry.label),
    ["シナリオ開始", "command: ls"]
  );
});

test("gameTimeToVideoSeekSeconds scales game clock to video duration", () => {
  assert.equal(gameTimeToVideoSeekSeconds(21, 15, 21_000, 6_000), 15);
  assert.equal(gameTimeToVideoSeekSeconds(11, 15, 21_000, 6_000), 5);
  assert.equal(gameTimeToVideoSeekSeconds(6, 15, 21_000, 6_000), 0);
});

test("inferRecordingStartedAtGameMs estimates late recorder start", () => {
  assert.equal(inferRecordingStartedAtGameMs(21_000, 15), 6_000);
  assert.equal(inferRecordingStartedAtGameMs(15_000, 15), 0);
});
