import type {GameRenderState} from '@incident/shared';
import type {CanvasRenderSurface} from './canvasRenderSurface.js';
import {
  centeredText,
  extractTypedCommand,
  inputCaretX,
  roundRect,
  truncateToWidth,
  wrapText,
  formatDifficulty,
  formatNarrativeClock,
  formatRecordingStatus,
  formatTime,
} from './canvasDrawUtils.js';
import {
  gamePalette as palette,
  uiFont,
  monoFont,
  displayFont,
} from './gamePalette.js';
import {canOperateSandbox} from '../../pure/rolePermissions.js';
import {participantColorIndex} from '../../pure/participantColor.js';
import {
  alertBandRect,
  commandWarningRect,
  inputDockRects,
  logicalHeight,
  logicalWidth,
  retireConfirmButtonRects,
  retireConfirmOverlayRect,
} from './canvasLayout.js';

export function drawHeader(
  surface: CanvasRenderSurface,
  state: GameRenderState
) {
  surface.ctx.fillStyle = palette.textPrimary;
  surface.ctx.font = uiFont(32);
  surface.ctx.fillText(state.session.scenarioTitle, 70, 70);
  surface.ctx.font = uiFont(24);
  surface.ctx.fillStyle = palette.textSecondary;
  surface.ctx.fillText(
    `${formatDifficulty(state.session.difficulty)} / ${formatTime(state.clock.elapsedMs)} / ${formatTime(state.clock.timeLimitMs)} / ${String(state.clock.speed)}x`,
    70,
    108
  );
  surface.ctx.fillStyle = palette.textClock;
  surface.ctx.font = monoFont(26, 'bold');
  surface.ctx.fillText(
    formatNarrativeClock(state.world.narrativeHour),
    1280,
    70
  );
  surface.ctx.fillStyle = state.recording.saveEnabled
    ? state.recording.status === 'recording'
      ? palette.statusRecording
      : palette.textMuted
    : palette.textMuted;
  surface.ctx.beginPath();
  surface.ctx.arc(1770, 70, 12, 0, Math.PI * 2);
  surface.ctx.fill();
  surface.ctx.fillStyle = palette.textPrimary;
  surface.ctx.font = uiFont(24);
  surface.ctx.fillText(
    formatRecordingStatus(state.recording.status, state.recording.saveEnabled),
    1792,
    78
  );
}

/** The single, unmissable incident banner at the top of the play area,
 * matching the 6a-5 mock's solid-red "!! 障害発生" bar exactly. Once recovery
 * is confirmed, the bar switches to the game's existing green tone (same as
 * drawRecoveryStatus()'s "全条件達成" line) to read as "復旧確認済み" instead
 * of a still-active incident, while keeping the original alert message
 * visible for context. Two sources feed "recovered", ORed together:
 * state.recoveryConfirmedAtMs (the server-confirmed value, shared across
 * participants and restored on reconnect/mid-join via invite-link join or
 * SSE resubscribe — see StoredSession.recoveryConfirmedAtMs) and
 * state.recovery.lastCheck.allOk (this tab's own client-local dry-run
 * check, for instant feedback before the SSE round-trip lands). */
export function drawAlerts(
  surface: CanvasRenderSurface,
  state: GameRenderState
) {
  const alert =
    state.monitors.left.alerts[state.monitors.left.alerts.length - 1];
  if (!alert) return;
  const ctx = surface.ctx;
  const box = alertBandRect;
  const midY = box.y + box.height / 2 + 7;
  const recovered =
    state.recoveryConfirmedAtMs !== undefined ||
    state.recovery?.lastCheck?.allOk === true;

  ctx.fillStyle = recovered ? palette.accentGreen : palette.borderDanger;
  roundRect(ctx, box.x, box.y, box.width, box.height, 3);
  ctx.fill();

  ctx.fillStyle = recovered
    ? palette.textOnAccent
    : palette.textOnDangerStrong;
  ctx.font = displayFont(19);
  const label = recovered ? '復旧確認済み' : '!! 障害発生';
  ctx.fillText(label, box.x + 18, midY);
  const labelWidth = ctx.measureText(label).width;

  const messageX = box.x + 18 + labelWidth + 16;
  const messageMaxWidth = box.x + box.width - 18 - messageX;
  ctx.fillStyle = recovered ? palette.textOnAccent : palette.textOnDangerBody;
  ctx.font = monoFont(16, 'bold');
  ctx.fillText(
    truncateToWidth(ctx, alert.message, Math.max(40, messageMaxWidth)),
    messageX,
    midY
  );
}

