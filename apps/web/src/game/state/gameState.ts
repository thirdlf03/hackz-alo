import type { AlertDefinition, GameRenderState, MetricsSnapshot, ScenarioDefinition, TerminalMirrorState } from "@incident/shared";

const METRICS_HISTORY_LIMIT = 30;
const RED_BULL_FLYING_MS = 2800;
const RED_BULL_FLYING_THRESHOLD = 65;

type InitialGameStateOptions = {
  sessionStatus?: GameRenderState["session"]["status"];
  recordingStatus?: GameRenderState["recording"]["status"];
  recordingSaveEnabled?: boolean;
  speed?: number;
};

function defaultDevtools(): NonNullable<GameRenderState["monitors"]["center"]["devtools"]> {
  return {
    visible: false,
    tab: "network",
    networkLines: [],
    consoleLines: [],
    storageEntries: []
  };
}

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
        metrics: emptyMetrics(),
        metricsHistory: [],
        metricsSource: "loading",
        alerts: []
      },
      center: {
        terminal,
        devtools: defaultDevtools()
      },
      right: {
        activePanelTab: "runbook",
        ...(activeRunbook ? { activeRunbook } : {}),
        activeRunbookIndex: 0,
        slackMessages: []
      }
    },
    navigation: { dismissedStepIds: [] },
    notifications: { panelOpen: false, readAlertIds: [], pulseMs: 0 },
    seenSlackIds: [],
    playerSlackMessages: [],
    slackCompose: { active: false, draft: "" },
    openedRunbookIds: activeRunbook ? [activeRunbook.id] : [],
    alertFlashMs: 0,
    world: defaultWorld(),
    cursor: { x: 960, y: 540, visible: true },
    clickEffects: [],
    recording: {
      status: options.recordingStatus ?? "idle",
      chunkCount: 0,
      saveEnabled: options.recordingSaveEnabled ?? true
    }
  };
}

export function advanceGameState(
  state: GameRenderState,
  elapsedMs: number,
  scenario?: ScenarioDefinition,
  speed = state.clock.speed,
  deltaMs = 0,
  serverAlerts?: GameRenderState["monitors"]["left"]["alerts"],
  serverSlack?: GameRenderState["monitors"]["right"]["slackMessages"]
): GameRenderState {
  const alerts = serverAlerts ?? (scenario
    ? scenario.alerts.filter((alert) => alert.atMs <= elapsedMs)
    : state.monitors.left.alerts);
  const slackMessages = serverSlack ?? (scenario
    ? scenario.slackMessages.filter((message) => message.atMs <= elapsedMs)
    : state.monitors.right.slackMessages);

  const activeStep = resolveNavigationStep(scenario, elapsedMs, state.navigation.dismissedStepIds);
  const newAlertArrived = alerts.length > state.monitors.left.alerts.length;
  const previousSlackIds = new Set([
    ...state.monitors.right.slackMessages.map((message) => message.id),
    ...state.playerSlackMessages.map((message) => message.id)
  ]);
  const newSlackArrived = slackMessages.some((message) => !previousSlackIds.has(message.id));
  const notificationPulseMs =
    newAlertArrived || newSlackArrived ? 2400 : Math.max(0, state.notifications.pulseMs - deltaMs);

  const world = computeWorld(state, elapsedMs);

  const nextStatus =
    state.session.status === "resolved" ||
    state.session.status === "failed" ||
    state.session.status === "retired"
      ? state.session.status
      : "running";

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
    },
    navigation: {
      dismissedStepIds: state.navigation.dismissedStepIds,
      ...(activeStep ? { activeStepId: activeStep.id } : {})
    },
    notifications: {
      ...state.notifications,
      pulseMs: notificationPulseMs
    },
    alertFlashMs: 0,
    world
  };
}

