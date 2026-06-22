import type {CanvasRenderSurface} from './canvasRenderSurface.js';
import {drawCoverImage, drawMagnifyIcon, roundRect} from './canvasDrawUtils.js';
import {gamePalette as palette, monoFont} from './gamePalette.js';
import {
  logicalHeight,
  logicalWidth,
  monitorLayouts,
  monitorMagnifyRegions,
  monitorContentWidth,
  monitorContentHeight,
  type MonitorId,
} from './canvasLayout.js';

const monitorPoses: Record<MonitorId, {scaleX: number}> = {
  metrics: {scaleX: 0.958},
  terminal: {scaleX: 1},
  runbook: {scaleX: 0.958},
};

export function drawRoom(surface: CanvasRenderSurface) {
  surface.ctx.fillStyle = palette.bgRoomBottom;
  surface.ctx.fillRect(0, 0, logicalWidth, logicalHeight);

  if (surface.roomBackdropLoaded) {
    drawCoverImage(surface.ctx, surface.roomBackdrop, 0, 0, logicalWidth, 840);
    surface.ctx.fillStyle = 'rgba(5, 6, 9, 0.38)';
    surface.ctx.fillRect(0, 0, logicalWidth, 840);
  } else {
    surface.ctx.fillStyle = palette.bgRoomTop;
    surface.ctx.fillRect(0, 0, logicalWidth, 840);
  }

  surface.ctx.fillStyle = palette.bgDesk;
  surface.ctx.fillRect(0, 840, logicalWidth, 240);
  surface.ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
  surface.ctx.fillRect(0, 838, logicalWidth, 2);
}

export function drawMonitorFrame(
  surface: CanvasRenderSurface,
  x: number,
  y: number,
  width: number,
  height: number,
  title: string,
  options: {stand?: boolean} = {}
) {
  if (options.stand ?? true) {
    drawMonitorStand(surface, x, y, width, height);
  }

  surface.ctx.fillStyle = palette.bgMonitor;
  roundRect(surface.ctx, x - 16, y - 16, width + 32, height + 32, 8);
  surface.ctx.fill();
  surface.ctx.fillStyle = palette.bgTerminal;
  roundRect(surface.ctx, x, y, width, height, 6);
  surface.ctx.fill();
  surface.ctx.strokeStyle = palette.borderMuted;
  surface.ctx.lineWidth = 2;
  surface.ctx.stroke();
  surface.ctx.fillStyle = palette.textLink;
  surface.ctx.font = monoFont(18);
  surface.ctx.fillText(title, x + 22, y + 36);
}

export function drawMonitorStand(
  surface: CanvasRenderSurface,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const frameBottom = y + height + 16;
  const centerX = x + width / 2;
  const postWidth = 34;
  const postHeight = 54;
  const postTop = frameBottom - 1;
  const baseTop = postTop + postHeight - 3;
  const baseWidth = 164;
  const baseHeight = 18;

  surface.ctx.save();

  surface.ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  roundRect(
    surface.ctx,
    centerX - baseWidth / 2 + 12,
    baseTop + 10,
    baseWidth - 24,
    10,
    5
  );
  surface.ctx.fill();

  surface.ctx.fillStyle = palette.bgMonitor;
  roundRect(
    surface.ctx,
    centerX - postWidth / 2,
    postTop,
    postWidth,
    postHeight,
    3
  );
  surface.ctx.fill();
  surface.ctx.strokeStyle = palette.borderMuted;
  surface.ctx.lineWidth = 2;
  surface.ctx.stroke();

  surface.ctx.fillStyle = palette.bgMonitor;
  roundRect(
    surface.ctx,
    centerX - baseWidth / 2,
    baseTop,
    baseWidth,
    baseHeight,
    4
  );
  surface.ctx.fill();
  surface.ctx.strokeStyle = palette.borderMuted;
  surface.ctx.lineWidth = 2;
  surface.ctx.stroke();

  surface.ctx.restore();
}

export function withMonitorPose(
  surface: CanvasRenderSurface,
  monitor: (typeof monitorLayouts)[number],
  draw: () => void
) {
  const pose = monitorPoses[monitor.id];
  if (pose.scaleX === 1) {
    draw();
    return;
  }

  const centerX = monitor.x + monitor.width / 2;
  const centerY = monitor.y + monitor.height / 2 + 36;
  surface.ctx.save();
  surface.ctx.translate(centerX, centerY);
  surface.ctx.scale(pose.scaleX, 1);
  surface.ctx.translate(-centerX, -centerY);
  draw();
  surface.ctx.restore();
}

export function drawMonitor(
  surface: CanvasRenderSurface,
  x: number,
  y: number,
  width: number,
  height: number,
  _title: string,
  drawContent: (content: {width: number; height: number}) => void,
  options: {contentScale?: number} = {}
) {
  const contentX = x + 22;
  const contentY = y + 64;
  const contentWidth = width - 44;
  const contentHeight = height - 80;
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
  for (const monitor of monitorLayouts) {
    const region = monitorMagnifyRegions.find((item) => item.id === monitor.id);
    if (!region) continue;
    withMonitorPose(surface, monitor, () => {
      drawMagnifyIcon(surface.ctx, region.x + 10, region.y + 10, 24);
    });
  }
}
