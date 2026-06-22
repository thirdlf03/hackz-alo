import {useEffect} from 'preact/hooks';
import type {SessionRuntimeBindings} from './sessionRuntimeTypes.js';

export function useSessionLifecycleGuards(bindings: SessionRuntimeBindings) {
  const {api, screen, refs} = bindings;

  useEffect(() => {
    const onPageHide = () => {
      if (refs.finishingRef.current || refs.tabBeaconSentRef.current) return;
      const activeSession = refs.sessionRef.current;
      if (!activeSession || screen !== 'play') return;
      refs.tabBeaconSentRef.current = true;
      api.notifySessionTimeout(activeSession.sessionId);
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
      if (Date.now() - hiddenSince < 90_000) return;
      hiddenSince = undefined;
      refs.tabBeaconSentRef.current = true;
      api.notifySessionTimeout(activeSession.sessionId);
    }, 5_000);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
  }, [screen]);
}
