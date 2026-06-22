import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  centerToolAt,
  centerToolTabRegions,
  measureRunbookTabWidth,
  monitorMagnifyAt,
  monitorMagnifyRegions,
  rightPanelPrimaryTabAt,
  runbookTabAt,
  slackComposeAt,
  slackComposeRegion,
  slackSendButtonRegion,
} from '../../apps/web/src/game/render/canvasLayout.ts';

test('measureRunbookTabWidth clamps text measurement to stable tab sizes', () => {
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
  assert.equal(rightPanelPrimaryTabAt(1450, 224, null), 'slack');
  assert.equal(rightPanelPrimaryTabAt(1340, 224, 'terminal'), null);
  assert.equal(rightPanelPrimaryTabAt(310, 120, 'runbook'), 'runbook');
});

test('runbookTabAt resolves document tabs and ignores non-runbook panels', () => {
  const y = 204 + 48 + 20;
  assert.equal(runbookTabAt(1340, y, 2, ['First', 'Second']), 0);
  assert.equal(runbookTabAt(1485, y, 2, ['First', 'Second']), 1);
  assert.equal(
    runbookTabAt(1340, y, 2, ['First', 'Second'], null, 'slack'),
    -1
  );
  assert.equal(runbookTabAt(1340, y, 0, []), -1);
});

test('slackComposeAt distinguishes compose box from send button', () => {
  const compose = slackComposeRegion('slack');
  assert.equal(
    slackComposeAt(compose.x + 20, compose.y + compose.height / 2, 'slack'),
    'compose'
  );

  const send = slackSendButtonRegion('slack');
  assert.equal(
    slackComposeAt(send.x + send.width / 2, send.y + send.height / 2, 'slack'),
    'send'
  );
  assert.equal(slackComposeAt(compose.x + 20, compose.y + 20, 'runbook'), null);
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
