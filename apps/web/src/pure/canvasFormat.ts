import type {GameRenderState, MetricsSnapshot} from '@incident/shared';
import type {MetricTone} from './paletteHelpers.js';
import {toneColor} from './paletteHelpers.js';

export function formatTime(ms: number) {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (total % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function formatNarrativeClock(narrativeHour: number) {
  const totalMinutes = Math.floor(narrativeHour * 60);
  const hours = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, '0');
  const minutes = (totalMinutes % 60).toString().padStart(2, '0');
  return `深夜 ${hours}:${minutes}`;
}

export function formatRecordingStatus(
  status: GameRenderState['recording']['status'],
  saveEnabled: boolean
) {
  if (!saveEnabled) return 'LOG ONLY';
  switch (status) {
    case 'recording':
      return 'REC';
    case 'initializing':
      return 'STARTING';
    case 'stopping':
    case 'finalizing':
      return 'SAVING';
    case 'ready':
      return 'SAVED';
    case 'recording_error':
    case 'unsupported_browser':
    case 'finalization_failed':
      return 'REC ERROR';
    case 'upload_degraded':
      return 'UPLOAD LAG';
    case 'consent_required':
      return 'CONSENT';
    case 'idle':
      return 'IDLE';
  }
}

export function formatDifficulty(
  difficulty: GameRenderState['session']['difficulty']
) {
  if (difficulty === 'beginner') return '初級';
  if (difficulty === 'intermediate') return '中級';
  return '上級';
}

export function formatTerminalInputText(command: string, maxChars = 96) {
  if (command.length <= maxChars) return command;
  return command.slice(-maxChars);
}

export function extractTypedCommand(command: string, maxChars = 96) {
  const promptEnd = command.lastIndexOf('# ');
  const typed = promptEnd >= 0 ? command.slice(promptEnd + 2) : command;
  return formatTerminalInputText(typed, maxChars);
}

export interface MetricsHealthSummary {
  label: string;
  detail: string;
  color: string;
  level: MetricTone;
}

export function metricTone(
  value: number,
  warnAt: number,
  criticalAt: number
): MetricTone {
  if (value >= criticalAt) return 'critical';
  if (value >= warnAt) return 'warn';
  return 'healthy';
}

export function summarizeMetricsHealth(
  metrics: MetricsSnapshot
): MetricsHealthSummary {
  const issues: string[] = [];
  let level: 'warn' | 'critical' | undefined;

  const raise = (tone: MetricTone, message: string) => {
    issues.push(message);
    if (tone === 'critical') level = 'critical';
    else if (tone === 'warn' && level !== 'critical') level = 'warn';
  };

  raise(metricTone(metrics.cpu, 70, 85), 'CPU elevated');
  raise(metricTone(metrics.memory, 75, 90), 'Memory pressure');
  raise(metricTone(metrics.disk, 80, 92), 'Disk pressure');
  if (metrics.http5xxRate > 0) raise('critical', 'HTTP 5xx detected');
  raise(metricTone(metrics.latencyP95Ms, 800, 1500), 'Latency spike');
  raise(metricTone(metrics.queueDepth, 12, 24), 'Queue backlog');

  if (issues.length === 0) {
    return {
      level: 'healthy',
      label: 'HEALTHY',
      detail: 'All monitored signals within SLO',
      color: toneColor('healthy'),
    };
  }

  if (level === 'critical') {
    return {
      level: 'critical',
      label: 'CRITICAL',
      detail: issues.slice(0, 2).join(' · '),
      color: toneColor('critical'),
    };
  }

  return {
    level: 'warn',
    label: 'DEGRADED',
    detail: issues.slice(0, 2).join(' · '),
    color: toneColor('warn'),
  };
}