export function drawInputDock(
  surface: CanvasRenderSurface,
  state: GameRenderState
) {
  const input = inputDockRects.input;
  const button = inputDockRects.button;
  const enabled = state.session.status === 'running';
  const sandboxAllowed = canOperateSandbox(
    state.room.participants,
    state.localParticipantId
  );
  const inputEnabled = enabled && sandboxAllowed;
  const focused = state.commandInputFocused && sandboxAllowed;
  const typed = extractTypedCommand(
    state.monitors.center.terminal.commandDraft
  );
  const caretVisible =
    inputEnabled && focused && Math.floor(performance.now() / 530) % 2 === 0;
  const recovery = state.recovery;
  const checking = recovery?.checking ?? false;
  const allOk = recovery?.lastCheck?.allOk === true;

  surface.ctx.fillStyle = palette.bgPanelDark;
  surface.ctx.fillRect(0, 906, logicalWidth, 174);

  drawRecoveryStatus(surface, recovery);

  surface.ctx.fillStyle = palette.bgTerminal;
  roundRect(surface.ctx, input.x, input.y, input.width, input.height, 8);
  surface.ctx.fill();
  surface.ctx.strokeStyle =
    inputEnabled && focused
      ? palette.borderFocus
      : inputEnabled
        ? palette.borderDefault
        : palette.bgCard;
  surface.ctx.lineWidth = 2;
  surface.ctx.stroke();

  const inputTextY = input.y + Math.round(input.height / 2) + 8;
  surface.ctx.font = monoFont(22);
  const textStartX = input.x + 20;
  if (typed && sandboxAllowed) {
    surface.ctx.fillStyle = palette.textTerminal;
    surface.ctx.fillText(typed, textStartX, inputTextY);
  } else if (!focused) {
    surface.ctx.fillStyle = palette.textMuted;
    surface.ctx.fillText(
      !sandboxAllowed
        ? 'ターミナル操作は Ops / Facilitator のみ'
        : enabled
          ? 'コマンドを入力…'
          : 'セッション開始後に入力できます',
      textStartX,
      inputTextY
    );
  }
  if (caretVisible) {
    const caretX = typed
      ? inputCaretX(surface.ctx, typed, textStartX)
      : textStartX;
    surface.ctx.fillStyle = palette.textTerminal;
    surface.ctx.fillRect(caretX, inputTextY - 20, 2, 24);
  }

  surface.ctx.fillStyle =
    checking || !enabled ? palette.bgCardDark : palette.bgInput;
  roundRect(surface.ctx, button.x, button.y, button.width, button.height, 8);
  surface.ctx.fill();
  surface.ctx.strokeStyle = palette.borderDefault;
  surface.ctx.lineWidth = 2;
  surface.ctx.stroke();
  surface.ctx.fillStyle =
    checking || !enabled ? palette.textSecondary : palette.textPrimary;
  surface.ctx.font = uiFont(18);
  centeredText(
    surface.ctx,
    checking ? '確認中…' : '復旧状態を確認',
    button.x,
    button.y + 2,
    button.width,
    button.height
  );

  if (allOk) {
    const trainComplete = inputDockRects.trainComplete;
    surface.ctx.fillStyle = enabled
      ? palette.bgButtonPrimary
      : palette.bgCardDark;
    roundRect(
      surface.ctx,
      trainComplete.x,
      trainComplete.y,
      trainComplete.width,
      trainComplete.height,
      8
    );
    surface.ctx.fill();
    surface.ctx.strokeStyle = palette.borderFocus;
    surface.ctx.lineWidth = 2;
    surface.ctx.stroke();
    surface.ctx.fillStyle = enabled
      ? palette.textOnPrimary
      : palette.textSecondary;
    surface.ctx.font = uiFont(20);
    centeredText(
      surface.ctx,
      '訓練を完了',
      trainComplete.x,
      trainComplete.y + 2,
      trainComplete.width,
      trainComplete.height
    );
  }

  const retire = inputDockRects.retire;
  surface.ctx.fillStyle = enabled
    ? palette.bgButtonDanger
    : palette.bgButtonDangerDisabled;
  roundRect(surface.ctx, retire.x, retire.y, retire.width, retire.height, 8);
  surface.ctx.fill();
  surface.ctx.strokeStyle = palette.borderDanger;
  surface.ctx.lineWidth = 2;
  surface.ctx.stroke();
  surface.ctx.fillStyle = enabled
    ? palette.textWarningFg
    : palette.textSecondary;
  surface.ctx.font = uiFont(22);
  centeredText(
    surface.ctx,
    'リタイア',
    retire.x,
    retire.y + 2,
    retire.width,
    retire.height
  );
}

