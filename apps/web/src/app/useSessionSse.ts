import {useEffect} from 'preact/hooks';
import {replayEventSummary} from '@incident/shared';
import {isTimelineEventType} from '../replay/replayMediaUtils.js';
import type {SessionRuntimeBindings} from './sessionRuntimeTypes.js';

export function useSessionSse(bindings: SessionRuntimeBindings) {
  const {api, screen, session, refs, setTimeline, applyClockSnapshot} =
    bindings;

  useEffect(() => {
    if (screen !== 'play' || !session) return;
    const source = api.subscribeSessionEvents(session.sessionId, {
      onSnapshot: applyClockSnapshot,
      onReplay: (event) => {
        if (
          refs.liveReplayEventIdsRef.current.has(event.id) ||
          !isTimelineEventType(event.type)
        ) {
          return;
        }
        refs.liveReplayEventIdsRef.current.add(event.id);
        setTimeline((items) => [
          ...items,
          {at: event.at / 1000, label: replayEventSummary(event)},
        ]);
      },
      onError: console.error,
    });
    return () => {
      source.close();
    };
  }, [screen, session?.sessionId]);
}
