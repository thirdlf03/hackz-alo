import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  advanceGameState,
  applyLiveMetrics,
  activateChatCompose,
  blurCommandInput,
  computeNarrativeHour,
  createPlayState,
  baseScenario,
  decayWorldOverlays,
  deactivateChatCompose,
  dismissNavigationStep,
  focusCommandInput,
  setActiveRunbook,
  setCenterTool,
  setRecoveryChecking,
  setRecoveryLastCheck,
  setRetireConfirming,
  setRightPanelTab,
  setChatDraft,
  submitPlayerChatMessage,
  toggleExpandedMonitor,
  toggleNotificationPanel,
  unreadAlertCount,
  unreadNotificationCount,
  updateEditorPanel,
  visibleRunbooks,
} from '../helpers/game-fixtures.mjs';

test('visibleRunbooks filters by availableAtMs and pulses on arrival', () => {
  const scenario = {
    ...baseScenario(),
    runbooks: [
      {id: 'early', title: 'Early', body: 'now'},
      {id: 'late', title: 'Late', body: 'later', availableAtMs: 90_000},
    ],
  };

  assert.equal(visibleRunbooks(scenario, 0).length, 1);
  assert.equal(visibleRunbooks(scenario, 90_000).length, 2);

  let state = createPlayState(scenario);
  assert.equal(state.monitors.right.activeRunbook?.id, 'early');
  assert.equal(state.notifications.pulseMs, 0);

  state = advanceGameState(state, 90_000, scenario, 1, 60_000);
  assert.equal(state.monitors.right.activeRunbook?.id, 'early');
  assert.equal(state.notifications.pulseMs, 2400);
  assert.equal(visibleRunbooks(scenario, state.clock.elapsedMs).length, 2);
});

test('computeNarrativeHour maps session progress to midnight shift hours', () => {
  assert.equal(computeNarrativeHour(0, 60_000), 0);
  assert.equal(computeNarrativeHour(30_000, 60_000), 3);
  assert.equal(computeNarrativeHour(60_000, 60_000), 6);
});

test('advanceGameState updates narrativeHour with elapsed time', () => {
  const scenario = baseScenario();
  let state = createPlayState(scenario);
  assert.equal(state.world.narrativeHour, 0);

  state = advanceGameState(state, 300_000, scenario, 1, 60_000);
  assert.equal(state.world.narrativeHour, 3);
});

test('applyLiveMetrics stores live metrics and caps history', () => {
  let state = createPlayState();

  for (let at = 0; at < 35; at += 1) {
    state = applyLiveMetrics(state, metricAt(at));
  }

  assert.equal(state.monitors.left.metricsSource, 'live');
  assert.equal(state.monitors.left.metrics.at, 34);
  assert.equal(state.monitors.left.metricsHistory.length, 30);
  assert.equal(state.monitors.left.metricsHistory[0].at, 5);
  assert.equal(state.monitors.left.metricsHistory.at(-1).at, 34);
});

test('applyLiveMetrics stores session edge RTT history', () => {
  let state = createPlayState();
  state = applyLiveMetrics(state, metricAt(1), 42);
  state = applyLiveMetrics(state, metricAt(2), 55);

  assert.equal(state.monitors.left.edgeRttMs, 55);
  assert.deepEqual(state.monitors.left.edgeRttHistory, [42, 55]);
});

test('right panel tab switches mark chat seen and deactivate compose on runbook', () => {
  const initial = createPlayState();
  const state = {
    ...initial,
    monitors: {
      ...initial.monitors,
      right: {
        ...initial.monitors.right,
        chatMessages: [{id: 'server-1', atMs: 10, from: 'SRE', body: 'ping'}],
      },
    },
    playerChatMessages: [
      {id: 'player-1', atMs: 20, from: 'あなた', body: 'pong'},
    ],
    chatCompose: {active: true, draft: 'draft'},
  };

  const chatState = setRightPanelTab(state, 'chat');
  assert.equal(chatState.monitors.right.activePanelTab, 'chat');
  assert.deepEqual(chatState.seenChatIds.sort(), ['player-1', 'server-1']);
  assert.equal(chatState.chatCompose.active, true);

  const runbookState = setRightPanelTab(chatState, 'runbook');
  assert.equal(runbookState.monitors.right.activePanelTab, 'runbook');
  assert.deepEqual(runbookState.seenChatIds.sort(), ['player-1', 'server-1']);
  assert.equal(runbookState.chatCompose.active, false);
  assert.equal(runbookState.chatCompose.draft, 'draft');
});

