import type {
  EditorPanelState,
  GameRenderState,
  MetricsSnapshot,
  ScenarioDefinition,
  TerminalMirrorState,
} from '@incident/shared';
import type {GameStateAction} from './gameStateActions.js';
import {computeNarrativeHour, visibleRunbooks} from './gameSelectors.js';
import {reduceGameState} from './gameStateReduce.js';
import {appendEdgeRttHistory} from '../../pure/sessionEdgeRtt.js';

export type {GameStateAction};
export {reduceGameState};

const METRICS_HISTORY_LIMIT = 30;

interface InitialGameStateOptions {
  sessionStatus?: GameRenderState['session']['status'];
  recordingStatus?: GameRenderState['recording']['status'];
  recordingSaveEnabled?: boolean;
  speed?: number;
}

const DEFAULT_EDITOR_FILES: EditorPanelState['files'] = [
  {path: '/workspace/services/batch/sales.un'},
  {path: '/workspace/run/deploy.json'},
  {path: '/workspace/run/hosts.override'},
  {path: '/workspace/run/job-queue.jsonl'},
];

function defaultEditor(): EditorPanelState {
  return {
    files: DEFAULT_EDITOR_FILES,
    currentPath: DEFAULT_EDITOR_FILES[0]?.path,
    content: '',
    savedContent: '',
    dirty: false,
    status: 'idle',
    error: undefined,
    cursor: {line: 1, column: 1},
  };
}

export {
  computeNarrativeHour,
  mergedSlackMessages,
  unreadAlertCount,
  unreadNotificationCount,
  visibleRunbooks,
} from './gameSelectors.js';

export function createInitialGameState(
  scenario: ScenarioDefinition,
  sessionId: string,
  replayId: string,
  terminal: TerminalMirrorState,
  options: InitialGameStateOptions = {}
): GameRenderState {
  const runbooks = visibleRunbooks(scenario, 0);
  const activeRunbook = runbooks[0];

  return {
    session: {
      sessionId,
      replayId,
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      difficulty: scenario.difficulty,
      status: options.sessionStatus ?? 'briefing',
    },
    clock: {
      elapsedMs: 0,
      timeLimitMs: scenario.timeLimitMinutes * 60 * 1000,
      speed: options.speed ?? 1,
    },
    monitors: {
      left: {
        metrics: emptyMetrics(),
        metricsHistory: [],
        metricsSource: 'loading',
        edgeRttMs: null,
        edgeRttHistory: [],
        alerts: [],
      },
      center: {
        activeTool: 'terminal',
        terminal,
        editor: defaultEditor(),
      },
      right: {
        activePanelTab: 'runbook',
        ...(activeRunbook
          ? {activeRunbook, activeRunbookIndex: 0}
          : {activeRunbookIndex: 0}),
        slackMessages: [],
      },
    },
    navigation: {dismissedStepIds: []},
    notifications: {panelOpen: false, readAlertIds: [], pulseMs: 0},
    seenSlackIds: [],
    playerSlackMessages: [],
    slackCompose: {active: false, draft: ''},
    openedRunbookIds: activeRunbook ? [activeRunbook.id] : [],
    alertFlashMs: 0,
    world: {narrativeHour: 0, expandedMonitor: null},
    commandInputFocused: false,
    cursor: {x: 960, y: 540, visible: true},
    room: {
      participants: [],
      tasks: [],
      incidentLog: [],
      injects: [],
    },
    clickEffects: [],
    recording: {
      status: options.recordingStatus ?? 'idle',
      chunkCount: 0,
      saveEnabled: options.recordingSaveEnabled ?? true,
    },
  };
}

