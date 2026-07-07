import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  centerEditorOverlayRegion,
  centerToolAt,
  centerToolTabRegions,
  containsCanvasPoint,
  inputDockRects,
  logicalHeight,
  logicalWidth,
  measureRunbookTabWidth,
  metricsPanelScrollRegion,
  monitorContentRegion,
  monitorMagnifyAt,
  monitorMagnifyRegions,
  monitorLayout,
  monitorLayouts,
  navigationOverlayRect,
  notificationBellRegion,
  notificationPanelRegion,
  rightPanelLayout,
  rightPanelPrimaryTabAt,
  runbookTabRegion,
  runbookTabAt,
  chatComposeAt,
  chatComposeRegion,
  chatSendButtonRegion,
} = await tsImport(
  '../../apps/web/src/game/render/canvasLayout.ts',
  import.meta.url
);

test('measureRunbookTabWidth clamps text measurement to stable tab sizes', () => {
  assert.equal(measureRunbookTabWidth('wide-tab-label'), 240);

  assert.equal(
    measureRunbookTabWidth('x', () => 1),
    132
  );
  assert.equal(
    measureRunbookTabWidth('wide', () => 1000),
    240
  );
  assert.equal(
    measureRunbookTabWidth('middle', () => 140),
    172
  );
});

test('rightPanelLayout returns stable vertical regions', () => {
  assert.deepEqual(rightPanelLayout('runbook', true), {
    primaryTop: 0,
    secondaryTop: 48,
    contentTop: 116,
    composeTop: 480,
    chatMessagesTop: 68,
    chatMessagesBottom: 468,
  });
  assert.equal(rightPanelLayout('runbook', false).contentTop, 68);
  assert.equal(rightPanelLayout('chat', true).contentTop, 68);
});

test('monitor layout helpers derive content and overlay regions', () => {
  assert.deepEqual(
    monitorLayouts.map((monitor) => monitor.id),
    ['metrics', 'terminal', 'runbook']
  );
  assert.equal(monitorLayout('metrics'), monitorLayouts[0]);
  assert.equal(monitorLayout('missing'), undefined);

  const terminalContent = monitorContentRegion(monitorLayout('terminal'));
  assert.deepEqual(terminalContent, {
    x: 712,
    y: 204,
    width: 496,
    height: 540,
  });
  assert.deepEqual(centerEditorOverlayRegion(), {
    x: 868,
    y: 270,
    width: 340,
    height: 470,
  });
  assert.equal(centerEditorOverlayRegion(true).x, 282 + 156 * (700 / 540));
  assert.deepEqual(metricsPanelScrollRegion(), {
    x: 92,
    y: 260,
    width: 496,
    height: 484,
  });
});

test('static canvas regions stay bounded and hidden regions stay offscreen', () => {
  const visibleRegions = [
    notificationBellRegion,
    notificationPanelRegion,
    inputDockRects.input,
    inputDockRects.retire,
    inputDockRects.button,
    navigationOverlayRect,
    runbookTabRegion(),
  ];

  for (const region of visibleRegions) {
    assert.equal(containsCanvasPoint(region, region.x + 1, region.y + 1), true);
    assert.equal(
      region.x >= 0 && region.x + region.width <= logicalWidth,
      true
    );
    assert.equal(
      region.y >= 0 && region.y + region.height <= logicalHeight,
      true
    );
  }
  assert.equal(containsCanvasPoint(notificationBellRegion, 0, 0), false);
  assert.deepEqual(chatComposeRegion('runbook'), {
    x: 0,
    y: -1000,
    width: 0,
    height: 0,
  });
  assert.deepEqual(chatSendButtonRegion('runbook'), {
    x: 0,
    y: -1000,
    width: 0,
    height: 0,
  });
});

test('centerToolAt resolves terminal and editor tabs by canvas coordinates', () => {
  const [terminal, editor] = centerToolTabRegions();
  assert.equal(
    centerToolAt(
      terminal.x + terminal.width / 2,
      terminal.y + terminal.height / 2
    ),
    'terminal'
  );
  assert.equal(
    centerToolAt(editor.x + editor.width / 2, editor.y + editor.height / 2),
    'editor'
  );
  assert.equal(centerToolAt(20, 20), null);
});

test('rightPanelPrimaryTabAt respects normal and expanded monitor coordinates', () => {
  assert.equal(rightPanelPrimaryTabAt(1340, 224, null), 'runbook');
  assert.equal(rightPanelPrimaryTabAt(1450, 224, null), 'chat');
  assert.equal(rightPanelPrimaryTabAt(1340, 224, 'terminal'), null);
  assert.equal(rightPanelPrimaryTabAt(310, 120, 'runbook'), 'runbook');
});

test('runbookTabAt resolves document tabs and ignores non-runbook panels', () => {
  const y = 204 + 48 + 20;
  assert.equal(runbookTabAt(1340, y, 2, ['First', 'Second']), 0);
  assert.equal(runbookTabAt(1485, y, 2, ['First', 'Second']), 1);
  assert.equal(runbookTabAt(1340, y, 2, ['First', 'Second'], null, 'chat'), -1);
  assert.equal(runbookTabAt(1340, y, 0, []), -1);
});

test('chatComposeAt distinguishes compose box from send button', () => {
  const compose = chatComposeRegion('chat');
  assert.equal(
    chatComposeAt(compose.x + 20, compose.y + compose.height / 2, 'chat'),
    'compose'
  );

  const send = chatSendButtonRegion('chat');
  assert.equal(
    chatComposeAt(send.x + send.width / 2, send.y + send.height / 2, 'chat'),
    'send'
  );
  assert.equal(chatComposeAt(compose.x + 20, compose.y + 20, 'runbook'), null);
});

test('monitorMagnifyAt resolves monitor magnify affordances', () => {
  for (const region of monitorMagnifyRegions) {
    assert.equal(
      monitorMagnifyAt(
        region.x + region.width / 2,
        region.y + region.height / 2
      ),
      region.id
    );
  }
  assert.equal(monitorMagnifyAt(0, 0), null);
});

test('centerToolTabRegions and chatComposeAt cover expanded hit targets', () => {
  const tabs = centerToolTabRegions();
  assert.equal(tabs.length, 2);
  assert.equal(tabs[0]?.id, 'terminal');

  const composePoint = chatComposeRegion('chat');
  assert.equal(
    chatComposeAt(composePoint.x + 10, composePoint.y + 10, 'chat'),
    'compose'
  );

  const expandedCompose = chatComposeRegion('chat', 'runbook');
  assert.equal(
    chatComposeAt(
      expandedCompose.x + 10,
      expandedCompose.y + 10,
      'chat',
      'runbook'
    ),
    'compose'
  );
});

test('expanded monitor helpers scale metrics and runbook regions', () => {
  const expandedMetrics = metricsPanelScrollRegion(true);
  assert.equal(expandedMetrics.x, 282);
  assert.equal(expandedMetrics.width, 1356);

  const expandedEditor = centerEditorOverlayRegion(true);
  assert.equal(expandedEditor.x, 282 + 156 * (700 / 540));

  const expandedCompose = chatComposeRegion('chat', 'runbook');
  assert.equal(expandedCompose.width > 0, true);
  const expandedSend = chatSendButtonRegion('chat', 'runbook');
  assert.equal(expandedSend.width > 0, true);

  assert.equal(
    runbookTabAt(366, 202, 2, ['First', 'Second'], 'runbook', 'runbook'),
    0
  );
  assert.equal(rightPanelPrimaryTabAt(310, 120, 'runbook'), 'runbook');
});