/** Renders the recovery-check result line(s) in the band above the input
 * dock's button row. Silent (draws nothing) until a check has been
 * requested at least once. */
function drawRecoveryStatus(
  surface: CanvasRenderSurface,
  recovery: GameRenderState['recovery']
) {
  if (!recovery || (!recovery.checking && !recovery.lastCheck)) return;
  const ctx = surface.ctx;
  const x = inputDockRects.input.x;
  const maxWidth =
    inputDockRects.trainComplete.x + inputDockRects.trainComplete.width - x;
  const topY = 918;
  const lineHeight = 18;

  if (recovery.checking) {
    ctx.fillStyle = palette.textMuted;
    ctx.font = uiFont(16);
    ctx.fillText('確認中…', x, topY);
    return;
  }

  const lastCheck = recovery.lastCheck;
  if (!lastCheck) return;

  if (lastCheck.error) {
    ctx.fillStyle = palette.textWarning;
    ctx.font = uiFont(16, 'bold');
    ctx.fillText('確認できませんでした。再試行してください', x, topY);
    return;
  }

  if (!lastCheck.declarable) {
    ctx.fillStyle = palette.textWarning;
    ctx.font = uiFont(16, 'bold');
    ctx.fillText('まだ復旧宣言できる段階ではありません', x, topY);
    return;
  }

  if (lastCheck.allOk) {
    ctx.fillStyle = palette.statusHealthy;
    ctx.font = uiFont(18, 'bold');
    ctx.fillText('全条件達成 —「訓練を完了」を押せます', x, topY);
    return;
  }

  const failing = lastCheck.checks.filter((check) => !check.ok);
  const visible = failing.slice(0, 2);
  ctx.fillStyle = palette.textWarning;
  ctx.font = uiFont(16, 'bold');
  ctx.fillText(
    failing.length > visible.length
      ? `未達条件 ${String(failing.length)} 件(先頭${String(visible.length)}件を表示)`
      : `未達条件 ${String(failing.length)} 件`,
    x,
    topY
  );

  ctx.font = monoFont(15);
  ctx.fillStyle = palette.textSecondary;
  for (const [index, check] of visible.entries()) {
    ctx.fillText(
      `・${truncateToWidth(ctx, check.label, maxWidth - 20)}`,
      x,
      topY + lineHeight * (index + 1)
    );
  }
}

/** Full-screen confirmation modal shown while retiring, so a misclick on
 * the danger-styled リタイア button can't end the session outright. */
export function drawRetireConfirmOverlay(surface: CanvasRenderSurface) {
  const ctx = surface.ctx;
  ctx.fillStyle = palette.bgOverlayLight;
  ctx.fillRect(0, 0, logicalWidth, logicalHeight);

  const box = retireConfirmOverlayRect;
  ctx.fillStyle = palette.bgOverlay;
  roundRect(ctx, box.x, box.y, box.width, box.height, 12);
  ctx.fill();
  ctx.strokeStyle = palette.borderDanger;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = palette.textPrimary;
  ctx.font = uiFont(24, 'bold');
  ctx.fillText('本当にリタイアしますか?', box.x + 32, box.y + 56);
  ctx.fillStyle = palette.textSecondary;
  ctx.font = uiFont(16);
  wrapText(
    ctx,
    '途中でやめると、この訓練は失敗として記録されます。',
    box.x + 32,
    box.y + 96,
    box.width - 64,
    24,
    2
  );

  const confirm = retireConfirmButtonRects.confirm;
  ctx.fillStyle = palette.bgButtonDanger;
  roundRect(ctx, confirm.x, confirm.y, confirm.width, confirm.height, 8);
  ctx.fill();
  ctx.strokeStyle = palette.borderDanger;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = palette.textWarningFg;
  ctx.font = uiFont(18, 'bold');
  centeredText(
    ctx,
    'リタイアする',
    confirm.x,
    confirm.y + 2,
    confirm.width,
    confirm.height
  );

  const cancel = retireConfirmButtonRects.cancel;
  ctx.fillStyle = palette.bgInput;
  roundRect(ctx, cancel.x, cancel.y, cancel.width, cancel.height, 8);
  ctx.fill();
  ctx.strokeStyle = palette.borderDefault;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = palette.textPrimary;
  ctx.font = uiFont(18, 'bold');
  centeredText(
    ctx,
    '続ける',
    cancel.x,
    cancel.y + 2,
    cancel.width,
    cancel.height
  );
}

