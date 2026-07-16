import {useEffect, useRef} from 'preact/hooks';
import {
  buildParticipantGuardPingMessage,
  buildParticipantGuardPongMessage,
  isParticipantGuardPingMessage,
  isParticipantGuardPongMessage,
  participantGuardChannelName,
} from '../pure/participantIdentityGuard.js';

/**
 * Detects when this tab's participantId collides with another tab of the
 * same browser (e.g. Chrome's "Duplicate tab", which copies sessionStorage
 * verbatim, producing two clients that both drive the same participant's
 * cursor). Pings a BroadcastChannel named after the participantId whenever
 * it changes; if another tab is listening on the same channel, it replies
 * and this tab asks the caller to mint a fresh participantId via
 * onCollision (the caller is responsible for persisting it and rejoining —
 * see App.tsx's regenerateParticipantId).
 */
export function useParticipantIdentityGuard(options: {
  participantId: string;
  onCollision: () => void;
}) {
  const {participantId, onCollision} = options;
  const onCollisionRef = useRef(onCollision);
  onCollisionRef.current = onCollision;

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(
      participantGuardChannelName(participantId)
    );
    let collided = false;
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (isParticipantGuardPingMessage(event.data)) {
        channel.postMessage(
          buildParticipantGuardPongMessage(event.data.requestId)
        );
        return;
      }
      if (isParticipantGuardPongMessage(event.data) && !collided) {
        collided = true;
        onCollisionRef.current();
      }
    };
    channel.postMessage(buildParticipantGuardPingMessage(crypto.randomUUID()));
    return () => {
      channel.close();
    };
  }, [participantId]);
}
