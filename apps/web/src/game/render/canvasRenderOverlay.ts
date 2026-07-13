import type {GameRenderState, ScenarioDefinition} from '@incident/shared';
import type {CanvasRenderSurface} from './canvasRenderSurface.js';
import {buildCanvasViewModel, type CanvasViewModel} from './canvasViewModel.js';
import {
  drawMetricsPanel as drawMetricsPanelContent,
  drawMetricsPanelHeader,
  type MetricsPanelScroll,
} from './canvasRenderMetrics.js';
import {gamePalette as palette, monoFont, uiFont} from './gamePalette.js';
import {
  expandedMonitorLayout,
  logicalHeight,
  logicalWidth,
  monitorHeaderHeight,
  monitorLayouts,
  monitorContentHeight,
  PANEL_PADDING,
} from './canvasLayout.js';
import {drawCenterPanel} from './canvasRenderCenterPanel.js';
import {drawRightPanel} from './canvasRenderRightPanel.js';
import {drawFlatPanel, drawMonitor} from './canvasRenderScene.js';

export function drawExpandedMonitorOverlay(
  surface: CanvasRenderSurface,
  state: GameRenderState,
  scenario?: ScenarioDefinition,
  viewModel?: CanvasViewModel
) {
  const monitorId = state.world.expandedMonitor;
  if (!monitorId) return;

  const resolvedViewModel = viewModel ?? buildCanvasViewModel(state, scenario);

  const monitor = monitorLayouts.find((item) => item.id === monitorId);
  if (!monitor) return;

  surface.ctx.fillStyle = 'rgba(2, 6, 23, 0.78)';
  surface.ctx.fillRect(0, 0, logicalWidth, logicalHeight);

  const layout = expandedMonitorLayout;
  const headerHeight = monitorHeaderHeight(monitorId);
  drawFlatPanel(surface, monitorId, layout, headerHeight);
  drawMonitor(
    surface,
    layout.x,
    layout.y,
    layout.width,
    layout.height,
    headerHeight,
    (content) => {
      if (monitorId === 'metrics') {
        drawMetricsPanelOnSurface(surface, state.monitors.left, content.height);
      } else if (monitorId === 'terminal') {
        drawCenterPanel(surface, state, content.width);
      } else {
        drawRightPanel(surface, state, resolvedViewModel);
      }
    }
  );

  if (monitorId === 'metrics') {
    drawMetricsPanelHeader(
      surface,
      layout,
      headerHeight,
      state.monitors.left.metrics
    );
  } else if (monitorId === 'terminal') {
    const label =
      state.monitors.center.activeTool === 'editor' ? 'EDITOR' : 'TERMINAL';
    surface.ctx.fillStyle = palette.textLink;
    surface.ctx.font = monoFont(16);
    surface.ctx.fillText(
      label,
      layout.x + PANEL_PADDING,
      layout.y + headerHeight / 2 + 6
    );
  }

  surface.ctx.fillStyle = palette.textMuted;
  surface.ctx.font = uiFont(14);
  surface.ctx.fillText(
    '背景をクリックで閉じる',
    layout.x + layout.width - 168,
    layout.y - 14
  );
}

export function drawMetricsPanelOnSurface(
  surface: CanvasRenderSurface,
  left: GameRenderState['monitors']['left'],
  viewportHeight = monitorContentHeight
) {
  const scroll: MetricsPanelScroll = {
    scrollY: surface.metricsScrollY,
    scrollMax: surface.metricsScrollMax,
  };
  drawMetricsPanelContent(surface.ctx, scroll, left, viewportHeight);
  surface.metricsScrollY = scroll.scrollY;
  surface.metricsScrollMax = scroll.scrollMax;
}
