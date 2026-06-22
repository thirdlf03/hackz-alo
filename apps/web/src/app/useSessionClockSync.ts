import {useEffect} from 'preact/hooks';
import {advanceGameState} from '../game/state/gameState.js';
import {snapElapsedMsOnSpeedChange} from './appUtils.js';
import type {SessionRuntimeBindings} from './sessionRuntimeTypes.js';

export function useSessionClockSync(bindings: SessionRuntimeBindings) {
  const {
    api,
    screen,
    gameSpeed,
    refs,
    recordingRef,
    setGameState,
    patchGameStateRef,
    applyClockSnapshot,
  } = bindings;

  useEffect(() => {
    const previous = refs.gameStateRef.current;
    if (previous && screen === 'play') {
      const now = performance.now();
      const lastTickAt = refs.lastTickAtRef.current || now;
      const oldSpeed = previous.clock.speed;
      const snapped = snapElapsedMsOnSpeedChange({
        elapsedMs: previous.clock.elapsedMs,
        timeLimitMs: previous.clock.timeLimitMs,
        lastTickAt,
        oldSpeed,
        now,
      });
      refs.elapsedMsRef.current = snapped;
      refs.lastTickAtRef.current = now;
      if (oldSpeed !== gameSpeed) {
        recordingRef.current?.recordSpeedChange(snapped, gameSpeed);
      }
      const next = advanceGameState(
        previous,
        snapped,
        refs.scenarioRef.current ?? undefined,
        gameSpeed,
        0,
        previous.monitors.left.alerts,
        previous.monitors.right.slackMessages
      );
      refs.gameStateRef.current = next;
      setGameState(next);
    } else if (previous) {
      patchGameStateRef((current) => ({
        ...current,
        clock: {...current.clock, speed: gameSpeed},
      }));
    }
    const activeSession = refs.sessionRef.current;
    if (screen === 'play' && activeSession) {
      void api
        .updateSessionClock(activeSession.sessionId, gameSpeed)
        .then(applyClockSnapshot)
        .catch(console.error);
    }
  }, [gameSpeed, screen]);
}
