import type {GameRenderState, MetricsSource} from '@incident/shared';
import {
  clamp,
  drawSparkline,
  roundRect,
  summarizeMetricsHealth,
  truncateToWidth,
  type MetricsHealthSummary,
} from './canvasDrawUtils.js';
import {buildMetricSections} from '../../pure/metricsSections.js';
import {METRICS_SCROLL_TOP, monitorContentHeight} from './canvasLayout.js';
import {gamePalette as palette, uiFont, monoFont} from './gamePalette.js';

export interface MetricsPanelScroll {
  scrollY: number;
  scrollMax: number;
}

function drawMetricsHealthBanner(
  ctx: CanvasRenderingContext2D,
  health: MetricsHealthSummary,
  source: MetricsSource,
  panelWidth: number
) {
  ctx.fillStyle = palette.bgCardDark;
  roundRect(ctx, 0, 0, panelWidth, 40, 8);
  ctx.fill();

  ctx.fillStyle = health.color;
  ctx.beginPath();
  ctx.arc(14, 20, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = palette.textPrimary;
  ctx.font = uiFont(16);
  ctx.fillText('SERVICE HEALTH', 28, 18);

  const badge = health.label;
  const sourceLabel =
    source === 'live' ? 'LIVE' : source === 'loading' ? 'SYNC' : 'OFFLINE';
  const sourceColor =
    source === 'live'
      ? palette.statusLive
      : source === 'loading'
        ? palette.statusLoading
        : palette.statusError;
  ctx.font = monoFont(14);
  const badgeWidth = ctx.measureText(badge).width + 20;
  const sourceWidth = ctx.measureText(sourceLabel).width;
  const badgeX = panelWidth - badgeWidth - 10;
  const sourceX = badgeX - 10 - sourceWidth;
  const dotX = sourceX - 12;

  ctx.fillStyle = palette.textSecondary;
  ctx.font = monoFont(14);
  const detailMaxWidth = Math.max(72, dotX - 30);
  ctx.fillText(truncateToWidth(ctx, health.detail, detailMaxWidth), 28, 33);

  ctx.fillStyle = palette.bgInput;
  roundRect(ctx, badgeX, 8, badgeWidth, 24, 6);
  ctx.fill();
  ctx.fillStyle = health.color;
  ctx.font = monoFont(14);
  ctx.fillText(badge, badgeX + 10, 24);

  ctx.fillStyle = sourceColor;
  ctx.beginPath();
  ctx.arc(dotX, 20, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = palette.textSecondary;
  ctx.font = monoFont(14);
  ctx.fillText(sourceLabel, sourceX, 23);
}

function drawMetricCard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  card: {
    label: string;
    value: number;
    suffix: string;
    max: number;
    color: string;
    historyValues: number[];
  }
) {
  ctx.fillStyle = palette.bgPanel;
  roundRect(ctx, x, y, width, height, 8);
  ctx.fill();
  ctx.strokeStyle = palette.borderPanel;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = palette.textSecondary;
  ctx.font = monoFont(14);
  ctx.fillText(card.label, x + 12, y + 18);

  ctx.fillStyle = palette.textPrimary;
  ctx.font = monoFont(22, 'bold');
  ctx.fillText(`${String(card.value)}${card.suffix}`, x + 12, y + 44);

  drawSparkline(
    ctx,
    x + 12,
    y + height - 31,
    width - 24,
    22,
    card.historyValues.length > 0 ? card.historyValues : [card.value],
    card.color,
    card.max
  );
}

function drawMetricsScrollbar(
  ctx: CanvasRenderingContext2D,
  scroll: MetricsPanelScroll,
  panelWidth: number,
  top: number,
  viewportHeight: number,
  contentHeight: number
) {
  if (scroll.scrollMax <= 0 || viewportHeight <= 0 || contentHeight <= 0) {
    return;
  }
  const trackX = panelWidth - 7;
  const trackY = top + 2;
  const trackHeight = viewportHeight - 4;
  const thumbHeight = Math.max(
    28,
    Math.round((viewportHeight / contentHeight) * trackHeight)
  );
  const thumbY =
    trackY +
    Math.round(
      (scroll.scrollY / scroll.scrollMax) * (trackHeight - thumbHeight)
    );

  ctx.fillStyle = 'rgba(148, 163, 184, 0.16)';
  roundRect(ctx, trackX, trackY, 4, trackHeight, 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(148, 163, 184, 0.58)';
  roundRect(ctx, trackX, thumbY, 4, thumbHeight, 2);
  ctx.fill();
}

export function drawMetricsPanel(
  ctx: CanvasRenderingContext2D,
  scroll: MetricsPanelScroll,
  left: GameRenderState['monitors']['left'],
  viewportHeight = monitorContentHeight
) {
  const {metrics, metricsHistory, metricsSource} = left;
  const health = summarizeMetricsHealth(metrics);
  const panelWidth = 496;
  const cardHeight = 88;
  const cardGap = 12;
  const rowStride = cardHeight + cardGap;
  const sectionGap = 16;
  const sections = buildMetricSections(metrics);

  drawMetricsHealthBanner(ctx, health, metricsSource, panelWidth);

  const scrollViewportHeight = Math.max(0, viewportHeight - METRICS_SCROLL_TOP);
  let contentHeight = 0;
  for (const section of sections) {
    const rows = Math.ceil(section.cards.length / 2);
    contentHeight += 18 + rows * rowStride + sectionGap;
  }
  contentHeight = Math.max(0, contentHeight - sectionGap);
  scroll.scrollMax = Math.max(0, contentHeight - scrollViewportHeight);
  scroll.scrollY = clamp(scroll.scrollY, 0, scroll.scrollMax);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, METRICS_SCROLL_TOP, panelWidth, scrollViewportHeight);
  ctx.clip();
  ctx.translate(0, METRICS_SCROLL_TOP - scroll.scrollY);

  let y = 0;
  for (const section of sections) {
    ctx.fillStyle = palette.textMuted;
    ctx.font = monoFont(14);
    ctx.fillText(section.title, 0, y);
    y += 18;

    section.cards.forEach((card, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const cardX = column * 252;
      const cardY = y + row * rowStride;
      const historyValues = metricsHistory.map(card.pickHistory);
      drawMetricCard(ctx, cardX, cardY, 236, cardHeight, {
        label: card.label,
        value: card.value,
        suffix: card.suffix,
        max: card.max,
        color: card.color,
        historyValues,
      });
    });

    const rows = Math.ceil(section.cards.length / 2);
    y += rows * rowStride + sectionGap;
  }
  ctx.restore();
  drawMetricsScrollbar(
    ctx,
    scroll,
    panelWidth,
    METRICS_SCROLL_TOP,
    scrollViewportHeight,
    contentHeight
  );
}

export {buildMetricSections} from '../../pure/metricsSections.js';
