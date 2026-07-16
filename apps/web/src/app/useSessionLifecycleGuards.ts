import {useEffect, useRef} from 'preact/hooks';
import type {SessionRuntimeBindings} from './sessionRuntimeTypes.js';

const TAB_HIDDEN_TIMEOUT_MS = 90_000;
// A departing solo player (1 participant) still needs the classic
// notifySessionTimeout finish — there's nobody else for markParticipantOffline
// to leave running. See sessionExerciseHandlers.ts's participantOffline /
// SessionDurableObject.timeout() for the server-side counterpart.
const MULTIPLAYER_PARTICIPANT_THRESHOLD = 2;

export function useSessionLifecycleGuards(bindings: SessionRuntimeBindings) {
  const {api, screen, refs, exerciseSnapshot, participantId} = bindings;

  // Read via refs (not the effect dependency array) so the pagehide/
  // visibility listeners below don't need to be torn down and re-added on
  // every exercise snapshot update (which happens far more often than
  // `screen` changes) — only the *latest* participant count matters at
  // the moment the tab actually hides/closes.
  const exerciseSnapshotRef = useRef(exerciseSnapshot);
  exerciseSnapshotRef.current = exerciseSnapshot;
  const participantIdRef = useRef(participantId);
  participantIdRef.current = participantId;

  const notifyDeparture = (sessionId: string) => {
    const isMultiplayer =
      (exerciseSnapshotRef.current?.participants.length ?? 0) >=
      MULTIPLAYER_PARTICIPANT_THRESHOLD;
    if (isMultiplayer) {
      api.markParticipantOffline(sessionId, participantIdRef.current);
    } else {
      api.notifySessionTimeout(sessionId);
    }
  };

  useEffect(() => {
    const onPageHide = () => {
      if (refs.finishingRef.current || refs.tabBeaconSentRef.current) return;
      const activeSession = refs.sessionRef.current;
      if (!activeSession || screen !== 'play') return;
      refs.tabBeaconSentRef.current = true;
      notifyDeparture(activeSession.sessionId);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [screen]);

  useEffect(() => {
    if (screen !== 'play') return;
    let hiddenSince: number | undefined;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (hiddenSince === undefined) hiddenSince = Date.now();
        return;
      }
      hiddenSince = undefined;
    };
    const timer = window.setInterval(() => {
      if (
        refs.finishingRef.current ||
        refs.tabBeaconSentRef.current ||
        hiddenSince === undefined
      ) {
        return;
      }
      const activeSession = refs.sessionRef.current;
      if (!activeSession) return;
      if (Date.now() - hiddenSince < TAB_HIDDEN_TIMEOUT_MS) return;
      hiddenSince = undefined;
      refs.tabBeaconSentRef.current = true;
      notifyDeparture(activeSession.sessionId);
    }, 5_000);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
  }, [screen]);
}
