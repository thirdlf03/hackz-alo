import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  alertBandRect,
  centerEditorOverlayRegion,
  centerToolAt,
  centerToolTabRegions,
  commandWarningRect,
  containsCanvasPoint,
  expandedMonitorLayout,
  inputDockRects,
  logicalHeight,
  logicalWidth,
  measureRunbookTabWidth,
  metricsPanelScrollRegion,
  monitorContentRegion,
  monitorContentWidth,
  monitorContentHeight,
  monitorHeaderHeight,
  monitorMagnifyAt,
  monitorMagnifyRegions,
  monitorLayout,
  monitorLayouts,
  navigationOverlayRect,
  notificationBellRegion,
  notificationPanelRegion,
  PANEL_PADDING,
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

test('the three flat panels fill the main area without overlapping', () => {
  assert.deepEqual(
    monitorLayouts.map((monitor) => monitor.id),
    ['metrics', 'terminal', 'runbook']
  );
  assert.equal(monitorLayout('metrics'), monitorLayouts[0]);
  assert.equal(monitorLayout('missing'), undefined);

  for (const monitor of monitorLayouts) {
    assert.ok(monitor.x >= 0 && monitor.x + monitor.width <= logicalWidth);
    assert.ok(monitor.y >= 0 && monitor.y + monitor.height <= logicalHeight);
  }

  const sorted = [...monitorLayouts].sort((a, b) => a.x - b.x);
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const left = sorted[index];
    const right = sorted[index + 1];
    assert.ok(
      left.x + left.width <= right.x,
      `${left.id} must not overlap ${right.id}`
    );
    // All three columns start/end at the same row.
    assert.equal(left.y, right.y);
    assert.equal(left.height, right.height);
  }

  // TERMINAL is the dominant "operable" column (matches the 6a-5 mock intent
  // of a wide central working panel), METRICS/RUNBOOK are the narrower side
  // panels.
  const terminal = monitorLayout('terminal');
  const metrics = monitorLayout('metrics');
  const runbook = monitorLayout('runbook');
  assert.ok(terminal.width > metrics.width);
  assert.ok(terminal.width > runbook.width);
});

test('the alert band and command warning sit above the panels without overlap', () => {
  for (const box of [alertBandRect, commandWarningRect]) {
    assert.ok(box.x >= 0 && box.x + box.width <= logicalWidth);
    assert.ok(box.y >= 0 && box.y + box.height <= logicalHeight);
  }
  assert.ok(
    commandWarningRect.y + commandWarningRect.height <= alertBandRect.y
  );
  const terminal = monitorLayout('terminal');
  assert.ok(alertBandRect.y + alertBandRect.height <= terminal.y);
});

test('monitor content regions stay inset within their panel and scale to fit', () => {
  for (const monitor of monitorLayouts) {
    const headerHeight = monitorHeaderHeight(monitor.id);
    const content = monitorContentRegion(monitor, headerHeight);
    assert.deepEqual(content, {
      x: monitor.x + PANEL_PADDING,
      y: monitor.y + headerHeight + PANEL_PADDING,
      width: monitor.width - PANEL_PADDING * 2,
      height: monitor.height - headerHeight - PANEL_PADDING * 2,
    });
    // Content never spills outside the panel it belongs to.
    assert.ok(content.x >= monitor.x);
    assert.ok(content.y >= monitor.y);
    assert.ok(content.x + content.width <= monitor.x + monitor.width);
    assert.ok(content.y + content.height <= monitor.y + monitor.height);
    // Panels never shrink content below the native virtual size (keeps
    // canvas text at/above the accessibility font floor).
    const scale = Math.min(
      content.width / monitorContentWidth,
      content.height / monitorContentHeight
    );
    assert.ok(scale >= 0.95);
  }

  // RUNBOOK reserves no chrome header band: its own tab row is the header.
  assert.equal(monitorHeaderHeight('runbook'), 0);
  assert.ok(monitorHeaderHeight('metrics') > 0);
  assert.ok(monitorHeaderHeight('terminal') > 0);
});