const remoteCursorDisplay = new Map<string, {x: number; y: number}>();
const REMOTE_CURSOR_LERP = 0.32;
const REMOTE_CURSOR_SNAP_PX = 400;

export function drawCursor(
  surface: CanvasRenderSurface,
  state: GameRenderState
) {
  drawParticipantCursors(surface, state);
  if (!state.cursor.visible) return;
  surface.ctx.fillStyle = palette.textPrimary;
  surface.ctx.beginPath();
  surface.ctx.moveTo(state.cursor.x, state.cursor.y);
  surface.ctx.lineTo(state.cursor.x + 20, state.cursor.y + 44);
  surface.ctx.lineTo(state.cursor.x + 32, state.cursor.y + 28);
  surface.ctx.closePath();
  surface.ctx.fill();
}

function drawParticipantCursors(
  surface: CanvasRenderSurface,
  state: GameRenderState
) {
  const colors = [
    palette.accentCyan,
    palette.accentGreen,
    palette.accentPurple,
    palette.accentPink,
    palette.textClock,
  ];
  const presentIds = new Set<string>();
  state.room.participants.forEach((participant) => {
    if (participant.participantId === state.localParticipantId) return;
    if (!participant.cursor?.visible || !participant.online) return;
    presentIds.add(participant.participantId);
    const color =
      colors[participantColorIndex(participant.participantId, colors.length)] ??
      palette.accentCyan;
    const target = participant.cursor;
    const previous = remoteCursorDisplay.get(participant.participantId);
    let x = target.x;
    let y = target.y;
    if (previous) {
      const dx = target.x - previous.x;
      const dy = target.y - previous.y;
      if (dx * dx + dy * dy > REMOTE_CURSOR_SNAP_PX * REMOTE_CURSOR_SNAP_PX) {
        x = target.x;
        y = target.y;
      } else {
        x = previous.x + dx * REMOTE_CURSOR_LERP;
        y = previous.y + dy * REMOTE_CURSOR_LERP;
      }
    }
    remoteCursorDisplay.set(participant.participantId, {x, y});
    surface.ctx.save();
    surface.ctx.globalAlpha = 0.82;
    surface.ctx.fillStyle = color;
    surface.ctx.beginPath();
    surface.ctx.moveTo(x, y);
    surface.ctx.lineTo(x + 14, y + 30);
    surface.ctx.lineTo(x + 24, y + 20);
    surface.ctx.closePath();
    surface.ctx.fill();
    surface.ctx.font = uiFont(14, 'bold');
    surface.ctx.fillText(participant.displayName, x + 16, y + 18);
    surface.ctx.restore();
  });
  for (const id of remoteCursorDisplay.keys()) {
    if (!presentIds.has(id)) remoteCursorDisplay.delete(id);
  }
}

export function drawCommandWarning(
  surface: CanvasRenderSurface,
  warning: {message: string; flashMs: number}
) {
  const opacity = Math.min(1, warning.flashMs / 800);
  const box = commandWarningRect;
  surface.ctx.fillStyle = `rgba(127, 29, 29, ${String(0.92 * opacity)})`;
  roundRect(surface.ctx, box.x, box.y, box.width, box.height, 8);
  surface.ctx.fill();
  surface.ctx.strokeStyle = `rgba(248, 113, 113, ${String(opacity)})`;
  surface.ctx.lineWidth = 2;
  surface.ctx.stroke();
  surface.ctx.fillStyle = `rgba(254, 226, 226, ${String(opacity)})`;
  surface.ctx.font = uiFont(20, 'bold');
  surface.ctx.fillText(warning.message, box.x + 16, box.y + 34);
}
