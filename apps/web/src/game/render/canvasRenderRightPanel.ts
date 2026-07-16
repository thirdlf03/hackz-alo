import type {
  GameRenderState,
  RunbookDefinition,
  RunbookStepStatus,
} from '@incident/shared';
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
import {
  layoutRunbookBody,
  RUNBOOK_BODY_LINE_HEIGHT,
  RUNBOOK_STEP_TEXT_INDENT,
  type RunbookBodyLayout,
} from './canvasRunbookStepLayout.js';

export function drawRightPanel(
  surface: CanvasRenderSurface,
  state: GameRenderState,
  viewModel: CanvasViewModel
) {
  const activePanelTab = state.monitors.right.activePanelTab;
  const runbooks = viewModel.visibleRunbooks;
  const layout = rightPanelLayout(activePanelTab, runbooks.length > 0);

  drawPrimaryPanelTabs(surface, state, layout.primaryTop, viewModel);
  surface.ctx.strokeStyle = palette.borderPanel;
  surface.ctx.lineWidth = 1;
  surface.ctx.beginPath();
  surface.ctx.moveTo(
    0,
    layout.primaryTop + RIGHT_PANEL_PRIMARY_TAB_HEIGHT + 10
  );
  surface.ctx.lineTo(
    470,
    layout.primaryTop + RIGHT_PANEL_PRIMARY_TAB_HEIGHT + 10
  );
  surface.ctx.stroke();

  if (activePanelTab === 'runbook') {
    drawRunbookDocumentTabs(surface, state, runbooks, layout.secondaryTop);
    const bodyTop = layout.contentTop;
    const maxRunbookLines = Math.max(
      10,
      Math.floor(
        (monitorContentHeight - bodyTop - 16) / RUNBOOK_BODY_LINE_HEIGHT
      )
    );
    surface.ctx.fillStyle = palette.textPrimary;
    surface.ctx.font = uiFont(17);
    const runbook = state.monitors.right.activeRunbook;
    if (runbooks.length === 0 || !runbook) {
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
    const bodyLayout = layoutRunbookBody(
      surface.ctx,
      runbook,
      state.runbookProgress,
      bodyTop,
      maxRunbookLines
    );
    paintRunbookBody(surface, bodyLayout);
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

/** Runbook 手順の状態ごとの表示記号。 */
const runbookStepMarkers: Record<RunbookStepStatus, string> = {
  pending: '·',
  current: '▸',
  done: '✓',
  failed: '!',
  skipped: '−',
};

function runbookStepMarkerColor(status: RunbookStepStatus): string {
  switch (status) {
    case 'current':
      return palette.textWarning;
    case 'done':
      return palette.statusHealthy;
    case 'failed':
      return palette.statusCritical;
    case 'pending':
    case 'skipped':
      return palette.textMuted;
  }
}

function runbookStepTextColor(status: RunbookStepStatus): string {
  switch (status) {
    case 'current':
      return palette.textWarning;
    case 'failed':
      return palette.statusCritical;
    case 'pending':
    case 'done':
    case 'skipped':
      return palette.textPrimary;
  }
}

/** layoutRunbookBody() が計算した前置きテキスト・手順一覧を描画する。
 * done/skipped は打ち消し線 + 減光、current はマーカー/文字色を強調し
 * 背景を軽くハイライトする。 */
function paintRunbookBody(
  surface: CanvasRenderSurface,
  body: RunbookBodyLayout
) {
  const ctx = surface.ctx;
  ctx.font = uiFont(17);
  ctx.fillStyle = palette.textPrimary;
  for (const line of body.preambleLines) {
    if (line.text) ctx.fillText(line.text, 0, line.y);
  }

  for (const row of body.rows) {
    if (row.status === 'current') {
      ctx.fillStyle = palette.bgCardActive;
      roundRect(ctx, -6, row.y, RUNBOOK_STEP_TEXT_INDENT + 452, row.height, 4);
      ctx.fill();
    }

    const dim = row.status === 'done' || row.status === 'skipped';
    ctx.save();
    ctx.globalAlpha = dim ? 0.55 : 1;
    ctx.font = row.status === 'current' ? uiFont(17, 'bold') : uiFont(17);

    ctx.fillStyle = runbookStepMarkerColor(row.status);
    ctx.fillText(runbookStepMarkers[row.status], 0, row.textY);

    const textColor = runbookStepTextColor(row.status);
    ctx.fillStyle = textColor;
    let lineY = row.textY;
    for (const line of row.lines) {
      ctx.fillText(line, RUNBOOK_STEP_TEXT_INDENT, lineY);
      if (dim) {
        const width = ctx.measureText(line).width;
        ctx.strokeStyle = textColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(RUNBOOK_STEP_TEXT_INDENT, lineY - 6);
        ctx.lineTo(RUNBOOK_STEP_TEXT_INDENT + width, lineY - 6);
        ctx.stroke();
      }
      lineY += RUNBOOK_BODY_LINE_HEIGHT;
    }
    ctx.restore();
  }
}
