import {useEffect} from 'preact/hooks';
import {createInitialGameState} from '../game/state/gameState.js';
import {createEmptyTerminalMirror} from '../game/terminal/mirror.js';
import type {SessionRuntimeBindings} from './sessionRuntimeTypes.js';

/**
 * Keeps non-host participants in sync with the exercise phase broadcast
 * over SSE. The session `start` action is host/facilitator-initiated, but
 * every participant needs to move from lobby/briefing into play once the
 * server reports the exercise as running.
 */
export function useExercisePhaseSync(bindings: SessionRuntimeBindings) {
  const {
    screen,
    session,
    scenario,
    gameSpeed,
    exerciseSnapshot,
    isStarting,
    participantId,
    refs,
    recordingRef,
    terminalBridgeRef,
    setGameState,
    setTimeline,
    setScreen,
  } = bindings;

  useEffect(() => {
    if (exerciseSnapshot?.phase !== 'briefing') return;
    if (screen !== 'lobby') return;
    setScreen('briefing');
  }, [exerciseSnapshot?.phase, screen]);

  useEffect(() => {
    if (exerciseSnapshot?.phase !== 'running') return;
    if (screen !== 'lobby' && screen !== 'briefing') return;
    if (isStarting || !session || !scenario) return;
    terminalBridgeRef.current?.destroyTerminal();
    refs.elapsedMsRef.current = 0;
    refs.lastTickAtRef.current = performance.now();
    recordingRef.current?.resetRecordingClock();
    setTimeline([]);
    setGameState(
      createInitialGameState(
        scenario,
        session.sessionId,
        session.replayId,
        createEmptyTerminalMirror(),
        {
          sessionStatus: 'running',
          speed: gameSpeed,
          localParticipantId: participantId,
        }
      )
    );
    setScreen('play');
    // Guests never went through startPlay(), so the shared terminal
    // (sandbox) was never attached for them. attachTerminalSession is a
    // no-op if a host-initiated attach for this same session already
    // happened (see useTerminalBridge's attachedSessionIdRef guard).
    void terminalBridgeRef.current?.attachTerminalSession(session);
  }, [exerciseSnapshot?.phase, screen]);

  useEffect(() => {
    if (exerciseSnapshot?.phase !== 'resolved') return;
    if (screen !== 'play') return;
    setScreen('result');
  }, [exerciseSnapshot?.phase, screen]);
}
