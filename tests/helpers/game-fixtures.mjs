import {tsImport} from 'tsx/esm/api';
import {createEmptyTerminalMirror} from '../../apps/web/src/game/terminal/mirror.ts';

export const {
  applyLiveMetrics,
  advanceGameState,
  activateSlackCompose,
  blurCommandInput,
  computeNarrativeHour,
  createInitialGameState,
  decayWorldOverlays,
  deactivateSlackCompose,
  dismissNavigationStep,
  focusCommandInput,
  mergedSlackMessages,
  setActiveRunbook,
  setCenterTool,
  setRightPanelTab,
  setSlackDraft,
  submitPlayerSlackMessage,
  toggleExpandedMonitor,
  toggleNotificationPanel,
  unreadAlertCount,
  unreadNotificationCount,
  updateEditorPanel,
  visibleRunbooks,
} = await tsImport(
  '../../apps/web/src/game/state/gameState.ts',
  import.meta.url
);

export function baseScenario() {
  return {
    id: 'scenario_test',
    version: 1,
    title: 'Test Scenario',
    difficulty: 'beginner',
    timeLimitMinutes: 10,
    service: {
      name: 'Test API',
      healthUrl: 'http://localhost:8080/health',
    },
    briefing: [],
    startup: [],
    triggers: [],
    alerts: [],
    successConditions: [],
    runbooks: [],
    slackMessages: [],
  };
}

export function createPlayState(scenario = baseScenario(), elapsedMs = 0) {
  const state = createInitialGameState(
    scenario,
    'sess_test',
    'repl_test',
    createEmptyTerminalMirror()
  );
  return {
    ...state,
    clock: {
      ...state.clock,
      elapsedMs,
    },
  };
}
