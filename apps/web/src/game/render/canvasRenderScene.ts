import type {CanvasRenderSurface} from './canvasRenderSurface.js';
import {drawMagnifyIcon, roundRect} from './canvasDrawUtils.js';
import {gamePalette as palette} from './gamePalette.js';
import {
  logicalHeight,
  logicalWidth,
  monitorContentHeight,
  monitorContentWidth,
  monitorMagnifyRegions,
  PANEL_PADDING,
  type MonitorId,
} from './canvasLayout.js';

/** Per-panel chrome: background + border, matching the 6a-5 mock exactly
 * (TERMINAL is the "operable" panel and gets the brighter green border). */
const panelChrome: Record<MonitorId, {bg: string; border: string}> = {
  metrics: {bg: palette.bgPanel, border: palette.borderMuted},
  terminal: {bg: palette.bgTerminal, border: palette.borderDefault},
  runbook: {bg: palette.bgPanel, border: palette.borderMuted},
};

/** Flat scanline-tinted background behind every panel (no desk/room/perspective). */
export function drawScreenBackground(surface: CanvasRenderSurface) {
  surface.ctx.fillStyle = palette.bgRoomBottom;
  surface.ctx.fillRect(0, 0, logicalWidth, logicalHeight);
}

/** Draws a flat, bordered panel shell (background + 1px border + optional
 * header separator line). Panel-specific header content and body content are
 * drawn separately by the caller. */
export function drawFlatPanel(
  surface: CanvasRenderSurface,
  id: MonitorId,
  rect: {x: number; y: number; width: number; height: number},
  headerHeight: number
) {
  const chrome = panelChrome[id];
  surface.ctx.fillStyle = chrome.bg;
  roundRect(surface.ctx, rect.x, rect.y, rect.width, rect.height, 4);
  surface.ctx.fill();
  surface.ctx.strokeStyle = chrome.border;
  surface.ctx.lineWidth = 1;
  roundRect(
    surface.ctx,
    rect.x + 0.5,
    rect.y + 0.5,
    rect.width - 1,
    rect.height - 1,
    4
  );
  surface.ctx.stroke();

  if (headerHeight > 0) {
    surface.ctx.strokeStyle = palette.borderMuted;
    surface.ctx.lineWidth = 1;
    surface.ctx.beginPath();
    surface.ctx.moveTo(rect.x, rect.y + headerHeight + 0.5);
    surface.ctx.lineTo(rect.x + rect.width, rect.y + headerHeight + 0.5);
    surface.ctx.stroke();
  }
}

export function drawMonitor(
  surface: CanvasRenderSurface,
  x: number,
  y: number,
  width: number,
  height: number,
  headerHeight: number,
  drawContent: (content: {width: number; height: number}) => void,
  options: {contentScale?: number} = {}
) {
  const contentX = x + PANEL_PADDING;
  const contentY = y + headerHeight + PANEL_PADDING;
  const contentWidth = width - PANEL_PADDING * 2;
  const contentHeight = height - headerHeight - PANEL_PADDING * 2;
  const scale =
    options.contentScale ??
    Math.min(
      contentWidth / monitorContentWidth,
      contentHeight / monitorContentHeight
    );

  surface.ctx.save();
  surface.ctx.beginPath();
  surface.ctx.rect(contentX, contentY, contentWidth, contentHeight);
  surface.ctx.clip();
  surface.ctx.translate(contentX, contentY);
  if (scale !== 1) surface.ctx.scale(scale, scale);
  drawContent({width: contentWidth / scale, height: contentHeight / scale});
  surface.ctx.restore();
}

export function drawMonitorMagnifyIcons(surface: CanvasRenderSurface) {
  for (const region of monitorMagnifyRegions) {
    drawMagnifyIcon(surface.ctx, region.x + 4, region.y + 4, region.width - 8);
  }
}
