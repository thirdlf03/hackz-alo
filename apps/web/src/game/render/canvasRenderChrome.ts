import type {GameRenderState, ScenarioDefinition} from '@incident/shared';
import type {CanvasRenderSurface} from './canvasRenderSurface.js';
import {
  centeredText,
  extractTypedCommand,
  inputCaretX,
  roundRect,
  wrapText,
  formatDifficulty,
  formatNarrativeClock,
  formatRecordingStatus,
  formatTime,
} from './canvasDrawUtils.js';
import {gamePalette as palette, uiFont, monoFont} from './gamePalette.js';
import {
  inputDockRects,
  logicalWidth,
  navigationOverlayRect,
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

export function drawAlerts(
  surface: CanvasRenderSurface,
  state: GameRenderState
) {
  const alert =
    state.monitors.left.alerts[state.monitors.left.alerts.length - 1];
  if (!alert) return;
  surface.ctx.fillStyle = 'rgba(239, 68, 68, 0.92)';
  roundRect(surface.ctx, 70, 778, 1780, 48, 8);
  surface.ctx.fill();
  surface.ctx.fillStyle = palette.textBadge;
  surface.ctx.font = uiFont(22);
  surface.ctx.fillText(alert.message, 104, 808);
}

export function drawInputDock(
  surface: CanvasRenderSurface,
  state: GameRenderState
) {
  const input = inputDockRects.input;
  const button = inputDockRects.button;
  const enabled = state.session.status === 'running';
  const focused = state.commandInputFocused;
  const typed = extractTypedCommand(
    state.monitors.center.terminal.commandDraft
  );
  const caretVisible =
    enabled && focused && Math.floor(performance.now() / 530) % 2 === 0;

  surface.ctx.fillStyle = palette.bgPanelDark;
  surface.ctx.fillRect(0, 850, logicalWidth, 170);

  surface.ctx.fillStyle = palette.textMuted;
  surface.ctx.font = monoFont(14);
  surface.ctx.fillText('INPUT', input.x, input.y - 10);

  surface.ctx.fillStyle = palette.bgTerminal;
  roundRect(surface.ctx, input.x, input.y, input.width, input.height, 8);
  surface.ctx.fill();
  surface.ctx.strokeStyle =
    enabled && focused
      ? palette.borderFocus
      : enabled
        ? palette.borderDefault
        : palette.bgCard;
  surface.ctx.lineWidth = 2;
  surface.ctx.stroke();

  const inputTextY = input.y + Math.round(input.height / 2) + 8;
  surface.ctx.font = monoFont(22);
  const textStartX = input.x + 20;
  if (typed) {
    surface.ctx.fillStyle = palette.textTerminal;
    surface.ctx.fillText(typed, textStartX, inputTextY);
  } else if (!focused) {
    surface.ctx.fillStyle = palette.textMuted;
    surface.ctx.fillText(
      enabled ? 'コマンドを入力…' : 'セッション開始後に入力できます',
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

  surface.ctx.fillStyle = enabled ? palette.bgInput : palette.bgCardDark;
  roundRect(surface.ctx, button.x, button.y, button.width, button.height, 8);
  surface.ctx.fill();
  surface.ctx.strokeStyle = palette.borderDefault;
  surface.ctx.lineWidth = 2;
  surface.ctx.stroke();
  surface.ctx.fillStyle = enabled ? palette.textPrimary : palette.textSecondary;
  surface.ctx.font = uiFont(24);
  centeredText(
    surface.ctx,
    '復旧完了',
    button.x,
    button.y + 2,
    button.width,
    button.height
  );

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

export function drawNavigationOverlay(
  surface: CanvasRenderSurface,
  state: GameRenderState,
  scenario?: ScenarioDefinition
) {
  const step = scenario?.navigationSteps?.find(
    (item) => item.id === state.navigation.activeStepId
  );
  if (!step || state.session.difficulty !== 'beginner') return;

  const box = navigationOverlayRect;
  surface.ctx.fillStyle = palette.bgOverlay;
  roundRect(surface.ctx, box.x, box.y, box.width, box.height, 10);
  surface.ctx.fill();
  surface.ctx.strokeStyle = palette.borderFocus;
  surface.ctx.lineWidth = 2;
  surface.ctx.stroke();
  surface.ctx.fillStyle = palette.borderFocus;
  surface.ctx.font = uiFont(14);
  surface.ctx.fillText('NAV', box.x + 16, box.y + 28);
  surface.ctx.fillStyle = palette.textPrimary;
  surface.ctx.font = uiFont(18);
  wrapText(
    surface.ctx,
    step.hint,
    box.x + 16,
    box.y + 52,
    box.width - 32,
    24,
    3
  );
  if (step.suggestedCommand) {
    surface.ctx.fillStyle = palette.textSecondary;
    surface.ctx.font = monoFont(14);
    surface.ctx.fillText(
      `例: ${step.suggestedCommand}`,
      box.x + 16,
      box.y + box.height - 24
    );
  }
}

export function drawCursor(
  surface: CanvasRenderSurface,
  state: GameRenderState
) {
  if (!state.cursor.visible) return;
  surface.ctx.fillStyle = palette.textPrimary;
  surface.ctx.beginPath();
  surface.ctx.moveTo(state.cursor.x, state.cursor.y);
  surface.ctx.lineTo(state.cursor.x + 20, state.cursor.y + 44);
  surface.ctx.lineTo(state.cursor.x + 32, state.cursor.y + 28);
  surface.ctx.closePath();
  surface.ctx.fill();
}

export function drawCommandWarning(
  surface: CanvasRenderSurface,
  warning: {message: string; flashMs: number}
) {
  const opacity = Math.min(1, warning.flashMs / 800);
  const box = {x: 70, y: 118, width: logicalWidth - 140, height: 52};
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