export function decayWorldOverlays(state: GameRenderState, deltaMs: number): GameRenderState {
  const flyingMs = Math.max(0, state.world.redBullFlyingMs - deltaMs);
  const flashMs = Math.max(0, state.world.powerOutageFlashMs - deltaMs);
  const warningFlashMs = state.warning ? Math.max(0, state.warning.flashMs - deltaMs) : 0;
  const flyingJustEnded = state.world.redBullFlyingMs > 0 && flyingMs === 0;
  const worldUnchanged = flyingMs === state.world.redBullFlyingMs && flashMs === state.world.powerOutageFlashMs;
  const warningUnchanged =
    warningFlashMs === (state.warning?.flashMs ?? 0) && (warningFlashMs > 0 || !state.warning);
  if (worldUnchanged && warningUnchanged) return state;
  const next: GameRenderState = {
    ...state,
    world: {
      ...state.world,
      powerOutageFlashMs: flashMs,
      redBullFlyingMs: flyingMs,
      ...(flyingJustEnded ? { redBullPercent: 42 } : {})
    }
  };
  if (warningFlashMs > 0 && state.warning) {
    next.warning = { ...state.warning, flashMs: warningFlashMs };
  } else {
    delete next.warning;
  }
  return next;
}

export function applyLiveMetrics(state: GameRenderState, metrics: MetricsSnapshot): GameRenderState {
  const history = [...state.monitors.left.metricsHistory, metrics].slice(-METRICS_HISTORY_LIMIT);
  return {
    ...state,
    monitors: {
      ...state.monitors,
      left: {
        ...state.monitors.left,
        metrics,
        metricsHistory: history,
        metricsSource: "live"
      }
    }
  };
}

export function dismissNavigationStep(state: GameRenderState, stepId: string): GameRenderState {
  if (state.navigation.dismissedStepIds.includes(stepId)) return state;
  return {
    ...state,
    navigation: {
      dismissedStepIds: [...state.navigation.dismissedStepIds, stepId]
    }
  };
}

export function setRightPanelTab(state: GameRenderState, tab: "runbook" | "slack"): GameRenderState {
  if (state.monitors.right.activePanelTab === tab) return state;
  const seenSlackIds =
    tab === "slack"
      ? [...new Set([...state.seenSlackIds, ...mergedSlackMessages(state).map((message) => message.id)])]
      : state.seenSlackIds;
  return {
    ...state,
    monitors: {
      ...state.monitors,
      right: {
        ...state.monitors.right,
        activePanelTab: tab
      }
    },
    seenSlackIds,
    slackCompose: tab === "slack" ? state.slackCompose : { ...state.slackCompose, active: false }
  };
}

export function setActiveRunbook(state: GameRenderState, scenario: ScenarioDefinition, index: number): GameRenderState {
  const runbook = scenario.runbooks[index];
  if (!runbook) return state;
  const openedRunbookIds = state.openedRunbookIds.includes(runbook.id)
    ? state.openedRunbookIds
    : [...state.openedRunbookIds, runbook.id];
  return {
    ...state,
    monitors: {
      ...state.monitors,
      right: {
        ...state.monitors.right,
        activePanelTab: "runbook",
        activeRunbook: runbook,
        activeRunbookIndex: index
      }
    },
    openedRunbookIds
  };
}

export function toggleDevtools(state: GameRenderState, visible?: boolean): GameRenderState {
  const devtools = state.monitors.center.devtools ?? defaultDevtools();
  return {
    ...state,
    monitors: {
      ...state.monitors,
      center: {
        ...state.monitors.center,
        devtools: { ...devtools, visible: visible ?? !devtools.visible }
      }
    }
  };
}

export function setDevtoolsTab(state: GameRenderState, tab: NonNullable<GameRenderState["monitors"]["center"]["devtools"]>["tab"]): GameRenderState {
  const devtools = state.monitors.center.devtools ?? defaultDevtools();
  return {
    ...state,
    monitors: {
      ...state.monitors,
      center: {
        ...state.monitors.center,
        devtools: { ...devtools, visible: true, tab }
      }
    }
  };
}

export function toggleNotificationPanel(state: GameRenderState): GameRenderState {
  const panelOpen = !state.notifications.panelOpen;
  const readAlertIds = panelOpen
    ? [...new Set([...state.notifications.readAlertIds, ...state.monitors.left.alerts.map((alert) => alert.id)])]
    : state.notifications.readAlertIds;
  const seenSlackIds = panelOpen
    ? [...new Set([...state.seenSlackIds, ...mergedSlackMessages(state).map((message) => message.id)])]
    : state.seenSlackIds;
  return {
    ...state,
    notifications: { ...state.notifications, panelOpen, readAlertIds, pulseMs: panelOpen ? 0 : state.notifications.pulseMs },
    seenSlackIds,
    slackCompose: panelOpen ? state.slackCompose : { ...state.slackCompose, active: false }
  };
}