test('centerEditorOverlayRegion and metricsPanelScrollRegion stay within their content region', () => {
  const terminal = monitorLayout('terminal');
  const terminalContent = monitorContentRegion(
    terminal,
    monitorHeaderHeight('terminal')
  );
  const editorOverlay = centerEditorOverlayRegion();
  assert.ok(editorOverlay.x >= terminalContent.x);
  assert.ok(
    editorOverlay.x + editorOverlay.width <=
      terminalContent.x + terminalContent.width + 1
  );
  assert.ok(
    editorOverlay.y + editorOverlay.height <=
      terminalContent.y + terminalContent.height + 1
  );

  const metrics = monitorLayout('metrics');
  const metricsContent = monitorContentRegion(
    metrics,
    monitorHeaderHeight('metrics')
  );
  const scroll = metricsPanelScrollRegion();
  assert.equal(scroll.x, metricsContent.x);
  assert.equal(scroll.width, metricsContent.width);
  assert.ok(scroll.y >= metricsContent.y);
  assert.ok(
    scroll.y + scroll.height <= metricsContent.y + metricsContent.height + 1
  );
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
  const runbook = monitorLayout('runbook');
  const runbookContent = monitorContentRegion(runbook, 0);
  assert.equal(
    rightPanelPrimaryTabAt(runbookContent.x + 20, runbookContent.y + 20, null),
    'runbook'
  );
  assert.equal(
    rightPanelPrimaryTabAt(runbookContent.x + 130, runbookContent.y + 20, null),
    'chat'
  );
  assert.equal(
    rightPanelPrimaryTabAt(
      runbookContent.x + 20,
      runbookContent.y + 20,
      'terminal'
    ),
    null
  );
  assert.equal(rightPanelPrimaryTabAt(310, 120, 'runbook'), 'runbook');
});

test('runbookTabAt resolves document tabs and ignores non-runbook panels', () => {
  const tabRow = runbookTabRegion();
  const y = tabRow.y + 12;
  assert.equal(runbookTabAt(tabRow.x + 10, y, 2, ['First', 'Second']), 0);
  assert.equal(
    runbookTabAt(tabRow.x + measureRunbookTabWidth('First') + 10, y, 2, [
      'First',
      'Second',
    ]),
    1
  );
  assert.equal(
    runbookTabAt(tabRow.x + 10, y, 2, ['First', 'Second'], null, 'chat'),
    -1
  );
  assert.equal(runbookTabAt(tabRow.x + 10, y, 0, []), -1);
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

test('monitorMagnifyAt resolves the per-panel expand affordance', () => {
  for (const region of monitorMagnifyRegions) {
    assert.equal(
      monitorMagnifyAt(
        region.x + region.width / 2,
        region.y + region.height / 2
      ),
      region.id
    );
    // The magnify affordance must stay inside its own panel.
    const monitor = monitorLayout(region.id);
    assert.ok(
      region.x >= monitor.x &&
        region.x + region.width <= monitor.x + monitor.width
    );
    assert.ok(
      region.y >= monitor.y &&
        region.y + region.height <= monitor.y + monitor.height
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
  assert.ok(expandedMetrics.width > 496);

  const expandedEditor = centerEditorOverlayRegion(true);
  assert.ok(expandedEditor.width > 0);

  const expandedCompose = chatComposeRegion('chat', 'runbook');
  assert.equal(expandedCompose.width > 0, true);
  const expandedSend = chatSendButtonRegion('chat', 'runbook');
  assert.equal(expandedSend.width > 0, true);

  // Runbook document tabs stay hit-testable once the panel is expanded to
  // fill the modal overlay (a much larger, differently-scaled content box).
  const expandedContent = monitorContentRegion(
    expandedMonitorLayout,
    monitorHeaderHeight('runbook')
  );
  const expandedScale = Math.min(
    expandedContent.width / monitorContentWidth,
    expandedContent.height / monitorContentHeight
  );
  const expandedLayout = rightPanelLayout('runbook', true);
  const expandedTabPoint = {
    x: expandedContent.x + 10,
    y: expandedContent.y + expandedLayout.secondaryTop * expandedScale + 10,
  };
  assert.equal(
    runbookTabAt(
      expandedTabPoint.x,
      expandedTabPoint.y,
      2,
      ['First', 'Second'],
      'runbook',
      'runbook'
    ),
    0
  );
  assert.equal(rightPanelPrimaryTabAt(310, 120, 'runbook'), 'runbook');
});
