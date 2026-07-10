import {useEffect} from 'preact/hooks';
import {createInitialGameState} from '../game/state/gameState.js';
import {createEmptyTerminalMirror} from '../game/terminal/mirror.js';
import {isHostParticipant} from '../pure/isHostParticipant.js';
import {canOperateSandbox} from '../pure/rolePermissions.js';
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
    // Guests never went through startPlay(), so the shared terminal
    // (sandbox) was never attached for them. attachTerminalSession is a
    // no-op if a host-initiated attach for this same session already
    // happened, or if an attach for this session is already in flight
    // (see useTerminalBridge's attachedSessionIdRef guard). Wait for the
    // attach to settle before switching to the play screen so the guest's
    // terminal is ready as soon as the screen transition happens, matching
    // the host's startPlay() ordering.
    void (async () => {
      try {
        // Role gate mirrors the server (see pure/rolePermissions.ts):
        // guests without sandbox permission stay detached and see the
        // read-only terminal panel instead.
        if (canOperateSandbox(exerciseSnapshot.participants, participantId)) {
          await terminalBridgeRef.current?.attachTerminalSession(session);
        }
      } catch (error) {
        console.error(error);
      } finally {
        setScreen('play');
      }
    })();
  }, [exerciseSnapshot?.phase, screen]);

  useEffect(() => {
    if (exerciseSnapshot?.phase !== 'resolved') return;
    if (screen !== 'play') return;
    setScreen('result');
    // Recording only ever runs on the host's client (see useCanvasRecording's
    // isHost gate). If this client itself called endSession(), it already
    // set finishingRef synchronously before this snapshot could arrive, so
    // skip here to avoid finalizing twice. Otherwise — another participant
    // (host or guest) ended the session — the host must still finish its
    // own recording upload; guests have nothing to finalize.
    if (!session || refs.finishingRef.current) return;
    if (!isHostParticipant(exerciseSnapshot, participantId)) return;
    refs.finishingRef.current = true;
    const recording = recordingRef.current;
    if (!recording) return;
    const activeSession = session;
    const shouldSaveVideo = recording.shouldSaveVideo();
    setGameState((current) =>
      current
        ? {
            ...current,
            recording: {
              ...current.recording,
              status: shouldSaveVideo ? 'stopping' : 'idle',
            },
          }
        : current
    );
    void recording
      .finishRecording(activeSession, shouldSaveVideo)
      .then((status) => {
        setGameState((current) =>
          current
            ? {
                ...current,
                recording: {
                  ...current.recording,
                  status,
                  saveEnabled: shouldSaveVideo,
                },
              }
            : current
        );
      });
  }, [exerciseSnapshot?.phase, screen]);
}
