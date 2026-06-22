import {useEffect} from 'preact/hooks';
import {ReplayEventEmitter} from '../game/events/emitReplayEvent.js';
import {toErrorMessage} from './appUtils.js';
import type {SessionRuntimeBootstrapOptions} from './sessionRuntimeTypes.js';

export function useSessionBootstrap(options: SessionRuntimeBootstrapOptions) {
  const {
    api,
    deepLinkReplayId,
    deepLinkValidated,
    setScenarios,
    setAppError,
    setTimeline,
    setDeepLinkReplayId,
    setDeepLinkValidated,
    setScreen,
    refs,
  } = options;

  useEffect(() => {
    api
      .listScenarios()
      .then(setScenarios)
      .catch((error: unknown) => {
        setAppError(toErrorMessage(error));
      });
    refs.eventEmitterRef.current = new ReplayEventEmitter(api, (at, label) => {
      setTimeline((items) => [...items, {at, label}]);
    });
  }, []);

  useEffect(() => {
    if (!deepLinkReplayId || deepLinkValidated) return;
    let cancelled = false;
    api
      .getReplay(deepLinkReplayId)
      .then(() => {
        if (cancelled) return;
        setDeepLinkValidated(true);
        setScreen('replay');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setAppError(toErrorMessage(error));
        setDeepLinkReplayId(undefined);
        setDeepLinkValidated(true);
        setScreen('select');
      });
    return () => {
      cancelled = true;
    };
  }, [deepLinkReplayId, deepLinkValidated]);
}
