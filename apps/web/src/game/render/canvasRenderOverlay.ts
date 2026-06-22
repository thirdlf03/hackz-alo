import type {GameRenderState, ScenarioDefinition} from '@incident/shared';
import type {CanvasRenderSurface} from './canvasRenderSurface.js';
import {buildCanvasViewModel, type CanvasViewModel} from './canvasViewModel.js';
import {
  drawMetricsPanel as drawMetricsPanelContent,
  type MetricsPanelScroll,
} from './canvasRenderMetrics.js';
import {gamePalette as palette, uiFont} from './gamePalette.js';
import {
  expandedMonitorLayout,
  logicalHeight,
  logicalWidth,
  monitorLayouts,
  monitorContentHeight,
} from './canvasLayout.js';
import {drawCenterPanel} from './canvasRenderCenterPanel.js';
import {drawRightPanel} from './canvasRenderRightPanel.js';
import {drawMonitor, drawMonitorFrame} from './canvasRenderScene.js';

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
  drawMonitorFrame(
    surface,
    layout.x,
    layout.y,
    layout.width,
    layout.height,
    monitor.title,
    {stand: false}
  );
  drawMonitor(
    surface,
    layout.x,
    layout.y,
    layout.width,
    layout.height,
    monitor.title,
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

  surface.ctx.fillStyle = palette.textMuted;
  surface.ctx.font = uiFont(14);
  surface.ctx.fillText(
    '背景をクリックで閉じる',
    layout.x + layout.width - 168,
    layout.y + 28
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
