import type {
  EditorPanelState,
  GameRenderState,
  MetricsSnapshot,
  RunbookDefinition,
  ScenarioDefinition,
  TerminalMirrorState,
} from '@incident/shared';
import type {GameStateAction} from './gameStateActions.js';
import {computeNarrativeHour, visibleRunbooks} from './gameSelectors.js';
import {reduceGameState} from './gameStateReduce.js';
import {appendEdgeRttHistory} from '../../pure/sessionEdgeRtt.js';
import {
  deriveStepEvidence,
  hashRunbookBody,
  parseRunbookSteps,
} from '../../pure/runbookSteps.js';

export type {GameStateAction};
export {reduceGameState};

const METRICS_HISTORY_LIMIT = 30;

interface InitialGameStateOptions {
  sessionStatus?: GameRenderState['session']['status'];
  recordingStatus?: GameRenderState['recording']['status'];
  recordingSaveEnabled?: boolean;
  speed?: number;
  localParticipantId?: string;
}

const DEFAULT_EDITOR_FILES: EditorPanelState['files'] = [
  {path: '/workspace/services/batch/sales.kdm'},
  {path: '/workspace/etc/yamabiko-api.json'},
  {path: '/workspace/releases/yamabiko-api.previous.json'},
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
  mergedChatMessages,
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
        chatMessages: [],
      },
    },
    navigation: {dismissedStepIds: []},
    notifications: {panelOpen: false, readAlertIds: [], pulseMs: 0},
    seenChatIds: [],
    playerChatMessages: [],
    chatCompose: {active: false, draft: ''},
    openedRunbookIds: activeRunbook ? [activeRunbook.id] : [],
    alertFlashMs: 0,
    world: {narrativeHour: 0, expandedMonitor: null},
    commandInputFocused: false,
    cursor: {x: 960, y: 540, visible: true},
    ...(options.localParticipantId
      ? {localParticipantId: options.localParticipantId}
      : {}),
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
  serverChat?: GameRenderState['monitors']['right']['chatMessages'],
  serverServiceHealth?: GameRenderState['monitors']['left']['serviceHealth']
): GameRenderState {
  const alerts =
    serverAlerts ??
    (scenario
      ? scenario.alerts.filter((alert) => alert.atMs <= elapsedMs)
      : state.monitors.left.alerts);
  const chatMessages =
    serverChat ??
    (scenario
      ? scenario.chatMessages.filter((message) => message.atMs <= elapsedMs)
      : state.monitors.right.chatMessages);

  const runbookFileContents = state.monitors.right.runbookFileContents;
  const prevVisibleRunbooks = scenario
    ? visibleRunbooks(scenario, state.clock.elapsedMs, runbookFileContents)
    : [];
  const nextVisibleRunbooks = scenario
    ? visibleRunbooks(scenario, elapsedMs, runbookFileContents)
    : [];
  const newRunbookArrived =
    nextVisibleRunbooks.length > prevVisibleRunbooks.length;

  const activeStep = resolveNavigationStep(
    scenario,
    elapsedMs,
    state.navigation.dismissedStepIds
  );
  const newAlertArrived = alerts.length > state.monitors.left.alerts.length;
  const previousChatIds = new Set([
    ...state.monitors.right.chatMessages.map((message) => message.id),
    ...state.playerChatMessages.map((message) => message.id),
  ]);
  const newChatArrived = chatMessages.some(
    (message) => !previousChatIds.has(message.id)
  );
  const notificationPulseMs =
    newAlertArrived || newChatArrived || newRunbookArrived
      ? 2400
      : Math.max(0, state.notifications.pulseMs - deltaMs);

  const activeRunbookId = state.monitors.right.activeRunbook?.id;
  const matchedActiveRunbook = activeRunbookId
    ? nextVisibleRunbooks.find((runbook) => runbook.id === activeRunbookId)
    : undefined;
  const nextActiveRunbook = matchedActiveRunbook ?? nextVisibleRunbooks[0];
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

  const runbookProgress = deriveRunbookProgress(state, nextActiveRunbook);

  return {
    ...state,
    session: {...state.session, status: nextStatus},
    clock: {...state.clock, elapsedMs, speed},
    monitors: {
      ...state.monitors,
      left: {
        ...state.monitors.left,
        alerts,
        ...((serverServiceHealth ?? state.monitors.left.serviceHealth)
          ? {
              serviceHealth:
                serverServiceHealth ?? state.monitors.left.serviceHealth,
            }
          : {}),
      },
      right: {
        activePanelTab: state.monitors.right.activePanelTab,
        chatMessages,
        activeRunbookIndex: nextActiveRunbook ? nextActiveRunbookIndex : 0,
        ...(nextActiveRunbook ? {activeRunbook: nextActiveRunbook} : {}),
      },
    },
    ...(runbookProgress ? {runbookProgress} : {}),
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

/**
 * アクティブ Runbook の実効 body から手順を導出し、evidence を再計算する。
 * body(bodyHash)が変わった場合は runbookProgress を丸ごとリセットする
 * (gaslight による書き換えで自然に手順・進捗が縮退する)。
 * commandHistory・bodyHash が実際に変化していなければ既存の参照をそのまま
 * 返し、rAF ループではなくこの 500ms tick でのみ再計算が走るようにする。
 */
function deriveRunbookProgress(
  state: GameRenderState,
  activeRunbook: RunbookDefinition | undefined
): GameRenderState['runbookProgress'] {
  if (!activeRunbook) return state.runbookProgress;

  const bodyHash = hashRunbookBody(activeRunbook.body);
  const priorMatches =
    state.runbookProgress?.runbookId === activeRunbook.id &&
    state.runbookProgress.bodyHash === bodyHash;
  const priorSteps =
    state.runbookProgress && priorMatches ? state.runbookProgress.steps : [];
  const priorById = new Map(priorSteps.map((entry) => [entry.stepId, entry]));

  const steps = parseRunbookSteps(activeRunbook.body, activeRunbook.steps);
  const evidenceByStepId = deriveStepEvidence(
    steps,
    state.monitors.center.terminal.commandHistory
  );

  const nextSteps = steps
    .map((step) => {
      const prior = priorById.get(step.id);
      const evidence = evidenceByStepId[step.id] ?? prior?.evidence;
      if (!prior?.manualStatus && !evidence) return undefined;
      return {
        stepId: step.id,
        ...(prior?.manualStatus ? {manualStatus: prior.manualStatus} : {}),
        ...(evidence ? {evidence} : {}),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);

  if (priorMatches && shallowEqualProgressSteps(priorSteps, nextSteps)) {
    return state.runbookProgress;
  }
  return {runbookId: activeRunbook.id, bodyHash, steps: nextSteps};
}

function shallowEqualProgressSteps(
  a: NonNullable<GameRenderState['runbookProgress']>['steps'],
  b: NonNullable<GameRenderState['runbookProgress']>['steps']
) {
  if (a.length !== b.length) return false;
  return a.every((entry, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      entry.stepId === other.stepId &&
      entry.manualStatus === other.manualStatus &&
      entry.evidence?.command === other.evidence?.command &&
      entry.evidence?.at === other.evidence?.at
    );
  });
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
  const runbookFileContents = metrics.runbookFiles
    ? {...state.monitors.right.runbookFileContents, ...metrics.runbookFiles}
    : state.monitors.right.runbookFileContents;
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
      right: {
        ...state.monitors.right,
        ...(runbookFileContents ? {runbookFileContents} : {}),
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
  tab: 'runbook' | 'chat'
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

export function activateChatCompose(state: GameRenderState): GameRenderState {
  return reduceGameState(state, {type: 'activate_chat_compose'});
}

export function focusCommandInput(state: GameRenderState): GameRenderState {
  return reduceGameState(state, {type: 'focus_command_input'});
}

export function blurCommandInput(state: GameRenderState): GameRenderState {
  return reduceGameState(state, {type: 'blur_command_input'});
}

export function deactivateChatCompose(state: GameRenderState): GameRenderState {
  return reduceGameState(state, {type: 'deactivate_chat_compose'});
}

export function setChatDraft(
  state: GameRenderState,
  draft: string
): GameRenderState {
  return reduceGameState(state, {type: 'set_chat_draft', draft});
}

export function submitPlayerChatMessage(
  state: GameRenderState,
  body: string,
  atMs: number
): GameRenderState {
  return reduceGameState(state, {
    type: 'submit_player_chat_message',
    body,
    atMs,
  });
}

export function appendNpcChatMessage(
  state: GameRenderState,
  body: string,
  atMs: number,
  from: string
): GameRenderState {
  return reduceGameState(state, {
    type: 'append_npc_chat_message',
    body,
    atMs,
    from,
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

export function markRunbookStep(
  state: GameRenderState,
  runbookId: string,
  bodyHash: string,
  stepId: string,
  status: 'done' | 'failed' | 'skipped' | null
): GameRenderState {
  return reduceGameState(state, {
    type: 'mark_runbook_step',
    runbookId,
    bodyHash,
    stepId,
    status,
  });
}

export function setRecoveryChecking(
  state: GameRenderState,
  checking: boolean
): GameRenderState {
  return reduceGameState(state, {type: 'set_recovery_checking', checking});
}

export function setRecoveryLastCheck(
  state: GameRenderState,
  lastCheck: NonNullable<NonNullable<GameRenderState['recovery']>['lastCheck']>
): GameRenderState {
  return reduceGameState(state, {type: 'set_recovery_last_check', lastCheck});
}

export function setRetireConfirming(
  state: GameRenderState,
  confirming: boolean
): GameRenderState {
  return reduceGameState(state, {type: 'set_retire_confirming', confirming});
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
