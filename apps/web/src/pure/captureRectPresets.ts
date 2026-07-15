import {monitorLayout} from './canvasLayout.js';
import type {CanvasCaptureRect} from './aiAssist.js';

/** A one-click screenshot capture region for the AI Assist panel's "範囲を
 * 選択" UI. `rect` is undefined for the "全画面" preset, matching the
 * existing captureRect === undefined convention (capture the whole canvas). */
export interface CaptureRectPreset {
  id: 'full' | 'metrics' | 'terminal' | 'runbook';
  label: string;
  rect: CanvasCaptureRect | undefined;
}

function toCaptureRect(monitor: {
  x: number;
  y: number;
  width: number;
  height: number;
}): CanvasCaptureRect {
  return {
    x: monitor.x,
    y: monitor.y,
    width: monitor.width,
    height: monitor.height,
  };
}

/**
 * Presets derived from the existing monitor panel regions in canvasLayout.ts
 * (no hardcoded coordinates), so they stay in sync with the flat terminal
 * layout: METRICS/TERMINAL/RUNBOOK are the three monitorLayouts columns, and
 * "全画面" clears the capture rect back to the whole canvas.
 */
export function captureRectPresets(): CaptureRectPreset[] {
  return [
    {id: 'full', label: '全画面', rect: undefined},
    {
      id: 'metrics',
      label: 'メトリクス',
      rect: toCaptureRect(monitorLayout('metrics')),
    },
    {
      id: 'terminal',
      label: 'ターミナル',
      rect: toCaptureRect(monitorLayout('terminal')),
    },
    {
      id: 'runbook',
      label: 'Runbook',
      rect: toCaptureRect(monitorLayout('runbook')),
    },
  ];
}