export function activateSlackCompose(state: GameRenderState): GameRenderState {
  return {
    ...state,
    slackCompose: { ...state.slackCompose, active: true }
  };
}

export function deactivateSlackCompose(state: GameRenderState): GameRenderState {
  if (!state.slackCompose.active && state.slackCompose.draft === "") return state;
  return {
    ...state,
    slackCompose: { active: false, draft: "" }
  };
}

export function setSlackDraft(state: GameRenderState, draft: string): GameRenderState {
  return {
    ...state,
    slackCompose: { ...state.slackCompose, draft }
  };
}

export function submitPlayerSlackMessage(state: GameRenderState, body: string, atMs: number): GameRenderState {
  const trimmed = body.trim();
  if (!trimmed) return state;
  const message = {
    id: `player-${crypto.randomUUID()}`,
    atMs,
    from: "あなた",
    body: trimmed
  };
  return {
    ...state,
    playerSlackMessages: [...state.playerSlackMessages, message],
    slackCompose: { active: false, draft: "" }
  };
}

export function mergedSlackMessages(state: GameRenderState) {
  return [...state.monitors.right.slackMessages, ...state.playerSlackMessages].sort((a, b) => a.atMs - b.atMs);
}

export function unreadNotificationCount(state: GameRenderState) {
  const unreadAlerts = state.monitors.left.alerts.filter(
    (alert) => !state.notifications.readAlertIds.includes(alert.id)
  ).length;
  const unreadSlack = mergedSlackMessages(state).filter(
    (message) => !state.seenSlackIds.includes(message.id)
  ).length;
  return unreadAlerts + unreadSlack;
}

export function unreadAlertCount(state: GameRenderState) {
  return state.monitors.left.alerts.filter((alert) => !state.notifications.readAlertIds.includes(alert.id)).length;
}

function resolveNavigationStep(
  scenario: ScenarioDefinition | undefined,
  elapsedMs: number,
  dismissedStepIds: string[]
) {
  if (!scenario?.navigationSteps?.length) return undefined;
  const eligible = scenario.navigationSteps
    .filter((step) => step.atMs <= elapsedMs && !dismissedStepIds.includes(step.id))
    .sort((a, b) => b.atMs - a.atMs);
  return eligible[0];
}

function defaultWorld(): GameRenderState["world"] {
  return {
    narrativeHour: 0,
    janitorCameraActive: false,
    fridgeCameraActive: true,
    expandedMonitor: null,
    redBullPercent: 100,
    powerOutageFlashMs: 0,
    redBullFlyingMs: 0
  };
}

function computeWorld(
  state: GameRenderState,
  elapsedMs: number
): GameRenderState["world"] {
  const timeLimitMs = Math.max(state.clock.timeLimitMs, 1);
  const narrativeHour = Math.min(6, (elapsedMs / timeLimitMs) * 6);
  const janitorCameraActive = narrativeHour >= 2 && narrativeHour < 5;
  const fridgeCameraActive = true;

  let redBullPercent = Math.max(0, 100 - (elapsedMs / timeLimitMs) * 40);
  if (state.world.redBullFlyingMs > 0) redBullPercent = 0;

  let redBullFlyingMs = state.world.redBullFlyingMs;
  if (
    redBullPercent <= RED_BULL_FLYING_THRESHOLD &&
    redBullFlyingMs <= 0 &&
    state.world.redBullPercent > RED_BULL_FLYING_THRESHOLD
  ) {
    redBullFlyingMs = RED_BULL_FLYING_MS;
  }

  return {
    narrativeHour,
    janitorCameraActive,
    fridgeCameraActive,
    expandedMonitor: state.world.expandedMonitor,
    redBullPercent,
    powerOutageFlashMs: state.world.powerOutageFlashMs,
    redBullFlyingMs
  };
}

export function toggleExpandedMonitor(
  state: GameRenderState,
  monitor: "metrics" | "terminal" | "runbook"
): GameRenderState {
  const expandedMonitor = state.world.expandedMonitor === monitor ? null : monitor;
  return {
    ...state,
    world: { ...state.world, expandedMonitor }
  };
}

function emptyMetrics(): MetricsSnapshot {
  return {
    at: 0,
    cpu: 0,
    memory: 0,
    disk: 0,
    http5xxRate: 0,
    latencyP95Ms: 0,
    rps: 0,
    dbConnections: 0,
    queueDepth: 0
  };
}
