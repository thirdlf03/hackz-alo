import type { GameRenderState, ScenarioDefinition, TerminalMirrorState } from "@incident/shared";

type InitialGameStateOptions = {
  sessionStatus?: GameRenderState["session"]["status"];
  recordingStatus?: GameRenderState["recording"]["status"];
  speed?: number;
};

export function createInitialGameState(
  scenario: ScenarioDefinition,
  sessionId: string,
  replayId: string,
  terminal: TerminalMirrorState,
  options: InitialGameStateOptions = {}
): GameRenderState {
  const activeRunbook = scenario.runbooks[0];

  return {
    session: {
      sessionId,
      replayId,
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      difficulty: scenario.difficulty,
      status: options.sessionStatus ?? "briefing"
    },
    clock: {
      elapsedMs: 0,
      timeLimitMs: scenario.timeLimitMinutes * 60 * 1000,
      speed: options.speed ?? 1
    },
    monitors: {
      left: {
        metrics: {
          at: 0,
          cpu: 0,
          memory: 0,
          disk: 0,
          http5xxRate: 0,
          latencyP95Ms: 0,
          rps: 0,
          dbConnections: 0,
          queueDepth: 0
        },
        metricsHistory: [],
        metricsSource: "loading",
        alerts: []
      },
      center: { terminal },
      right: {
        ...(activeRunbook ? { activeRunbook } : {}),
        slackMessages: []
      }
    },
    cursor: { x: 960, y: 540, visible: true },
    clickEffects: [],
    recording: {
      status: options.recordingStatus ?? "idle",
      chunkCount: 0
    }
  };
}

export function advanceGameState(
  state: GameRenderState,
  elapsedMs: number,
  scenario?: ScenarioDefinition,
  speed = state.clock.speed
): GameRenderState {
  const alerts = scenario
    ? scenario.alerts.filter((alert) => alert.atMs <= elapsedMs)
    : state.monitors.left.alerts;
  const slackMessages = scenario
    ? scenario.slackMessages.filter((message) => message.atMs <= elapsedMs)
    : state.monitors.right.slackMessages;
  const nextStatus =
    state.session.status === "resolved" || state.session.status === "failed" ? state.session.status : "running";

  return {
    ...state,
    session: { ...state.session, status: nextStatus },
    clock: { ...state.clock, elapsedMs, speed },
    monitors: {
      ...state.monitors,
      left: {
        ...state.monitors.left,
        alerts
      },
      right: {
        ...state.monitors.right,
        slackMessages
      }
    }
  };
}
