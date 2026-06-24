import type {Bindings} from '../types.js';
import {HttpError, jsonOk} from '../http/response.js';
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
