import type {Bindings} from '../types.js';
import {HttpError, jsonOk} from '../http/response.js';
import {INTERNAL_WRITE_ACCESS_HEADER} from '../http/sessionProxyRequest.js';
import {
  canOperateSandbox,
  type StoredExerciseRoom,
} from '../pure/exerciseRoom.js';
import {
  classifyClientToSandboxFrame,
  shouldForwardClientToSandboxFrame,
} from '../pure/terminalRelayPolicy.js';
import {
  interruptSessionTerminal,
  proxySessionTerminal,
} from '../sandbox/runtime.js';
import type {StoredSession} from './sessionState.js';
import type {TerminalDimensions} from '../pure/sessionTerminalResize.js';

export type {TerminalDimensions} from '../pure/sessionTerminalResize.js';
export {
  mergeTerminalResize,
  parseTerminalResize,
} from '../pure/sessionTerminalResize.js';

export async function handleSessionTerminal(
  env: Bindings,
  session: StoredSession,
  request: Request,
  dimensions: TerminalDimensions
) {
  return proxySessionTerminal(env, session.sessionId, request, dimensions);
}

/**
 * Entry point for SessionResourceHub.terminal(): decides operate access
 * and returns either the raw sandbox WS pass-through or a read-only
 * relay of it. `room` must already reflect the current session (the
 * caller loads/creates it via SessionExerciseHub before calling this, and
 * is also responsible for requireSession()/touchClientActivity()).
 *
 * Server-side enforcement: sessionRoutes.ts's ws/terminal route verifies
 * session read access, separately checks the same tokens for a *valid
 * write token*, strips any client-supplied x-incident-write-access
 * header, and re-adds it itself — so it cannot be forged by the
 * connecting client. `operate` below also requires the connecting
 * participant to satisfy canOperateSandbox (ops/facilitator role, or a
 * solo session), the same predicate terminalResize/writeFile gate on and
 * that apps/web/src/pure/rolePermissions.ts mirrors client-side.
 *
 * When operate is true, proxySessionTerminal's raw WS pass-through is
 * returned unchanged (hot path, unaffected by this gate). When it is
 * false, the pass-through response is wrapped by
 * createReadOnlyTerminalRelay instead of being returned directly: the
 * sandbox -> client output mirror still flows to every role
 * (Observer/Scribe watch along), but client -> sandbox input frames are
 * classified and dropped — see terminalRelayPolicy.ts. This operate
 * decision is evaluated once at connect time; a role change (e.g.
 * demotion from ops) only takes effect on the next reconnect, not
 * retroactively on an already-open socket.
 */
export async function handleSessionTerminalRequest(
  env: Bindings,
  session: StoredSession,
  request: Request,
  dimensions: TerminalDimensions,
  room: StoredExerciseRoom
) {
  const hasWriteAccess =
    request.headers.get(INTERNAL_WRITE_ACCESS_HEADER) === '1';
  const participantId =
    new URL(request.url).searchParams.get('participantId') ?? undefined;
  const operate =
    hasWriteAccess && canOperateSandbox(room, participantId).allowed;
  const response = await handleSessionTerminal(
    env,
    session,
    request,
    dimensions
  );
  return operate ? response : createReadOnlyTerminalRelay(response);
}

/**
 * Wraps a passthrough sandbox terminal WebSocket response so that frames
 * traveling client -> sandbox are filtered rather than relayed verbatim.
 * Used by SessionDurableObject.terminal() when the connecting participant
 * does not have sandbox operate access: sandbox -> client output keeps
 * flowing unmodified (every role, including read-only observers, watches
 * the shared PTY mirror), but every client -> sandbox frame is classified
 * via terminalRelayPolicy.ts and dropped unless explicitly allowlisted —
 * which today means all stdin/resize input is dropped. Close/error on
 * either socket propagates to the other so neither end is left dangling.
 */
export function createReadOnlyTerminalRelay(response: Response): Response {
  const sandboxSocket = response.webSocket;
  if (!sandboxSocket) return response;
  sandboxSocket.accept();

  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.accept();

  sandboxSocket.addEventListener('message', (event) => {
    sendQuietly(server, messageData(event), sandboxSocket);
  });
  sandboxSocket.addEventListener('close', (event) => {
    closeQuietly(server, event.code, event.reason);
  });
  sandboxSocket.addEventListener('error', () => {
    closeQuietly(server, 1011, 'sandbox socket error');
  });

  server.addEventListener('message', (event) => {
    const data = messageData(event);
    const kind = classifyClientToSandboxFrame(data);
    if (shouldForwardClientToSandboxFrame(kind, false)) {
      sendQuietly(sandboxSocket, data, server);
    }
  });
  server.addEventListener('close', (event) => {
    closeQuietly(sandboxSocket, event.code, event.reason);
  });
  server.addEventListener('error', () => {
    closeQuietly(sandboxSocket, 1011, 'client socket error');
  });

  return new Response(null, {status: 101, webSocket: client});
}

// MessageEvent#data is typed `any` in the ambient WebSocket lib; workerd
// WebSocket messages are always a string or ArrayBuffer (binaryType is
// fixed, there is no Blob support), so this narrows it once instead of
// passing an implicit `any` into typed relay/send calls.
function messageData(event: MessageEvent): string | ArrayBuffer {
  return event.data as string | ArrayBuffer;
}

function closeQuietly(socket: WebSocket, code?: number, reason?: string) {
  try {
    socket.close(code, reason);
  } catch {
    // Already closed by the other side of this bridge; nothing to do.
  }
}

// A message can arrive after the *other* end of the bridge has already
// closed (e.g. the sandbox socket closes mid-flight while a client
// message is in transit): `send()` on a closed WebSocket throws, and
// since this runs inside an event listener an uncaught throw here would
// be an unhandled exception rather than a normal error path. Mirrors
// closeQuietly's story below — swallow the failure and tear down both
// ends of the bridge instead so nothing is left half-open.
function sendQuietly(
  socket: WebSocket,
  data: string | ArrayBuffer,
  peer: WebSocket
) {
  try {
    socket.send(data);
  } catch {
    closeQuietly(socket);
    closeQuietly(peer);
  }
}

export async function handleSessionTerminalInterrupt(
  env: Bindings,
  session: StoredSession
) {
  if (session.status !== 'running') {
    throw new HttpError(
      409,
      'invalid_state',
      'terminal interrupt is only available while the session is running'
    );
  }
  await interruptSessionTerminal(env, session.sessionId);
  return jsonOk({interrupted: true});
}