export function advanceGameState(
  state: GameRenderState,
  elapsedMs: number,
  scenario?: ScenarioDefinition,
  speed = state.clock.speed,
  deltaMs = 0,
  serverAlerts?: GameRenderState['monitors']['left']['alerts'],
  serverSlack?: GameRenderState['monitors']['right']['slackMessages']
): GameRenderState {
  const alerts =
    serverAlerts ??
    (scenario
      ? scenario.alerts.filter((alert) => alert.atMs <= elapsedMs)
      : state.monitors.left.alerts);
  const slackMessages =
    serverSlack ??
    (scenario
      ? scenario.slackMessages.filter((message) => message.atMs <= elapsedMs)
      : state.monitors.right.slackMessages);

  const prevVisibleRunbooks = scenario
    ? visibleRunbooks(scenario, state.clock.elapsedMs)
    : [];
  const nextVisibleRunbooks = scenario
    ? visibleRunbooks(scenario, elapsedMs)
    : [];
  const newRunbookArrived =
    nextVisibleRunbooks.length > prevVisibleRunbooks.length;

  const activeStep = resolveNavigationStep(
    scenario,
    elapsedMs,
    state.navigation.dismissedStepIds
  );
  const newAlertArrived = alerts.length > state.monitors.left.alerts.length;
  const previousSlackIds = new Set([
    ...state.monitors.right.slackMessages.map((message) => message.id),
    ...state.playerSlackMessages.map((message) => message.id),
  ]);
  const newSlackArrived = slackMessages.some(
    (message) => !previousSlackIds.has(message.id)
  );
  const notificationPulseMs =
    newAlertArrived || newSlackArrived || newRunbookArrived
      ? 2400
      : Math.max(0, state.notifications.pulseMs - deltaMs);

  const activeRunbookStillVisible = state.monitors.right.activeRunbook
    ? nextVisibleRunbooks.some(
        (runbook) => runbook.id === state.monitors.right.activeRunbook?.id
      )
    : false;
  const nextActiveRunbook = activeRunbookStillVisible
    ? state.monitors.right.activeRunbook
    : nextVisibleRunbooks[0];
  const nextActiveRunbookIndex = nextActiveRunbook
    ? Math.max(
        0,
        nextVisibleRunbooks.findIndex(
          (runbook) => runbook.id === nextActiveRunbook.id
        )
      )
    : 0;

  const nextStatus =
    state.session.status === 'resolved' ||
    state.session.status === 'failed' ||
    state.session.status === 'retired'
      ? state.session.status
      : 'running';

  return {
    ...state,
    session: {...state.session, status: nextStatus},
    clock: {...state.clock, elapsedMs, speed},
    monitors: {
      ...state.monitors,
      left: {
        ...state.monitors.left,
        alerts,
      },
      right: {
        activePanelTab: state.monitors.right.activePanelTab,
        slackMessages,
        activeRunbookIndex: nextActiveRunbook ? nextActiveRunbookIndex : 0,
        ...(nextActiveRunbook ? {activeRunbook: nextActiveRunbook} : {}),
      },
    },
    navigation: {
      dismissedStepIds: state.navigation.dismissedStepIds,
      ...(activeStep ? {activeStepId: activeStep.id} : {}),
    },
    notifications: {
      ...state.notifications,
      pulseMs: notificationPulseMs,
    },
    alertFlashMs: 0,
    world: {
      narrativeHour: computeNarrativeHour(elapsedMs, state.clock.timeLimitMs),
      expandedMonitor: state.world.expandedMonitor,
    },
  };
}

function resolveNavigationStep(
  scenario: ScenarioDefinition | undefined,
  elapsedMs: number,
  dismissedStepIds: string[]
) {
  if (!scenario?.navigationSteps?.length) return undefined;
  const eligible = scenario.navigationSteps
    .filter(
      (step) => step.atMs <= elapsedMs && !dismissedStepIds.includes(step.id)
    )
    .toSorted((a, b) => b.atMs - a.atMs);
  return eligible[0];
}

