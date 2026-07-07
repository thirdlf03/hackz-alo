import {useEffect} from 'preact/hooks';
import {recordGameTick} from '@incident/observability/browser';
import {advanceGameState, decayWorldOverlays} from '../game/state/gameState.js';
import type {SessionRuntimeBindings} from './sessionRuntimeTypes.js';

export function useSessionGameLoop(bindings: SessionRuntimeBindings) {
  const {screen, session, refs, setGameState, endSession, patchGameStateRef} =
    bindings;

  useEffect(() => {
    if (screen !== 'play' || !session) return;
    const timer = window.setInterval(() => {
      const tickStartedAt = performance.now();
      if (refs.finishingRef.current || document.visibilityState === 'hidden') {
        return;
      }
      const previous = refs.gameStateRef.current;
      if (!previous) return;
      const now = performance.now();
      const lastTickAt = refs.lastTickAtRef.current || now;
      refs.lastTickAtRef.current = now;
      const delta = Math.max(0, (now - lastTickAt) * previous.clock.speed);
      if (delta === 0) return;
      const elapsedMs = Math.min(
        previous.clock.timeLimitMs,
        previous.clock.elapsedMs + delta
      );
      refs.elapsedMsRef.current = elapsedMs;
      const next = advanceGameState(
        previous,
        elapsedMs,
        refs.scenarioRef.current ?? undefined,
        previous.clock.speed,
        delta,
        previous.monitors.left.alerts,
        previous.monitors.right.chatMessages
      );
      refs.gameStateRef.current = next;
      setGameState(next);
      if (elapsedMs >= next.clock.timeLimitMs) void endSession('timeout');
      recordGameTick(performance.now() - tickStartedAt, {
        elapsed_ms: Math.round(elapsedMs),
      });
    }, 500);
    return () => {
      window.clearInterval(timer);
    };
  }, [screen, session?.sessionId]);

  useEffect(() => {
    if (screen !== 'play') return;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const delta = now - last;
      last = now;
      patchGameStateRef((current) => decayWorldOverlays(current, delta), {
        render: false,
        collectTransitions: false,
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [screen]);
}
