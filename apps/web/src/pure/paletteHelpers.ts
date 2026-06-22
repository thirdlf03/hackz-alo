export const metricPalette = {
  metricHealthy: '#4ade80',
  metricWarn: '#fbbf24',
  metricCritical: '#f87171',
  statusCritical: '#f87171',
  statusWarn: '#fbbf24',
  statusInfo: '#5ec8ff',
  accentPurple: '#c4b5fd',
  accentPink: '#f9a8d4',
} as const;

export type MetricTone = 'healthy' | 'warn' | 'critical';

export function toneColor(tone: MetricTone): string {
  if (tone === 'critical') return metricPalette.metricCritical;
  if (tone === 'warn') return metricPalette.metricWarn;
  return metricPalette.metricHealthy;
}

export function severityColor(
  severity: 'info' | 'warning' | 'critical'
): string {
  if (severity === 'critical') return metricPalette.statusCritical;
  if (severity === 'warning') return metricPalette.statusWarn;
  return metricPalette.statusInfo;
}
