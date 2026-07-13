import type {MetricsSnapshot} from '@incident/shared';

export interface MetricThreshold {
  key: keyof Pick<MetricsSnapshot, 'cpu' | 'memory' | 'disk' | 'http5xxRate'>;
  label: string;
  threshold: number;
}

const THRESHOLDS: MetricThreshold[] = [
  {key: 'http5xxRate', label: 'HTTP 5xx', threshold: 0.05},
  {key: 'disk', label: 'Disk', threshold: 90},
  {key: 'memory', label: 'Memory', threshold: 85},
  {key: 'cpu', label: 'CPU', threshold: 80},
];

export function detectMetricThresholdCrossings(
  previous: MetricsSnapshot | undefined,
  next: MetricsSnapshot
) {
  if (!previous) return [];
  return THRESHOLDS.filter((item) => {
    const before = previous[item.key];
    const after = next[item.key];
    if (before === null || after === null) return false;
    return before < item.threshold && after >= item.threshold;
  });
}
