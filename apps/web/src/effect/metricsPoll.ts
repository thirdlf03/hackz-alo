import type {MetricsSnapshot} from '@incident/shared';
import {Data, Effect, Schedule} from 'effect';
import type {ApiClientSurface} from '../api/client.js';
import {measureSessionEdgeRtt} from './sessionEdgeRtt.js';

export class MetricsPollError extends Data.TaggedError('MetricsPollError')<{
  cause: unknown;
}> {}

export const fetchSessionMetrics = (api: ApiClientSurface, sessionId: string) =>
  Effect.tryPromise({
    try: () => api.getSessionMetrics(sessionId),
    catch: (cause) => new MetricsPollError({cause}),
  });

export const metricsPollSchedule = Schedule.spaced('5 seconds');

export type MetricsPollOutcome =
  | {kind: 'metrics'; metrics: MetricsSnapshot; edgeRttMs: number | null}
  | {kind: 'offline'};

export const pollSessionMetricsOnce = (
  api: ApiClientSurface,
  sessionId: string
) =>
  Effect.tryPromise({
    try: async () => {
      const edgeRttPromise = measureSessionEdgeRtt(() =>
        api.getSessionClock(sessionId)
      ).catch(() => null);
      const [metrics, edgeRttMs] = await Promise.all([
        api.getSessionMetrics(sessionId),
        edgeRttPromise,
      ]);
      return {kind: 'metrics' as const, metrics, edgeRttMs};
    },
    catch: (cause) => new MetricsPollError({cause}),
  }).pipe(
    Effect.catchAll(() => Effect.succeed<MetricsPollOutcome>({kind: 'offline'}))
  );

export const runMetricsPollLoop = (
  api: ApiClientSurface,
  sessionId: string,
  onOutcome: (outcome: MetricsPollOutcome) => void
) =>
  pollSessionMetricsOnce(api, sessionId).pipe(
    Effect.tap((outcome) => {
      onOutcome(outcome);
    }),
    Effect.repeat(metricsPollSchedule)
  );
