import type {AnsiSpan} from '../terminal/ansi.js';

export interface CanvasRenderSurface {
  ctx: CanvasRenderingContext2D;
  terminalLineCache: Map<string, {spans: AnsiSpan[]; plain: string}>;
  metricsScrollY: number;
  metricsScrollMax: number;
  roomBackdrop: HTMLImageElement;
  roomBackdropLoaded: boolean;
}

export interface MetricsScrollState {
  scrollY: number;
  scrollMax: number;
}

export function readMetricsScroll(
  surface: CanvasRenderSurface
): MetricsScrollState {
  return {scrollY: surface.metricsScrollY, scrollMax: surface.metricsScrollMax};
}

export function writeMetricsScroll(
  surface: CanvasRenderSurface,
  scroll: MetricsScrollState
) {
  surface.metricsScrollY = scroll.scrollY;
  surface.metricsScrollMax = scroll.scrollMax;
}
