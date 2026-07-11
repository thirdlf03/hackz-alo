import {monitorLayouts} from './canvasLayout.js';

/** Document PiP に「取り外し」できるモニター。 */
export type PipMonitorId = 'metrics' | 'chat';

export interface PipRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const PIP_MONITOR_LABELS: Record<PipMonitorId, string> = {
  metrics: 'メトリクスモニター',
  chat: 'チャット / Runbook モニター',
};

/**
 * gameCanvas(1920x1080 論理座標)上でミラー描画する矩形。
 * metrics は左モニター、chat は右モニター(Runbook / チャット)全体。
 */
export function pipRegionForMonitor(monitorId: PipMonitorId): PipRegion {
  const layoutId = monitorId === 'metrics' ? 'metrics' : 'runbook';
  const layout = monitorLayouts.find((monitor) => monitor.id === layoutId);
  if (!layout) {
    return {x: 0, y: 0, width: 1920, height: 1080};
  }
  return {
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
  };
}

/** PiP ウィンドウの初期サイズ(アスペクト比を保って幅を制限)。 */
export function pipWindowSize(
  region: PipRegion,
  maxWidth = 420
): {width: number; height: number} {
  if (region.width <= 0 || region.height <= 0) {
    return {width: maxWidth, height: maxWidth};
  }
  const width = Math.min(region.width, maxWidth);
  return {
    width: Math.round(width),
    height: Math.max(1, Math.round((region.height / region.width) * width)),
  };
}
