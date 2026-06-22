import {useEffect} from 'preact/hooks';
import {Effect, Fiber} from 'effect';
import type {GameRenderState} from '@incident/shared';
import {applyLiveMetrics} from '../game/state/gameState.js';
import {detectMetricThresholdCrossings} from '../game/events/monitorEvents.js';
import type {ApiClientSurface} from '../api/client.js';
import type {ReplayEventEmitter} from '../game/events/emitReplayEvent.js';
import {runMetricsPollLoop} from '../effect/metricsPoll.js';
import type {Screen} from './appTypes.js';

export function useMetricsPolling(options: {
  api: ApiClientSurface;
  screen: Screen;
  session: {sessionId: string; replayId: string} | undefined;
  sessionRef: {current: {sessionId: string; replayId: string} | undefined};
  gameStateRef: {current: GameRenderState | undefined};
  eventEmitterRef: {current: ReplayEventEmitter | null};
  patchGameStateRef: (
    updater: (state: GameRenderState) => GameRenderState,
    options?: {render?: boolean; collectTransitions?: boolean}
  ) => void;
  currentGameTimeMs: () => number;
}) {
  const {
    api,
    screen,
    session,
    sessionRef,
    gameStateRef,
    eventEmitterRef,
    patchGameStateRef,
    currentGameTimeMs,
  } = options;

  useEffect(() => {
    if (screen !== 'play' || !session) return;
    if (document.visibilityState === 'hidden') return;

    const fiber = Effect.runFork(
      runMetricsPollLoop(api, session.sessionId, (outcome) => {
        if (outcome.kind === 'offline') {
          patchGameStateRef((current) => ({
            ...current,
            monitors: {
              ...current.monitors,
              left: {...current.monitors.left, metricsSource: 'offline'},
            },
          }));
          return;
        }

        const metrics = outcome.metrics;
        const previous = gameStateRef.current?.monitors.left.metrics;
        patchGameStateRef((current) => applyLiveMetrics(current, metrics));
        const replayId = sessionRef.current?.replayId;
        const emitter = eventEmitterRef.current;
        if (replayId && emitter && previous) {
          for (const crossing of detectMetricThresholdCrossings(
            previous,
            metrics
          )) {
            void emitter.emitOnce(`metric:${crossing.key}`, {
              replayId,
              type: 'monitor_update',
              at: currentGameTimeMs(),
              actor: 'system',
              payload: {
                metric: crossing.key,
                label: crossing.label,
                value: metrics[crossing.key],
              },
            });
          }
        }
      })
    );

    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [screen, session?.sessionId]);
}
