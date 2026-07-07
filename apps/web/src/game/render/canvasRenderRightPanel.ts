import type {GameRenderState, RunbookDefinition} from '@incident/shared';
import type {CanvasRenderSurface} from './canvasRenderSurface.js';
import type {CanvasViewModel} from './canvasViewModel.js';
import {roundRect, wrapText} from './canvasDrawUtils.js';
import {gamePalette as palette, uiFont} from './gamePalette.js';
import {
  RIGHT_PANEL_PRIMARY_TAB_HEIGHT,
  RIGHT_PANEL_PRIMARY_TABS,
  RIGHT_PANEL_SECONDARY_TAB_HEIGHT,
  RUNBOOK_TAB_GAP,
  RUNBOOK_TAB_PAD_X,
  measureRunbookTabWidth,
  monitorContentHeight,
  rightPanelLayout,
} from './canvasLayout.js';

export function drawRightPanel(
  surface: CanvasRenderSurface,
  state: GameRenderState,
  viewModel: CanvasViewModel
) {
  const activePanelTab = state.monitors.right.activePanelTab;
  const runbooks = viewModel.visibleRunbooks;
  const layout = rightPanelLayout(activePanelTab, runbooks.length > 0);

  drawPrimaryPanelTabs(surface, state, layout.primaryTop, viewModel);

  if (activePanelTab === 'runbook') {
    drawRunbookDocumentTabs(surface, state, runbooks, layout.secondaryTop);
    const titleTop = layout.contentTop;
    const bodyTop = titleTop + 36;
    const maxRunbookLines = Math.max(
      10,
      Math.floor((monitorContentHeight - bodyTop - 16) / 24)
    );
    surface.ctx.fillStyle = palette.textPrimary;
    surface.ctx.font = uiFont(22);
    if (runbooks.length === 0) {
      surface.ctx.fillText('Runbook', 0, titleTop);
      surface.ctx.font = uiFont(17);
      wrapText(
        surface.ctx,
        'Runbook はまだ届いていない。',
        0,
        bodyTop,
        470,
        24,
        maxRunbookLines
      );
      return;
    }
    surface.ctx.fillText(
      state.monitors.right.activeRunbook?.title ?? 'Runbook',
      0,
      titleTop
    );
    surface.ctx.font = uiFont(17);
    wrapText(
      surface.ctx,
      state.monitors.right.activeRunbook?.body ?? '',
      0,
      bodyTop,
      470,
      24,
      maxRunbookLines
    );
    return;
  }

  surface.ctx.fillStyle = palette.textPrimary;
  surface.ctx.font = uiFont(20);
  surface.ctx.fillText('チャット', 0, layout.chatMessagesTop);
  surface.ctx.font = uiFont(16);
  const messageLineHeight = 22;
  const maxChatLines = Math.max(
    4,
    Math.floor(
      (layout.chatMessagesBottom - layout.chatMessagesTop - 24) /
        messageLineHeight
    )
  );
  let y = layout.chatMessagesTop + 30;
  let drawnLines = 0;
  for (const message of viewModel.recentChatMessages) {
    if (drawnLines >= maxChatLines) break;
    const prefix = message.from === 'あなた' ? '▸ ' : '';
    const color =
      message.from === 'あなた' ? palette.textLink : palette.textPrimary;
    surface.ctx.fillStyle = color;
    const nextY = wrapText(
      surface.ctx,
      `${prefix}${message.from}: ${message.body}`,
      0,
      y,
      470,
      messageLineHeight,
      3
    );
    drawnLines += Math.max(1, Math.round((nextY - y) / messageLineHeight));
    y = nextY + 8;
  }

  drawChatCompose(surface, state, layout.composeTop);
}

export function drawPrimaryPanelTabs(
  surface: CanvasRenderSurface,
  state: GameRenderState,
  top: number,
  viewModel: CanvasViewModel
) {
  const activePanelTab = state.monitors.right.activePanelTab;
  const unreadChat = viewModel.unreadChat;
  surface.ctx.font = uiFont(16);
  let tabX = 0;
  for (const tab of RIGHT_PANEL_PRIMARY_TABS) {
    const active = activePanelTab === tab.id;
    surface.ctx.fillStyle = active ? palette.bgCard : palette.bgCardActive;
    roundRect(
      surface.ctx,
      tabX,
      top,
      tab.width,
      RIGHT_PANEL_PRIMARY_TAB_HEIGHT,
      6
    );
    surface.ctx.fill();
    surface.ctx.fillStyle = active ? palette.textPrimary : palette.textMuted;
    surface.ctx.fillText(tab.label, tabX + RUNBOOK_TAB_PAD_X, top + 26);
    if (tab.id === 'chat' && unreadChat && !active) {
      surface.ctx.fillStyle = palette.statusCritical;
      surface.ctx.beginPath();
      surface.ctx.arc(tabX + tab.width - 12, top + 12, 5, 0, Math.PI * 2);
      surface.ctx.fill();
    }
    tabX += tab.width + RUNBOOK_TAB_GAP;
  }
}

export function drawRunbookDocumentTabs(
  surface: CanvasRenderSurface,
  state: GameRenderState,
  runbooks: RunbookDefinition[],
  top: number
) {
  surface.ctx.font = uiFont(16);
  let tabX = 0;
  for (let index = 0; index < runbooks.length; index += 1) {
    const runbook = runbooks[index];
    if (!runbook) continue;
    const active = index === state.monitors.right.activeRunbookIndex;
    const width = measureRunbookTabWidth(
      runbook.title,
      (title) => surface.ctx.measureText(title).width
    );
    surface.ctx.fillStyle = active ? palette.bgCard : palette.bgCardActive;
    roundRect(
      surface.ctx,
      tabX,
      top,
      width,
      RIGHT_PANEL_SECONDARY_TAB_HEIGHT,
      6
    );
    surface.ctx.fill();
    surface.ctx.fillStyle = active ? palette.textPrimary : palette.textMuted;
    surface.ctx.fillText(runbook.title, tabX + RUNBOOK_TAB_PAD_X, top + 26);
    tabX += width + RUNBOOK_TAB_GAP;
  }
}

export function drawChatCompose(
  surface: CanvasRenderSurface,
  state: GameRenderState,
  boxY = 484
) {
  const active = state.chatCompose.active;
  surface.ctx.fillStyle = active
    ? palette.bgDevtoolsActive
    : palette.bgDevtoolsIdle;
  roundRect(surface.ctx, 0, boxY, 470, 44, 6);
  surface.ctx.fill();
  surface.ctx.strokeStyle = active ? palette.accentBlue : palette.borderDefault;
  surface.ctx.lineWidth = 2;
  surface.ctx.stroke();

  surface.ctx.fillStyle = active ? palette.textLink : palette.textMuted;
  surface.ctx.font = uiFont(16);
  const draft = state.chatCompose.draft;
  const placeholder = '状況を報告... (クリックして入力)';
  const text = draft.length > 0 ? draft : placeholder;
  surface.ctx.fillText(text.slice(0, 42), 12, boxY + 28);

  if (active && draft.length > 0) {
    surface.ctx.fillStyle = palette.accentGreen;
    roundRect(surface.ctx, 404, boxY + 8, 56, 28, 4);
    surface.ctx.fill();
    surface.ctx.fillStyle = palette.accentGreenBg;
    surface.ctx.font = uiFont(14, 'bold');
    surface.ctx.fillText('送信', 416, boxY + 27);
  }
}
