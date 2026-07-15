import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';
import {baseScenario, createPlayState} from '../helpers/game-fixtures.mjs';

const {
  expandedMonitorLayout,
  inputDockRects,
  measureRunbookTabWidth,
  monitorContentRegion,
  monitorContentWidth,
  monitorContentHeight,
  monitorHeaderHeight,
  monitorLayout,
  monitorMagnifyRegions,
  notificationBellRegion,
  retireConfirmButtonRects,
  runbookTabRegion,
  chatComposeRegion,
  chatSendButtonRegion,
} = await tsImport(
  '../../apps/web/src/game/render/canvasLayout.ts',
  import.meta.url
);

const {editorFileAt, resolveCanvasAction} = await tsImport(
  '../../apps/web/src/game/input/canvasActions.ts',
  import.meta.url
);

test('resolveCanvasAction maps input dock clicks to command actions', () => {
  const state = createPlayState();

  assert.deepEqual(
    resolveCanvasAction(pointIn(inputDockRects.button), state, baseScenario()),
    {type: 'recovery_check'}
  );
  assert.deepEqual(
    resolveCanvasAction(pointIn(inputDockRects.retire), state, baseScenario()),
    {type: 'retire_request'}
  );
  assert.deepEqual(
    resolveCanvasAction(pointIn(inputDockRects.input), state, baseScenario()),
    {type: 'focus_command_input'}
  );
});

test('resolveCanvasAction only exposes "訓練を完了" once recovery.lastCheck.allOk is true', () => {
  const base = createPlayState();
  const notYetChecked = base;
  const failing = {
    ...base,
    recovery: {
      checking: false,
      lastCheck: {
        at: Date.now(),
        declarable: true,
        allOk: false,
        checks: [{label: 'health が 200', ok: false}],
      },
    },
  };
  const allOk = {
    ...base,
    recovery: {
      checking: false,
      lastCheck: {
        at: Date.now(),
        declarable: true,
        allOk: true,
        checks: [{label: 'health が 200', ok: true}],
      },
    },
  };

  // Before allOk, clicking where the "訓練を完了" button would be drawn
  // falls through to "no action" rather than ending the session.
  for (const state of [notYetChecked, failing]) {
    assert.deepEqual(
      resolveCanvasAction(
        pointIn(inputDockRects.trainComplete),
        state,
        baseScenario()
      ),
      {type: 'none'}
    );
  }

  assert.deepEqual(
    resolveCanvasAction(
      pointIn(inputDockRects.trainComplete),
      allOk,
      baseScenario()
    ),
    {type: 'end_session', mode: 'resolve'}
  );
});

test('resolveCanvasAction routes the retire confirmation overlay while retireConfirming is true', () => {
  const state = {
    ...createPlayState(),
    recovery: {checking: false, retireConfirming: true},
  };

  assert.deepEqual(
    resolveCanvasAction(
      pointIn(retireConfirmButtonRects.confirm),
      state,
      baseScenario()
    ),
    {type: 'retire_confirm'}
  );
  assert.deepEqual(
    resolveCanvasAction(
      pointIn(retireConfirmButtonRects.cancel),
      state,
      baseScenario()
    ),
    {type: 'retire_cancel'}
  );
  // Every other click (e.g. the input dock behind the modal) is absorbed.
  assert.deepEqual(
    resolveCanvasAction(pointIn(inputDockRects.button), state, baseScenario()),
    {type: 'none', absorb: true}
  );
});

test('resolveCanvasAction opens editor files from normal and expanded terminal views', () => {
  const initial = createPlayState();
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
    '/workspace/services/batch/sales.kdm'
  );
  assert.deepEqual(resolveCanvasAction(normalPoint, state, baseScenario()), {
    type: 'open_editor_file',
    path: '/workspace/services/batch/sales.kdm',
  });

  const expandedState = {
    ...state,
    world: {...state.world, expandedMonitor: 'terminal'},
  };
  const expandedPoint = editorFilePoint(1, true);
  assert.deepEqual(
    resolveCanvasAction(expandedPoint, expandedState, baseScenario()),
    {type: 'open_editor_file', path: '/workspace/etc/yamabiko-api.json'}
  );
});

