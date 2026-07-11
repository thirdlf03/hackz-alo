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
import {drawTopologyMap} from './canvasRenderTopology.js';
import type {AnsiSpan} from '../terminal/ansi.js';
import type {
  CanvasRenderSurface,
  TopologyHealthCacheEntry,
} from './canvasRenderSurface.js';
import officeMonitorBackdropUrl from '../../assets/office-monitor-backdrop.avif';
import {
  supportsDrawElementImage,
  transformToCss,
} from '../../pure/htmlInCanvas.js';
import {
  chatComposeRegion,
  logicalHeight,
  logicalWidth,
  monitorLayouts,
  TOPOLOGY_MAP_HEIGHT,
} from './canvasLayout.js';

interface DrawElementContext {
  drawElementImage(
    element: Element,
    dx: number,
    dy: number,
    dwidth?: number,
    dheight?: number
  ): unknown;
}

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
  chatComposeAt,
  chatComposeRegion,
  chatSendButtonRegion,
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
  private topologyHealthCache = new Map<string, TopologyHealthCacheEntry>();
  private metricsScrollY = 0;
  private metricsScrollMax = 0;
  private readonly htmlInCanvasEnabled: boolean;
  private chatInput: HTMLInputElement | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d canvas is required');
    this.ctx = ctx;
    this.htmlInCanvasEnabled = supportsDrawElementImage(ctx);
    if (this.htmlInCanvasEnabled) {
      // IME 変換中など「DOM 側だけが変化した」ケースを拾い、ゲームループ外でも
      // 再描画を要求する(既存の lastRendered 再描画機構を再利用)。
      this.canvas.addEventListener('paint', () => {
        if (this.lastRendered) {
          this.draw(this.lastRendered.state, this.lastRendered.scenario);
        }
      });
    }
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
      topologyHealthCache: this.topologyHealthCache,
    };
  }

  /** HTML-in-Canvas 有効時に canvas 内へ埋め込むチャット入力欄を登録する。 */
  setChatInput(input: HTMLInputElement | null) {
    this.chatInput = input;
  }

  get embedsHtml() {
    return this.htmlInCanvasEnabled;
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
    const nowMs = performance.now();
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
                if (scenario?.topology) {
                  drawTopologyMap(
                    surface,
                    scenario.topology,
                    state.monitors.left.serviceHealth,
                    nowMs,
                    content.width,
                    TOPOLOGY_MAP_HEIGHT
                  );
                  ctx.save();
                  ctx.translate(0, TOPOLOGY_MAP_HEIGHT);
                  drawMetricsPanelOnSurface(
                    surface,
                    state.monitors.left,
                    content.height - TOPOLOGY_MAP_HEIGHT
                  );
                  ctx.restore();
                } else {
                  drawMetricsPanelOnSurface(
                    surface,
                    state.monitors.left,
                    content.height
                  );
                }
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
      this.drawEmbeddedElements(state);
      drawCursor(surface, state);
    } finally {
      ctx.restore();
    }
    this.metricsScrollY = surface.metricsScrollY;
    this.metricsScrollMax = surface.metricsScrollMax;
  }

  /**
   * HTML-in-Canvas 有効時、チャット入力欄(本物の <input>)を canvas 上の
   * compose 領域に描画し、戻り値 transform を DOM 要素へ適用してヒットテスト
   * 位置を描画位置に一致させる。チャットタブ表示中のみ。非対応時は何もしない
   * (従来の自前描画にフォールバック)。
   */
  private drawEmbeddedElements(state: GameRenderState) {
    const input = this.chatInput;
    if (!this.htmlInCanvasEnabled || !input) return;
    if (state.monitors.right.activePanelTab !== 'chat') {
      input.style.transform = 'translateY(-9999px)';
      return;
    }
    const region = chatComposeRegion(
      state.monitors.right.activePanelTab,
      state.world.expandedMonitor
    );
    try {
      const ctx = this.ctx as unknown as DrawElementContext;
      const transform = ctx.drawElementImage(
        input,
        region.x,
        region.y,
        region.width,
        region.height
      );
      input.style.transform = transformToCss(transform);
    } catch {
      // 実験的 API のため描画に失敗しても致命的にしない。
    }
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
