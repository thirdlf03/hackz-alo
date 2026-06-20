import type { GameRenderState, ScenarioDefinition, TerminalMirrorState } from "@incident/shared";

type InitialGameStateOptions = {
  sessionStatus?: GameRenderState["session"]["status"];
  recordingStatus?: GameRenderState["recording"]["status"];
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
      timeLimitMs: scenario.timeLimitMinutes * 60 * 1000
    },
    monitors: {
      left: {
        metrics: {
          at: 0,
          cpu: 24,
          memory: 42,
          disk: scenario.id === "disk-full-001" ? 70 : 38,
          http5xxRate: 0,
          latencyP95Ms: 120,
          rps: 44,
          dbConnections: 6,
          queueDepth: 2
        },
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

export function advanceGameState(state: GameRenderState, elapsedMs: number, scenario?: ScenarioDefinition): GameRenderState {
  const progress = Math.min(1, elapsedMs / state.clock.timeLimitMs);
  const firstTriggerAt = scenario?.triggers.reduce<number | undefined>((earliest, trigger) => {
    if (earliest === undefined) return trigger.atMs;
    return Math.min(earliest, trigger.atMs);
  }, undefined);
  const activeTrigger = scenario?.triggers.find((trigger) => elapsedMs >= trigger.atMs);
  const failureProgress =
    activeTrigger || firstTriggerAt !== undefined
      ? Math.min(1, Math.max(0, (elapsedMs - (firstTriggerAt ?? elapsedMs)) / Math.max(1, state.clock.timeLimitMs - (firstTriggerAt ?? 0))))
      : 0;
  const failing = Boolean(activeTrigger) || elapsedMs >= 90000;
  const disk =
    activeTrigger?.type === "disk_full" || state.session.scenarioId === "disk-full-001"
      ? Math.max(state.monitors.left.metrics.disk, 70 + failureProgress * 30)
      : state.monitors.left.metrics.disk;
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
    clock: { ...state.clock, elapsedMs },
    monitors: {
      ...state.monitors,
      left: {
        ...state.monitors.left,
        metrics: {
          ...state.monitors.left.metrics,
          at: elapsedMs,
          cpu: failing ? 84 : 24 + Math.round(progress * 10),
          memory: failing ? 71 : 42,
          disk: Math.round(disk),
          http5xxRate: failing ? 0.25 : 0,
          latencyP95Ms: failing ? 1400 : 120,
          rps: failing ? 8 : 44
        },
        alerts
      },
      right: {
        ...state.monitors.right,
        slackMessages
      }
    }
  };
}
