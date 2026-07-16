import {useEffect, useRef} from 'preact/hooks';
import type {SessionRuntimeBindings} from './sessionRuntimeTypes.js';

const TAB_HIDDEN_TIMEOUT_MS = 90_000;

export function useSessionLifecycleGuards(bindings: SessionRuntimeBindings) {
  const {api, screen, refs, participantId} = bindings;

  // Read via a ref (not the effect dependency array) so the pagehide/
  // visibility listeners below don't need to be torn down and re-added on
  // every participantId update — only the *latest* value matters at the
  // moment the tab actually hides/closes.
  const participantIdRef = useRef(participantId);
  participantIdRef.current = participantId;

  // The server (SessionDurableObject.timeout()) decides whether this is
  // the last online participant (session finishes) or not (this
  // participant is marked offline, session keeps running for the
  // others) — see sessionExerciseHandlers.ts's markOfflineIfOthersOnline.
  // Deciding this on the client from exerciseSnapshot.participants was
  // unreliable: that array includes participants who already left
  // (leaveParticipant only flips an online flag, it doesn't remove them),
  // so a stale participant count could misclassify a solo departure as
  // multiplayer or vice versa.
  const notifyDeparture = (sessionId: string) => {
    api.notifySessionTimeout(sessionId, participantIdRef.current);
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
