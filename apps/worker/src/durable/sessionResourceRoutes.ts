import type {Bindings} from '../types.js';
import {jsonOk, roleRequiredResponse} from '../http/response.js';
import {readInternalJsonObject} from '../http/body.js';
import {
  canOperateSandbox,
  type StoredExerciseRoom,
} from '../pure/exerciseRoom.js';
import {requireScenario} from './sessionExerciseHandlers.js';
import {
  readSessionFileContent,
  readSessionFiles,
  readSessionLogs,
  readSessionMetrics,
  readSessionStorage,
  writeSessionFileContent,
  type MetricsCache,
} from './sessionResourceHandlers.js';
import type {StoredSession} from './sessionState.js';
import {
  handleSessionTerminalInterrupt,
  handleSessionTerminalRequest,
  mergeTerminalResize,
  type TerminalDimensions,
} from './sessionTerminalHandlers.js';

const SESSION_CONTROL_BODY_MAX_BYTES = 8 * 1024;
const SESSION_FILE_BODY_MAX_BYTES = 1024 * 1024;

export interface SessionResourceDeps {
  env: Bindings;
  requireSession: () => Promise<StoredSession>;
  requireRunningSession: (message: string) => Promise<StoredSession>;
  loadExerciseRoom: (session: StoredSession) => Promise<StoredExerciseRoom>;
  touchClientActivity: () => Promise<void>;
}

/**
 * Groups the session's read-only resource routes (metrics/logs/storage/
 * files) together with the sandbox interaction routes (terminal/
 * terminalResize/terminalInterrupt) that gate on the same
 * canOperateSandbox role check. Extracted from SessionDurableObject as a
 * dependency-injected hub, mirroring SessionExerciseHub — the DO wires
 * this up once in its constructor and dispatchSessionRoute calls straight
 * through to it.
 */
export class SessionResourceHub {
  private metricsCache: MetricsCache = {cachedAt: 0};
  private terminalDimensions: TerminalDimensions = {cols: 80, rows: 24};

  constructor(private readonly deps: SessionResourceDeps) {}

  clearMetricsCache() {
    this.metricsCache = {cachedAt: 0};
  }

  async metrics() {
    const session = await this.deps.requireSession();
    const scenario = requireScenario(session.scenarioId);
    const response = await readSessionMetrics(
      this.deps.env,
      session,
      this.metricsCache,
      scenario
    );
    await this.deps.touchClientActivity();
    return response;
  }

  async logs(request: Request) {
    const session = await this.deps.requireSession();
    return readSessionLogs(this.deps.env, session, request);
  }

  async storage() {
    const session = await this.deps.requireSession();
    return readSessionStorage(this.deps.env, session);
  }

  async files() {
    const session = await this.deps.requireRunningSession(
      'files are only available while the session is running'
    );
    const response = await readSessionFiles(this.deps.env, session);
    await this.deps.touchClientActivity();
    return response;
  }

  async readFile(request: Request) {
    const session = await this.deps.requireRunningSession(
      'files are only available while the session is running'
    );
    const response = await readSessionFileContent(
      this.deps.env,
      session,
      request
    );
    await this.deps.touchClientActivity();
    return response;
  }

  async writeFile(request: Request) {
    const session = await this.deps.requireRunningSession(
      'files are only available while the session is running'
    );
    const body = (await readInternalJsonObject(
      request,
      SESSION_FILE_BODY_MAX_BYTES
    )) as {path?: unknown; content?: unknown; participantId?: unknown};
    const denied = await this.denySandboxOperation(
      session,
      typeof body.participantId === 'string' ? body.participantId : undefined
    );
    if (denied) return denied;
    const response = await writeSessionFileContent(
      this.deps.env,
      session,
      body
    );
    await this.deps.touchClientActivity();
    return response;
  }

  /**
   * Returns a 403 response when the participant may not operate the
   * sandbox (terminal resize, editor writes); undefined when allowed.
   * Terminal *input* is gated separately, inside terminal()'s own
   * operate check (see its comment) rather than here — that gate has to
   * be evaluated once at WebSocket-connect time, not per discrete REST
   * call like this one. The `ops` role in the payload stands for the
   * allowed set (ops or facilitator) — see canOperateSandbox.
   */
  async denySandboxOperation(
    session: StoredSession,
    participantId: string | undefined
  ) {
    const room = await this.deps.loadExerciseRoom(session);
    const decision = canOperateSandbox(room, participantId);
    return decision.allowed ? undefined : roleRequiredResponse('ops');
  }

  async terminal(request: Request) {
    const session = await this.deps.requireSession();
    const room = await this.deps.loadExerciseRoom(session);
    await this.deps.touchClientActivity();
    // Operate decision, hot-path pass-through vs. read-only relay, and
    // the server-side enforcement rationale all live in
    // handleSessionTerminalRequest (sessionTerminalHandlers.ts) — see its
    // doc comment.
    return handleSessionTerminalRequest(
      this.deps.env,
      session,
      request,
      this.terminalDimensions,
      room
    );
  }

  async terminalResize(request: Request) {
    const session = await this.deps.requireSession();
    const body = (await readInternalJsonObject(
      request,
      SESSION_CONTROL_BODY_MAX_BYTES
    )) as {cols?: number; rows?: number; participantId?: unknown};
    const denied = await this.denySandboxOperation(
      session,
      typeof body.participantId === 'string' ? body.participantId : undefined
    );
    if (denied) return denied;
    this.terminalDimensions = mergeTerminalResize(
      this.terminalDimensions,
      body
    );
    return jsonOk(this.terminalDimensions);
  }

  async terminalInterrupt() {
    const session = await this.deps.requireSession();
    return handleSessionTerminalInterrupt(this.deps.env, session);
  }
}
