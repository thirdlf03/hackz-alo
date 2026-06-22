import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  expandedMonitorLayout,
  inputDockRects,
  measureRunbookTabWidth,
  monitorLayout,
  navigationOverlayRect,
  notificationBellRegion,
  runbookTabRegion,
  slackComposeRegion,
  slackSendButtonRegion,
} = await tsImport(
  '../../apps/web/src/game/render/canvasLayout.ts',
  import.meta.url
);

const {editorFileAt, resolveCanvasAction} = await tsImport(
  '../../apps/web/src/game/input/canvasActions.ts',
  import.meta.url
);
import {createInitialGameState} from '../../apps/web/src/game/state/gameState.ts';
import {createEmptyTerminalMirror} from '../../apps/web/src/game/terminal/mirror.ts';

test('resolveCanvasAction maps input dock clicks to command actions', () => {
  const state = createState();

  assert.deepEqual(
    resolveCanvasAction(pointIn(inputDockRects.button), state, testScenario()),
    {type: 'end_session', mode: 'resolve'}
  );
  assert.deepEqual(
    resolveCanvasAction(pointIn(inputDockRects.retire), state, testScenario()),
    {type: 'end_session', mode: 'retire'}
  );
  assert.deepEqual(
    resolveCanvasAction(pointIn(inputDockRects.input), state, testScenario()),
    {type: 'focus_command_input'}
  );
});

test('resolveCanvasAction opens editor files from normal and expanded terminal views', () => {
  const initial = createState();
  const state = {
    ...initial,
    monitors: {
      ...initial.monitors,
      center: {
        ...initial.monitors.center,
        activeTool: 'editor',
      },
    },
  };
  const normalPoint = editorFilePoint(0);

  assert.equal(
    editorFileAt(normalPoint.x, normalPoint.y, state),
    '/workspace/services/batch/sales.un'
  );
  assert.deepEqual(resolveCanvasAction(normalPoint, state, testScenario()), {
    type: 'open_editor_file',
    path: '/workspace/services/batch/sales.un',
  });

  const expandedState = {
    ...state,
    world: {...state.world, expandedMonitor: 'terminal'},
  };
  const expandedPoint = editorFilePoint(1, true);
  assert.deepEqual(
    resolveCanvasAction(expandedPoint, expandedState, testScenario()),
    {type: 'open_editor_file', path: '/workspace/run/deploy.json'}
  );
});

test('resolveCanvasAction handles right panel tabs, runbook tabs, and notifications', () => {
  const scenario = {
    ...testScenario(),
    runbooks: [
      {id: 'first', title: 'First', body: 'one'},
      {id: 'second', title: 'Second', body: 'two'},
    ],
  };
  const state = createState(scenario);
  const tabRow = runbookTabRegion();
  const secondRunbookTabPoint = {
    x: tabRow.x + measureRunbookTabWidth('First') + 24,
    y: tabRow.y + 20,
  };

  assert.deepEqual(
    resolveCanvasAction(secondRunbookTabPoint, state, scenario),
    {type: 'runbook_tab', index: 1, runbookId: 'second'}
  );
  assert.deepEqual(
    resolveCanvasAction(pointIn(notificationBellRegion), state, scenario),
    {type: 'notification_bell'}
  );
});

test('resolveCanvasAction dismisses navigation before monitor expansion', () => {
  const state = {
    ...createState(),
    navigation: {
      dismissedStepIds: [],
      activeStepId: 'nav-1',
    },
  };

  assert.deepEqual(
    resolveCanvasAction(pointIn(navigationOverlayRect), state, testScenario()),
    {type: 'dismiss_navigation', stepId: 'nav-1'}
  );
});

test('resolveCanvasAction absorbs expanded monitor interior and closes from outside', () => {
  const initial = createState();
  const state = {
    ...initial,
    world: {...initial.world, expandedMonitor: 'metrics'},
  };

  assert.deepEqual(
    resolveCanvasAction(pointIn(expandedMonitorLayout), state, testScenario()),
    {type: 'none', absorb: true}
  );
  assert.deepEqual(resolveCanvasAction({x: 10, y: 10}, state, testScenario()), {
    type: 'close_expanded_monitor',
  });
});

test('resolveCanvasAction maps monitor magnify and slack compose targets', () => {
  const terminal = monitorLayout('terminal');
  const state = createState();

  assert.deepEqual(
    resolveCanvasAction(
      {x: terminal.x + terminal.width - 28, y: terminal.y + 24},
      state,
      testScenario()
    ),
    {type: 'toggle_expanded_monitor', monitor: 'terminal'}
  );

  const slackState = {
    ...state,
    monitors: {
      ...state.monitors,
      right: {...state.monitors.right, activePanelTab: 'slack'},
    },
  };
  assert.deepEqual(
    resolveCanvasAction(
      pointIn(slackComposeRegion()),
      slackState,
      testScenario()
    ),
    {type: 'slack_compose'}
  );
  assert.deepEqual(
    resolveCanvasAction(
      pointIn(slackSendButtonRegion()),
      slackState,
      testScenario()
    ),
    {type: 'slack_send'}
  );
});

test('resolveCanvasAction keeps slack compose interactive in expanded runbook view', () => {
  const initial = createState();
  const state = {
    ...initial,
    monitors: {
      ...initial.monitors,
      right: {...initial.monitors.right, activePanelTab: 'slack'},
    },
    world: {...initial.world, expandedMonitor: 'runbook'},
  };

  assert.deepEqual(
    resolveCanvasAction(
      pointIn(slackComposeRegion('slack', 'runbook')),
      state,
      testScenario()
    ),
    {type: 'slack_compose'}
  );
  assert.deepEqual(
    resolveCanvasAction(
      pointIn(slackSendButtonRegion('slack', 'runbook')),
      state,
      testScenario()
    ),
    {type: 'slack_send'}
  );
});

test('resolveCanvasAction deactivates slack compose on outside clicks', () => {
  const state = {
    ...createState(),
    slackCompose: {active: true, draft: 'hello'},
  };

  assert.deepEqual(resolveCanvasAction({x: 10, y: 10}, state, testScenario()), {
    type: 'deactivate_slack_compose',
  });
});

function createState(scenario = testScenario()) {
  return createInitialGameState(
    scenario,
    'sess_test',
    'repl_test',
    createEmptyTerminalMirror()
  );
}

function editorFilePoint(index, expanded = false) {
  const monitor = expanded ? expandedMonitorLayout : monitorLayout('terminal');
  const contentX = monitor.x + 22;
  const contentY = monitor.y + 64;
  const contentWidth = monitor.width - 44;
  const contentHeight = monitor.height - 80;
  const scale = Math.min(contentWidth / 496, contentHeight / 540);
  return {
    x: contentX + 20 * scale,
    y: contentY + (66 + 8 + index * 28 + 4) * scale,
  };
}

function pointIn(region) {
  return {
    x: region.x + Math.min(10, region.width / 2),
    y: region.y + Math.min(10, region.height / 2),
  };
}

function testScenario() {
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