test('toggleNotificationPanel marks visible notifications as read on open', () => {
  const initial = createPlayState();
  const state = {
    ...initial,
    monitors: {
      ...initial.monitors,
      left: {
        ...initial.monitors.left,
        alerts: [
          {
            id: 'alert-1',
            atMs: 100,
            severity: 'warning',
            title: 'High latency',
            body: 'p95 elevated',
          },
        ],
      },
      right: {
        ...initial.monitors.right,
        chatMessages: [{id: 'chat-1', atMs: 200, from: 'SRE', body: 'look'}],
      },
    },
    notifications: {...initial.notifications, pulseMs: 1200},
    playerChatMessages: [
      {id: 'player-1', atMs: 300, from: 'あなた', body: 'checking'},
    ],
    chatCompose: {active: true, draft: 'draft'},
  };

  const open = toggleNotificationPanel(state);
  assert.equal(open.notifications.panelOpen, true);
  assert.equal(open.notifications.pulseMs, 0);
  assert.deepEqual(open.notifications.readAlertIds, ['alert-1']);
  assert.deepEqual(open.seenChatIds.sort(), ['chat-1', 'player-1']);
  assert.equal(unreadNotificationCount(open), 0);
  assert.equal(open.chatCompose.active, true);

  const closed = toggleNotificationPanel(open);
  assert.equal(closed.notifications.panelOpen, false);
  assert.equal(closed.chatCompose.active, false);
  assert.equal(closed.chatCompose.draft, 'draft');
});

test('editor and focus reducers keep unrelated state intact', () => {
  const initial = {
    ...createPlayState(),
    commandInputFocused: true,
  };

  const editorState = setCenterTool(initial, 'editor');
  assert.equal(editorState.commandInputFocused, false);
  assert.equal(editorState.monitors.center.activeTool, 'editor');

  const updated = updateEditorPanel(editorState, (editor) => ({
    ...editor,
    content: 'new content',
    dirty: true,
    cursor: {line: 3, column: 7},
  }));
  assert.equal(updated.monitors.center.activeTool, 'editor');
  assert.equal(updated.monitors.center.editor.content, 'new content');
  assert.equal(updated.monitors.center.editor.dirty, true);
  assert.deepEqual(updated.monitors.center.editor.cursor, {line: 3, column: 7});
});

test('navigation, expansion, and chat compose reducers are idempotent where expected', () => {
  const state = createPlayState();

  const dismissed = dismissNavigationStep(state, 'nav-1');
  assert.deepEqual(dismissed.navigation.dismissedStepIds, ['nav-1']);
  assert.equal(dismissNavigationStep(dismissed, 'nav-1'), dismissed);

  const expanded = toggleExpandedMonitor(state, 'metrics');
  assert.equal(expanded.world.expandedMonitor, 'metrics');
  assert.equal(
    toggleExpandedMonitor(expanded, 'metrics').world.expandedMonitor,
    null
  );

  const inactive = deactivateChatCompose(state);
  assert.equal(inactive, state);
  const active = setChatDraft(
    {...state, chatCompose: {active: true, draft: 'draft'}},
    'changed'
  );
  const deactivated = deactivateChatCompose(active);
  assert.deepEqual(deactivated.chatCompose, {active: false, draft: ''});
});

test('setActiveRunbook tracks opened runbooks and ignores unavailable indexes', () => {
  const scenario = {
    ...baseScenario(),
    runbooks: [
      {id: 'early', title: 'Early', body: 'now'},
      {id: 'late', title: 'Late', body: 'later', availableAtMs: 60_000},
    ],
  };
  const state = advanceGameState(
    createPlayState(scenario),
    60_000,
    scenario,
    1,
    60_000
  );

  const selected = setActiveRunbook(state, scenario, 1);
  assert.equal(selected.monitors.right.activePanelTab, 'runbook');
  assert.equal(selected.monitors.right.activeRunbook?.id, 'late');
  assert.deepEqual(selected.openedRunbookIds, ['early', 'late']);
  assert.equal(setActiveRunbook(selected, scenario, 10), selected);
});

test('submitPlayerChatMessage trims body and ignores blank messages', () => {
  const state = {
    ...createPlayState(),
    chatCompose: {active: true, draft: '  hello  '},
  };

  assert.equal(submitPlayerChatMessage(state, '   ', 100), state);
  const submitted = submitPlayerChatMessage(state, '  hello  ', 120);
  assert.equal(submitted.playerChatMessages.length, 1);
  assert.equal(submitted.playerChatMessages[0].from, 'あなた');
  assert.equal(submitted.playerChatMessages[0].body, 'hello');
  assert.equal(submitted.playerChatMessages[0].atMs, 120);
  assert.deepEqual(submitted.chatCompose, {active: false, draft: ''});
});

