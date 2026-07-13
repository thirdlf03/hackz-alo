import type {GameRenderState} from '@incident/shared';
import type {CanvasRenderSurface} from './canvasRenderSurface.js';
import type {CanvasViewModel} from './canvasViewModel.js';
import {roundRect, wrapText} from './canvasDrawUtils.js';
import {
  gamePalette as palette,
  severityColor,
  uiFont,
  monoFont,
} from './gamePalette.js';
import {
  notificationBellRegion,
  notificationPanelRegion,
} from './canvasLayout.js';

export function drawNotifications(
  surface: CanvasRenderSurface,
  state: GameRenderState,
  viewModel: CanvasViewModel
) {
  const unread = viewModel.unreadNotificationCount;
  const bell = notificationBellRegion;
  const pulsing = state.notifications.pulseMs > 0;

  if (pulsing) {
    const ringOpacity = Math.min(0.55, state.notifications.pulseMs / 2400);
    surface.ctx.strokeStyle = `rgba(248, 113, 113, ${String(ringOpacity)})`;
    surface.ctx.lineWidth = 3;
    surface.ctx.beginPath();
    surface.ctx.arc(
      bell.x + bell.width / 2,
      bell.y + bell.height / 2,
      bell.width * 0.62,
      0,
      Math.PI * 2
    );
    surface.ctx.stroke();
  }

  surface.ctx.fillStyle = pulsing ? palette.bgButtonDanger : palette.bgCard;
  roundRect(surface.ctx, bell.x, bell.y, bell.width, bell.height, 10);
  surface.ctx.fill();
  surface.ctx.strokeStyle =
    unread > 0 ? palette.borderUnread : palette.textMuted;
  surface.ctx.lineWidth = 2;
  surface.ctx.stroke();

  drawBellGlyph(
    surface,
    bell.x + bell.width / 2,
    bell.y + bell.height / 2 - 2,
    unread > 0 || pulsing
  );

  if (unread > 0) {
    const badge = String(Math.min(unread, 9));
    const badgeWidth = badge.length > 1 ? 28 : 22;
    surface.ctx.fillStyle = palette.statusCritical;
    roundRect(
      surface.ctx,
      bell.x + bell.width - badgeWidth + 4,
      bell.y - 4,
      badgeWidth,
      22,
      11
    );
    surface.ctx.fill();
    surface.ctx.fillStyle = palette.textBadge;
    surface.ctx.font = uiFont(14, 'bold');
    surface.ctx.fillText(
      badge,
      bell.x + bell.width - badgeWidth + 11,
      bell.y + 12
    );
  }

  if (state.notifications.panelOpen) {
    drawNotificationPanel(surface, state, viewModel);
  }
}

export function drawBellGlyph(
  surface: CanvasRenderSurface,
  cx: number,
  cy: number,
  active: boolean
) {
  surface.ctx.save();
  surface.ctx.translate(cx, cy);
  surface.ctx.fillStyle = active
    ? palette.textWarningFg
    : palette.textSecondary;
  surface.ctx.strokeStyle = active
    ? palette.textWarningFg
    : palette.textSecondary;
  surface.ctx.lineWidth = 2;
  surface.ctx.beginPath();
  surface.ctx.moveTo(-14, 4);
  surface.ctx.quadraticCurveTo(-14, -16, 0, -18);
  surface.ctx.quadraticCurveTo(14, -16, 14, 4);
  surface.ctx.lineTo(16, 8);
  surface.ctx.lineTo(-16, 8);
  surface.ctx.closePath();
  surface.ctx.fill();
  surface.ctx.beginPath();
  surface.ctx.arc(0, 12, 4, 0, Math.PI * 2);
  surface.ctx.fill();
  surface.ctx.restore();
}

export function drawNotificationPanel(
  surface: CanvasRenderSurface,
  state: GameRenderState,
  viewModel: CanvasViewModel
) {
  const panel = notificationPanelRegion;
  surface.ctx.fillStyle = palette.bgOverlay;
  roundRect(surface.ctx, panel.x, panel.y, panel.width, panel.height, 12);
  surface.ctx.fill();
  surface.ctx.strokeStyle = palette.borderDefault;
  surface.ctx.lineWidth = 2;
  surface.ctx.stroke();

  surface.ctx.fillStyle = palette.textPrimary;
  surface.ctx.font = uiFont(18);
  surface.ctx.fillText('通知', panel.x + 18, panel.y + 30);
  surface.ctx.fillStyle = palette.textSecondary;
  surface.ctx.font = uiFont(14);
  surface.ctx.fillText('障害アラート / チャット', panel.x + 18, panel.y + 50);

  const items = viewModel.notificationPanelItems;

  if (items.length === 0) {
    surface.ctx.fillStyle = palette.textMuted;
    surface.ctx.font = uiFont(16);
    surface.ctx.fillText('通知はまだありません', panel.x + 18, panel.y + 90);
    return;
  }

  let y = panel.y + 72;
  for (const item of items.slice(0, 7)) {
    if (item.kind === 'alert') {
      const unread = item.unread;
      const color = severityColor(item.alert.severity);
      surface.ctx.fillStyle = unread ? palette.bgCard : palette.bgCardDark;
      roundRect(surface.ctx, panel.x + 12, y, panel.width - 24, 54, 8);
      surface.ctx.fill();
      if (unread) {
        surface.ctx.strokeStyle = color;
        surface.ctx.lineWidth = 2;
        surface.ctx.stroke();
      }
      surface.ctx.fillStyle = color;
      surface.ctx.beginPath();
      surface.ctx.arc(panel.x + 26, y + 27, 5, 0, Math.PI * 2);
      surface.ctx.fill();
      surface.ctx.fillStyle = palette.textPrimary;
      surface.ctx.font = monoFont(14, 'bold');
      surface.ctx.fillText(
        item.alert.severity.toUpperCase(),
        panel.x + 40,
        y + 22
      );
      surface.ctx.fillStyle = palette.textSecondary;
      surface.ctx.font = uiFont(14);
      wrapText(
        surface.ctx,
        item.alert.message,
        panel.x + 40,
        y + 40,
        panel.width - 56,
        18,
        2
      );
      y += 62;
      continue;
    }

    const unread = item.unread;
    surface.ctx.fillStyle = unread ? palette.bgCard : palette.bgCardDark;
    roundRect(surface.ctx, panel.x + 12, y, panel.width - 24, 54, 8);
    surface.ctx.fill();
    if (unread) {
      surface.ctx.strokeStyle = palette.textLink;
      surface.ctx.lineWidth = 2;
      surface.ctx.stroke();
    }
    surface.ctx.fillStyle = palette.textLink;
    surface.ctx.beginPath();
    surface.ctx.arc(panel.x + 26, y + 27, 5, 0, Math.PI * 2);
    surface.ctx.fill();
    surface.ctx.fillStyle = palette.textPrimary;
    surface.ctx.font = monoFont(14, 'bold');
    surface.ctx.fillText('チャット', panel.x + 40, y + 22);
    surface.ctx.fillStyle = palette.textSecondary;
    surface.ctx.font = uiFont(14);
    wrapText(
      surface.ctx,
      `${item.message.from}: ${item.message.body}`,
      panel.x + 40,
      y + 40,
      panel.width - 56,
      18,
      2
    );
    y += 62;
  }
}