test('resolveCanvasAction handles right panel tabs, runbook tabs, and notifications', () => {
  const scenario = {
    ...baseScenario(),
    runbooks: [
      {id: 'first', title: 'First', body: 'one'},
      {id: 'second', title: 'Second', body: 'two'},
    ],
  };
  const state = createPlayState(scenario);
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

test('resolveCanvasAction absorbs expanded monitor interior and closes from outside', () => {
  const initial = createPlayState();
  const state = {
    ...initial,
    world: {...initial.world, expandedMonitor: 'metrics'},
  };

  assert.deepEqual(
    resolveCanvasAction(pointIn(expandedMonitorLayout), state, baseScenario()),
    {type: 'none', absorb: true}
  );
  assert.deepEqual(resolveCanvasAction({x: 10, y: 10}, state, baseScenario()), {
    type: 'close_expanded_monitor',
  });
});

test('resolveCanvasAction maps monitor magnify and chat compose targets', () => {
  const state = createPlayState();
  const terminalMagnify = monitorMagnifyRegions.find(
    (region) => region.id === 'terminal'
  );

  assert.deepEqual(
    resolveCanvasAction(pointIn(terminalMagnify), state, baseScenario()),
    {type: 'toggle_expanded_monitor', monitor: 'terminal'}
  );

  const chatState = {
    ...state,
    monitors: {
      ...state.monitors,
      right: {...state.monitors.right, activePanelTab: 'chat'},
    },
  };
  assert.deepEqual(
    resolveCanvasAction(
      pointIn(chatComposeRegion()),
      chatState,
      baseScenario()
    ),
    {type: 'chat_compose'}
  );
  assert.deepEqual(
    resolveCanvasAction(
      pointIn(chatSendButtonRegion()),
      chatState,
      baseScenario()
    ),
    {type: 'chat_send'}
  );
});

test('resolveCanvasAction keeps chat compose interactive in expanded runbook view', () => {
  const initial = createPlayState();
  const state = {
    ...initial,
    monitors: {
      ...initial.monitors,
      right: {...initial.monitors.right, activePanelTab: 'chat'},
    },
    world: {...initial.world, expandedMonitor: 'runbook'},
  };

  assert.deepEqual(
    resolveCanvasAction(
      pointIn(chatComposeRegion('chat', 'runbook')),
      state,
      baseScenario()
    ),
    {type: 'chat_compose'}
  );
  assert.deepEqual(
    resolveCanvasAction(
      pointIn(chatSendButtonRegion('chat', 'runbook')),
      state,
      baseScenario()
    ),
    {type: 'chat_send'}
  );
});

test('resolveCanvasAction deactivates chat compose on outside clicks', () => {
  const state = {
    ...createPlayState(),
    chatCompose: {active: true, draft: 'hello'},
  };

  assert.deepEqual(resolveCanvasAction({x: 10, y: 10}, state, baseScenario()), {
    type: 'deactivate_chat_compose',
  });
});

function editorFilePoint(index, expanded = false) {
  const monitor = expanded ? expandedMonitorLayout : monitorLayout('terminal');
  const content = monitorContentRegion(
    monitor,
    monitorHeaderHeight('terminal')
  );
  const scale = Math.min(
    content.width / monitorContentWidth,
    content.height / monitorContentHeight
  );
  return {
    x: content.x + 20 * scale,
    y: content.y + (66 + 8 + index * 28 + 4) * scale,
  };
}

function pointIn(region) {
  return {
    x: region.x + Math.min(10, region.width / 2),
    y: region.y + Math.min(10, region.height / 2),
  };
}
