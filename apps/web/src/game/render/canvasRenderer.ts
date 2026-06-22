import type {GameRenderState, ScenarioDefinition} from '@incident/shared';
import {clamp} from './canvasDrawUtils.js';
import {buildCanvasViewModel} from './canvasViewModel.js';
import {
  drawAlerts,
  drawCommandWarning,
  drawCursor,
  drawHeader,
  drawInputDock,
  drawNavigationOverlay,
} from './canvasRenderChrome.js';
import {
  drawCenterPanel,
  drawCenterToolTabs,
} from './canvasRenderCenterPanel.js';
import {drawRightPanel} from './canvasRenderRightPanel.js';
import {
  drawExpandedMonitorOverlay,
  drawMetricsPanelOnSurface,
} from './canvasRenderOverlay.js';
import {drawNotifications} from './canvasRenderNotifications.js';
import {
  drawMonitor,
  drawMonitorMagnifyIcons,
  drawMonitorFrame,
  drawRoom,
  withMonitorPose,
} from './canvasRenderScene.js';
import type {AnsiSpan} from '../terminal/ansi.js';
import type {CanvasRenderSurface} from './canvasRenderSurface.js';
import officeMonitorBackdropUrl from '../../assets/office-monitor-backdrop.avif';
import {logicalHeight, logicalWidth, monitorLayouts} from './canvasLayout.js';

export {
  centerEditorOverlayRegion,
  centerToolAt,
  centerToolTabRegions,
  containsCanvasPoint,
  expandedMonitorLayout,
  inputDockRects,
  measureRunbookTabWidth,
  metricsPanelScrollRegion,
  monitorLayouts,
  monitorMagnifyAt,
  navigationOverlayRect,
  notificationBellRegion,
  notificationPanelRegion,
  rightPanelPrimaryTabAt,
  runbookTabAt,
  runbookTabRegion,
  slackComposeAt,
  slackComposeRegion,
  slackSendButtonRegion,
  type MonitorId,
  type RightPanelTab,
} from './canvasLayout.js';

export class CanvasRenderer {
  private ctx: CanvasRenderingContext2D;
  private staticCanvas: HTMLCanvasElement;
  private staticCtx: CanvasRenderingContext2D;
  private roomBackdrop: HTMLImageElement;
  private roomBackdropLoaded = false;
  private lastRendered?: {
    state: GameRenderState;
    scenario?: ScenarioDefinition;
  };
  private terminalLineCache = new Map<
    string,
    {spans: AnsiSpan[]; plain: string}
  >();
  private metricsScrollY = 0;
  private metricsScrollMax = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d canvas is required');
    this.ctx = ctx;
    this.canvas.width = logicalWidth;
    this.canvas.height = logicalHeight;
    this.staticCanvas = document.createElement('canvas');
    this.staticCanvas.width = logicalWidth;
    this.staticCanvas.height = logicalHeight;
    const staticCtx = this.staticCanvas.getContext('2d');
    if (!staticCtx) throw new Error('2d canvas is required');
    this.staticCtx = staticCtx;
    this.roomBackdrop = new Image();
    this.roomBackdrop.onload = () => {
      this.roomBackdropLoaded = true;
      this.drawStaticLayer();
      if (this.lastRendered) {
        this.draw(this.lastRendered.state, this.lastRendered.scenario);
      }
    };
    this.roomBackdrop.src = officeMonitorBackdropUrl;
    this.drawStaticLayer();
  }

  private surface(ctx = this.ctx): CanvasRenderSurface {
    return {
      ctx,
      terminalLineCache: this.terminalLineCache,
      metricsScrollY: this.metricsScrollY,
      metricsScrollMax: this.metricsScrollMax,
      roomBackdrop: this.roomBackdrop,
      roomBackdropLoaded: this.roomBackdropLoaded,
    };
  }

  scrollMetricsPanel(deltaY: number) {
    if (this.metricsScrollMax <= 0) return false;
    const next = clamp(this.metricsScrollY + deltaY, 0, this.metricsScrollMax);
    if (next === this.metricsScrollY) return false;
    this.metricsScrollY = next;
    if (this.lastRendered) {
      this.draw(this.lastRendered.state, this.lastRendered.scenario);
    }
    return true;
  }

  draw(state: GameRenderState, scenario?: ScenarioDefinition) {
    this.lastRendered = scenario ? {state, scenario} : {state};
    const viewModel = buildCanvasViewModel(state, scenario);
    const surface = this.surface();
    const ctx = this.ctx;
    ctx.save();
    try {
      ctx.setTransform(
        this.canvas.width / logicalWidth,
        0,
        0,
        this.canvas.height / logicalHeight,
        0,
        0
      );
      ctx.clearRect(0, 0, logicalWidth, logicalHeight);
      ctx.drawImage(this.staticCanvas, 0, 0);
      drawHeader(surface, state);
      for (const monitor of monitorLayouts) {
        withMonitorPose(surface, monitor, () => {
          drawMonitor(
            surface,
            monitor.x,
            monitor.y,
            monitor.width,
            monitor.height,
            monitor.title,
            (content) => {
              if (monitor.id === 'metrics') {
                drawMetricsPanelOnSurface(
                  surface,
                  state.monitors.left,
                  content.height
                );
              } else if (monitor.id === 'terminal') {
                drawCenterPanel(surface, state, content.width);
              } else {
                drawRightPanel(surface, state, viewModel);
              }
            }
          );
        });
      }
      drawCenterToolTabs(surface, state);
      drawMonitorMagnifyIcons(surface);
      drawAlerts(surface, state);
      if (state.warning && state.warning.flashMs > 0) {
        drawCommandWarning(surface, state.warning);
      }
      drawNavigationOverlay(surface, state, scenario);
      drawInputDock(surface, state);
      drawNotifications(surface, state, viewModel);
      if (state.world.expandedMonitor) {
        drawExpandedMonitorOverlay(surface, state, scenario, viewModel);
      }
      drawCursor(surface, state);
    } finally {
      ctx.restore();
    }
    this.metricsScrollY = surface.metricsScrollY;
    this.metricsScrollMax = surface.metricsScrollMax;
  }

  private drawStaticLayer() {
    const previous = this.ctx;
    this.ctx = this.staticCtx;
    const surface = this.surface(this.staticCtx);
    try {
      this.ctx.clearRect(0, 0, logicalWidth, logicalHeight);
      drawRoom(surface);
      for (const monitor of monitorLayouts) {
        withMonitorPose(surface, monitor, () => {
          drawMonitorFrame(
            surface,
            monitor.x,
            monitor.y,
            monitor.width,
            monitor.height,
            monitor.title
          );
        });
      }
    } finally {
      this.ctx = previous;
    }
  }
}
