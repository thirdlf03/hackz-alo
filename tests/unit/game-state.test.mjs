import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceGameState,
  createInitialGameState,
  decayWorldOverlays
} from "../../apps/web/src/game/state/gameState.ts";
import { createEmptyTerminalMirror } from "../../apps/web/src/game/terminal/mirror.ts";

test("red bull flying starts when the meter crosses the low threshold once", () => {
  const scenario = testScenario();
  let state = createInitialGameState(
    scenario,
    "sess_test",
    "repl_test",
    createEmptyTerminalMirror()
  );

  state = advanceGameState(state, 8 * 60 * 1000, scenario, 1, 8 * 60 * 1000);
  assert.equal(state.world.redBullFlyingMs, 0);
  assert.ok(state.world.redBullPercent > 65);

  state = advanceGameState(state, 9 * 60 * 1000, scenario, 1, 60 * 1000);
  assert.ok(state.world.redBullFlyingMs > 0);
  assert.ok(state.world.redBullPercent <= 65);

  state = decayWorldOverlays(state, 10_000);
  assert.equal(state.world.redBullFlyingMs, 0);
  assert.equal(state.world.redBullPercent, 42);

  state = advanceGameState(state, 10 * 60 * 1000, scenario, 1, 60 * 1000);
  assert.equal(state.world.redBullFlyingMs, 0);
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
