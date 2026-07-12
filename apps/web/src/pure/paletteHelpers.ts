export const metricPalette = {
  metricHealthy: '#7cfc9a',
  metricWarn: '#ffcf5c',
  metricCritical: '#ff6b6b',
  statusCritical: '#ff6b6b',
  statusWarn: '#ffcf5c',
  statusInfo: '#8aa892',
  accentPurple: '#b7f2c3',
  accentPink: '#8aa892',
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
