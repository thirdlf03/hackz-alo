import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceGameState,
  createInitialGameState,
  visibleRunbooks
} from "../../apps/web/src/game/state/gameState.ts";
import { createEmptyTerminalMirror } from "../../apps/web/src/game/terminal/mirror.ts";

test("visibleRunbooks filters by availableAtMs and pulses on arrival", () => {
  const scenario = {
    ...testScenario(),
    runbooks: [
      { id: "early", title: "Early", body: "now" },
      { id: "late", title: "Late", body: "later", availableAtMs: 90_000 }
    ]
  };

  assert.equal(visibleRunbooks(scenario, 0).length, 1);
  assert.equal(visibleRunbooks(scenario, 90_000).length, 2);

  let state = createInitialGameState(scenario, "sess_test", "repl_test", createEmptyTerminalMirror());
  assert.equal(state.monitors.right.activeRunbook?.id, "early");
  assert.equal(state.notifications.pulseMs, 0);

  state = advanceGameState(state, 90_000, scenario, 1, 60_000);
  assert.equal(state.monitors.right.activeRunbook?.id, "early");
  assert.equal(state.notifications.pulseMs, 2400);
  assert.equal(visibleRunbooks(scenario, state.clock.elapsedMs).length, 2);
});

function testScenario() {
  return {
    id: "scenario_test",
    version: 1,
    title: "Test Scenario",
    difficulty: "beginner",
    timeLimitMinutes: 10,
    service: {
      name: "Test API",
      healthUrl: "http://localhost:8080/health"
    },
    briefing: [],
    startup: [],
    triggers: [],
    alerts: [],
    successConditions: [],
    runbooks: [],
    slackMessages: []
  };
}