test('focus, warning decay, and unread counters cover remaining reducers', () => {
  const base = createPlayState();
  const focused = focusCommandInput(base);
  assert.equal(focused.commandInputFocused, true);
  assert.equal(focusCommandInput(focused), focused);

  const blurred = blurCommandInput(focused);
  assert.equal(blurred.commandInputFocused, false);
  assert.equal(blurCommandInput(blurred), blurred);

  const compose = activateChatCompose(base);
  assert.equal(compose.commandInputFocused, false);
  assert.equal(compose.chatCompose.active, true);

  const warned = {
    ...base,
    warning: {message: 'slow down', flashMs: 500},
  };
  const decayed = decayWorldOverlays(warned, 200);
  assert.equal(decayed.warning?.flashMs, 300);
  const cleared = decayWorldOverlays(decayed, 400);
  assert.equal(cleared.warning, undefined);

  const withAlerts = {
    ...base,
    monitors: {
      ...base.monitors,
      left: {
        ...base.monitors.left,
        alerts: [
          {
            id: 'alert-1',
            atMs: 1,
            severity: 'warning',
            title: 'warn',
            body: 'body',
          },
        ],
      },
    },
  };
  assert.equal(unreadAlertCount(withAlerts), 1);
  assert.equal(unreadNotificationCount(withAlerts), 1);

  const scenario = {
    ...baseScenario(),
    navigationSteps: [{id: 'nav-1', atMs: 0, hint: 'click terminal'}],
  };
  const withNav = advanceGameState(
    createPlayState(scenario),
    1_000,
    scenario,
    1,
    1_000
  );
  assert.equal(withNav.navigation.activeStepId, 'nav-1');
});

test('advanceGameState pulses when new chat messages arrive from the server', () => {
  const scenario = baseScenario();
  const initial = createPlayState(scenario, 1_000);
  const serverChat = [
    {id: 'chat-new', atMs: 2_000, from: 'SRE', body: 'check queue'},
  ];
  const next = advanceGameState(
    initial,
    2_000,
    scenario,
    1,
    1_000,
    initial.monitors.left.alerts,
    serverChat
  );
  assert.equal(next.monitors.right.chatMessages.length, 1);
  assert.equal(next.notifications.pulseMs, 2400);
});

test('setRecoveryChecking flips the checking flag and preserves lastCheck/retireConfirming', () => {
  const initial = createPlayState();
  const checking = setRecoveryChecking(initial, true);
  assert.deepEqual(checking.recovery, {checking: true});

  const withRetire = setRetireConfirming(checking, true);
  const stillChecking = setRecoveryChecking(withRetire, true);
  assert.equal(stillChecking, withRetire, 'no-op when value is unchanged');

  const doneChecking = setRecoveryChecking(withRetire, false);
  assert.deepEqual(doneChecking.recovery, {
    checking: false,
    retireConfirming: true,
  });
});

test('setRecoveryLastCheck records the result and clears checking', () => {
  const initial = setRecoveryChecking(createPlayState(), true);
  const lastCheck = {
    at: 12_345,
    declarable: true,
    allOk: false,
    checks: [{label: 'health が 200', ok: false}],
  };
  const next = setRecoveryLastCheck(initial, lastCheck);
  assert.deepEqual(next.recovery, {checking: false, lastCheck});
});

test('setRecoveryLastCheck preserves an in-progress retireConfirming flag', () => {
  const initial = setRetireConfirming(createPlayState(), true);
  const lastCheck = {
    at: 1,
    declarable: false,
    allOk: false,
    checks: [],
  };
  const next = setRecoveryLastCheck(initial, lastCheck);
  assert.deepEqual(next.recovery, {
    checking: false,
    lastCheck,
    retireConfirming: true,
  });
});

test('setRetireConfirming toggles the confirmation overlay flag', () => {
  const initial = createPlayState();
  const opened = setRetireConfirming(initial, true);
  assert.equal(opened.recovery.retireConfirming, true);

  const noop = setRetireConfirming(opened, true);
  assert.equal(noop, opened, 'no-op when value is unchanged');

  const closed = setRetireConfirming(opened, false);
  assert.equal(closed.recovery.retireConfirming, false);
});

function metricAt(at) {
  return {
    at,
    cpu: at,
    memory: at,
    disk: at,
    http5xxRate: at,
    latencyP95Ms: at,
    rps: at,
    dbConnections: at,
    queueDepth: at,
  };
}
