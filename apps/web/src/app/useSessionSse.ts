import {useEffect, useRef, useState} from 'preact/hooks';
import {replayEventSummary} from '@incident/shared';
import {isTimelineEventType} from '../replay/replayMediaUtils.js';
import {
  isSseEligibleScreen,
  sseReconnectDelayMs,
  sseStatusForReadyState,
  type SseConnectionStatus,
} from '../pure/sseConnection.js';
import type {SessionRuntimeBindings} from './sessionRuntimeTypes.js';

/**
 * Owns the session SSE subscription. The connection is keyed on
 * sessionId (not screen): moving between lobby/briefing/play/result/hotwash
 * keeps the same EventSource alive instead of closing and reopening it on
 * every screen transition. Handlers are read from a ref updated on every
 * render so the long-lived effect doesn't need them as dependencies.
 *
 * If the connection reaches readyState CLOSED (the browser stops
 * auto-retrying after an HTTP error response), an exponential backoff loop
 * recreates the EventSource. reconnect() lets the UI force an immediate
 * retry, resetting the backoff.
 */
export function useSessionSse(bindings: SessionRuntimeBindings) {
  const {
    api,
    screen,
    session,
    refs,
    setTimeline,
    applyClockSnapshot,
    applyExerciseSnapshot,
    applyParticipantCursor,
    rtcSignalHandlerRef,
  } = bindings;

  const [status, setStatus] = useState<SseConnectionStatus>('connecting');

  const handlersRef = useRef({
    setTimeline,
    applyClockSnapshot,
    applyExerciseSnapshot,
    applyParticipantCursor,
  });
  handlersRef.current = {
    setTimeline,
    applyClockSnapshot,
    applyExerciseSnapshot,
    applyParticipantCursor,
  };

  const reconnectRef = useRef<() => void>(() => {});
  const eligible = Boolean(session) && isSseEligibleScreen(screen);

  useEffect(() => {
    if (!eligible || !session) {
      setStatus('closed');
      return;
    }
    const sessionId = session.sessionId;
    let cancelled = false;
    let source: EventSource | undefined;
    let hasOpenedBefore = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (cancelled) return;
      setStatus(hasOpenedBefore ? 'reconnecting' : 'connecting');
      source = api.subscribeSessionEvents(sessionId, {
        onSnapshot: (snapshot) =>
          handlersRef.current.applyClockSnapshot(snapshot),
        onExercise: (snapshot) =>
          handlersRef.current.applyExerciseSnapshot(snapshot),
        onCursor: (event) => handlersRef.current.applyParticipantCursor(event),
        onReplay: (event) => {
          if (
            refs.liveReplayEventIdsRef.current.has(event.id) ||
            !isTimelineEventType(event.type)
          ) {
            return;
          }
          refs.liveReplayEventIdsRef.current.add(event.id);
          handlersRef.current.setTimeline((items) => [
            ...items,
            {at: event.at / 1000, label: replayEventSummary(event)},
          ]);
        },
        onRtcSignal: (data) => rtcSignalHandlerRef.current?.(data),
        onError: (event) => {
          console.error(event);
          if (cancelled || !source) return;
          const readyState = source.readyState as 0 | 1 | 2;
          setStatus(sseStatusForReadyState(readyState, hasOpenedBefore));
          if (readyState !== 2) return;
          // readyState CLOSED: the browser gave up auto-retrying (typically
          // an HTTP error response). Recreate the connection ourselves with
          // exponential backoff.
          const delay = sseReconnectDelayMs(attempt);
          attempt += 1;
          timer = setTimeout(() => {
            if (cancelled) return;
            source?.close();
            connect();
          }, delay);
        },
      });
      source.addEventListener('open', () => {
        if (cancelled) return;
        hasOpenedBefore = true;
        attempt = 0;
        setStatus('open');
      });
    };

    reconnectRef.current = () => {
      if (cancelled) return;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      attempt = 0;
      source?.close();
      connect();
    };

    connect();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      source?.close();
      reconnectRef.current = () => {};
    };
  }, [eligible, session?.sessionId]);

  return {
    status,
    reconnect: () => reconnectRef.current(),
  };
}