export function decayWorldOverlays(
  state: GameRenderState,
  deltaMs: number
): GameRenderState {
  const warningFlashMs = state.warning
    ? Math.max(0, state.warning.flashMs - deltaMs)
    : 0;
  const warningUnchanged =
    warningFlashMs === (state.warning?.flashMs ?? 0) &&
    (warningFlashMs > 0 || !state.warning);
  if (warningUnchanged) return state;
  const next: GameRenderState = {...state};
  if (warningFlashMs > 0 && state.warning) {
    next.warning = {...state.warning, flashMs: warningFlashMs};
  } else {
    delete next.warning;
  }
  return next;
}

export function applyLiveMetrics(
  state: GameRenderState,
  metrics: MetricsSnapshot,
  edgeRttMs: number | null = null
): GameRenderState {
  const history = [...state.monitors.left.metricsHistory, metrics].slice(
    -METRICS_HISTORY_LIMIT
  );
  const edgeRttHistory =
    edgeRttMs === null
      ? state.monitors.left.edgeRttHistory
      : appendEdgeRttHistory(state.monitors.left.edgeRttHistory, edgeRttMs);
  return {
    ...state,
    monitors: {
      ...state.monitors,
      left: {
        ...state.monitors.left,
        metrics,
        metricsHistory: history,
        metricsSource: 'live',
        edgeRttMs: edgeRttMs ?? state.monitors.left.edgeRttMs,
        edgeRttHistory,
      },
    },
  };
}

export function dismissNavigationStep(
  state: GameRenderState,
  stepId: string
): GameRenderState {
  return reduceGameState(state, {type: 'dismiss_navigation_step', stepId});
}

export function setRightPanelTab(
  state: GameRenderState,
  tab: 'runbook' | 'slack'
): GameRenderState {
  return reduceGameState(state, {type: 'set_right_panel_tab', tab});
}

export function setActiveRunbook(
  state: GameRenderState,
  scenario: ScenarioDefinition,
  index: number
): GameRenderState {
  return reduceGameState(state, {
    type: 'set_active_runbook',
    scenario,
    index,
  });
}

export function setCenterTool(
  state: GameRenderState,
  activeTool: GameRenderState['monitors']['center']['activeTool']
): GameRenderState {
  return reduceGameState(state, {type: 'set_center_tool', activeTool});
}

export function updateEditorPanel(
  state: GameRenderState,
  updater: (editor: EditorPanelState) => EditorPanelState
): GameRenderState {
  return reduceGameState(state, {type: 'update_editor_panel', updater});
}

export function toggleNotificationPanel(
  state: GameRenderState
): GameRenderState {
  return reduceGameState(state, {type: 'toggle_notification_panel'});
}

export function activateSlackCompose(state: GameRenderState): GameRenderState {
  return reduceGameState(state, {type: 'activate_slack_compose'});
}

export function focusCommandInput(state: GameRenderState): GameRenderState {
  return reduceGameState(state, {type: 'focus_command_input'});
}

export function blurCommandInput(state: GameRenderState): GameRenderState {
  return reduceGameState(state, {type: 'blur_command_input'});
}

export function deactivateSlackCompose(
  state: GameRenderState
): GameRenderState {
  return reduceGameState(state, {type: 'deactivate_slack_compose'});
}

export function setSlackDraft(
  state: GameRenderState,
  draft: string
): GameRenderState {
  return reduceGameState(state, {type: 'set_slack_draft', draft});
}

export function submitPlayerSlackMessage(
  state: GameRenderState,
  body: string,
  atMs: number
): GameRenderState {
  return reduceGameState(state, {
    type: 'submit_player_slack_message',
    body,
    atMs,
  });
}

export function toggleExpandedMonitor(
  state: GameRenderState,
  monitor: 'metrics' | 'terminal' | 'runbook'
): GameRenderState {
  return reduceGameState(state, {
    type: 'toggle_expanded_monitor',
    monitor,
  });
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
    queueDepth: 0,
  };
}
