import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';
import {baseScenario, createPlayState} from '../helpers/game-fixtures.mjs';

const {buildCanvasViewModel} = await tsImport(
  '../../apps/web/src/game/render/canvasViewModel.ts',
  import.meta.url
);

test('buildCanvasViewModel exposes visible runbooks from scenario timeline', () => {
  const scenario = {
    ...baseScenario(),
    id: 'demo-tutorial-001',
    title: 'Tutorial',
    timeLimitMinutes: 30,
    runbooks: [
      {id: 'early', title: 'Early', body: 'now'},
      {id: 'late', title: 'Late', body: 'later', availableAtMs: 90_000},
    ],
  };
  const state = createPlayState(scenario, 90_000);

  const viewModel = buildCanvasViewModel(state, scenario);
  assert.equal(viewModel.visibleRunbooks.length, 2);
  assert.equal(viewModel.visibleRunbooks[1]?.id, 'late');
});

test('buildCanvasViewModel merges chat and counts unread notifications', () => {
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
            severity: 'critical',
            message: 'disk full',
            atMs: 1_000,
          },
        ],
      },
      right: {
        ...initial.monitors.right,
        chatMessages: [{id: 'srv-1', from: 'bot', body: 'help', atMs: 2_000}],
      },
    },
    playerChatMessages: [
      {id: 'ply-1', from: 'あなた', body: 'checking', atMs: 3_000},
    ],
    seenChatIds: ['srv-1'],
    notifications: {
      ...initial.notifications,
      readAlertIds: [],
    },
  };

  const viewModel = buildCanvasViewModel(state, baseScenario());
  assert.equal(viewModel.mergedChatMessages.length, 2);
  assert.equal(viewModel.mergedChatMessages[0]?.id, 'srv-1');
  assert.equal(viewModel.mergedChatMessages[1]?.id, 'ply-1');
  assert.equal(viewModel.unreadChat, true);
  assert.equal(viewModel.unreadNotificationCount, 2);
  assert.equal(viewModel.recentChatMessages.length, 2);
});

test('buildCanvasViewModel sorts notification panel items by recency', () => {
  const initial = createPlayState();
  const state = {
    ...initial,
    monitors: {
      ...initial.monitors,
      left: {
        ...initial.monitors.left,
        alerts: [
          {
            id: 'alert-old',
            severity: 'warn',
            message: 'old',
            atMs: 1_000,
          },
          {
            id: 'alert-new',
            severity: 'critical',
            message: 'new',
            atMs: 5_000,
          },
        ],
      },
      right: {
        ...initial.monitors.right,
        chatMessages: [{id: 'chat-mid', from: 'bot', body: 'mid', atMs: 3_000}],
      },
    },
    notifications: {
      ...initial.notifications,
      readAlertIds: ['alert-old'],
    },
    seenChatIds: [],
  };

  const viewModel = buildCanvasViewModel(state, baseScenario());
  assert.equal(viewModel.notificationPanelItems.length, 3);
  assert.equal(viewModel.notificationPanelItems[0]?.kind, 'alert');
  assert.equal(
    viewModel.notificationPanelItems[0]?.kind === 'alert'
      ? viewModel.notificationPanelItems[0].alert.id
      : '',
    'alert-new'
  );
  assert.equal(viewModel.notificationPanelItems[1]?.kind, 'chat');
  assert.equal(
    viewModel.notificationPanelItems[2]?.kind === 'alert'
      ? viewModel.notificationPanelItems[2].alert.id
      : '',
    'alert-old'
  );
  assert.equal(
    viewModel.notificationPanelItems[2]?.kind === 'alert'
      ? viewModel.notificationPanelItems[2].unread
      : true,
    false
  );
});
