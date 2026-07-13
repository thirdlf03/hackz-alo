import type {MetricsSnapshot} from '@incident/shared';
import {metricTone} from './canvasFormat.js';
import {metricPalette, toneColor} from './paletteHelpers.js';

interface MetricCardSpec {
  label: string;
  value: number | null;
  suffix: string;
  max: number;
  color: string;
  pickHistory: (snapshot: MetricsSnapshot) => number | null;
  historyValues?: number[];
}

export interface MetricsPanelInput {
  metrics: MetricsSnapshot;
  edgeRttMs: number | null;
  edgeRttHistory: number[];
}

export function buildMetricSections({
  metrics,
  edgeRttMs,
  edgeRttHistory,
}: MetricsPanelInput) {
  const sections: Array<{title: string; cards: MetricCardSpec[]}> = [];

  if (edgeRttMs !== null) {
    sections.push({
      title: 'NETWORK',
      cards: [
        {
          label: 'Session RTT',
          value: edgeRttMs,
          suffix: 'ms',
          max: 2000,
          color: toneColor(metricTone(edgeRttMs, 120, 300)),
          pickHistory: () => edgeRttMs,
          historyValues: edgeRttHistory,
        },
      ],
    });
  }

  sections.push(
    {
      title: 'RESOURCES',
      cards: [
        {
          label: 'CPU',
          value: metrics.cpu,
          suffix: '%',
          max: 100,
          color:
            metrics.cpu === null
              ? metricPalette.accentPurple
              : toneColor(metricTone(metrics.cpu, 70, 85)),
          pickHistory: (snapshot: MetricsSnapshot) => snapshot.cpu,
        },
        {
          label: 'Memory',
          value: metrics.memory,
          suffix: '%',
          max: 100,
          color:
            metrics.memory === null
              ? metricPalette.accentPurple
              : toneColor(metricTone(metrics.memory, 75, 90)),
          pickHistory: (snapshot: MetricsSnapshot) => snapshot.memory,
        },
        {
          label: 'Disk',
          value: metrics.disk,
          suffix: '%',
          max: 100,
          color: toneColor(metricTone(metrics.disk, 80, 92)),
          pickHistory: (snapshot: MetricsSnapshot) => snapshot.disk,
        },
      ],
    },
    {
      title: 'TRAFFIC',
      cards: [
        {
          label: 'HTTP 5xx',
          value: Math.round(metrics.http5xxRate * 100),
          suffix: '%',
          max: 100,
          color: toneColor(metrics.http5xxRate > 0 ? 'critical' : 'healthy'),
          pickHistory: (snapshot: MetricsSnapshot) =>
            Math.round(snapshot.http5xxRate * 100),
        },
        {
          label: 'Sim API p95',
          value: metrics.latencyP95Ms,
          suffix: 'ms',
          max: 2000,
          color: toneColor(metricTone(metrics.latencyP95Ms, 800, 1500)),
          pickHistory: (snapshot: MetricsSnapshot) => snapshot.latencyP95Ms,
        },
        {
          label: 'RPS',
          value: metrics.rps,
          suffix: '',
          max: 80,
          color: metricPalette.accentPurple,
          pickHistory: (snapshot: MetricsSnapshot) => snapshot.rps,
        },
      ],
    },
    {
      title: 'DATASTORE',
      cards: [
        {
          label: 'DB Conn',
          value: metrics.dbConnections,
          suffix: '',
          max: 40,
          color: metricPalette.accentPink,
          pickHistory: (snapshot: MetricsSnapshot) => snapshot.dbConnections,
        },
        {
          label: 'Queue',
          value: metrics.queueDepth,
          suffix: '',
          max: 40,
          color: toneColor(metricTone(metrics.queueDepth, 12, 24)),
          pickHistory: (snapshot: MetricsSnapshot) => snapshot.queueDepth,
        },
      ],
    }
  );

  return sections;
}
