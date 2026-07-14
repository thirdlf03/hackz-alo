import {
  type ReplayEvent,
  type ScenarioDefinition,
  type SessionStatus,
} from '@incident/shared';
import {
  INCIDENT_ATTRS,
  INCIDENT_SPAN_NAMES,
  withWorkerSpan,
} from '@incident/observability/worker';
import {readInternalJsonObject} from '../http/body.js';
import {
  errorResponse,
  HttpError,
  hostRequiredResponse,
  jsonErr,
  jsonOk,
  messageFrom,
  participantsNotReadyResponse,
  roleRequiredResponse,
} from '../http/response.js';
import {logStructured} from '../http/requestLog.js';
import type {Bindings} from '../types.js';
import {emitSessionReplayEvent} from './sessionEventEmit.js';
import {finishSessionTransaction} from './sessionFinish.js';
import {
  BRIEFING_TIMEOUT_MS,
  clearSessionLifecycleAlarms,
  handleSessionAlarm,
  scheduleSessionLifecycleAlarms,
  touchSessionClientActivity,
} from './sessionLifecycle.js';
import {persistReplayStart, persistSession} from './sessionPersistence.js';
import {handleSessionRtcSignal} from './sessionRtc.js';
import {handleSessionPagerEvent} from './sessionPagerEvents.js';
import {resolveSessionAction} from './sessionResolve.js';
import {
  readSessionFileContent,
  readSessionFiles,
  readSessionLogs,
  readSessionMetrics,
  readSessionStorage,
  writeSessionFileContent,
  type MetricsCache,
} from './sessionResourceHandlers.js';
import {
  areParticipantsReadyToStart,
  canOperateSandbox,
  canPerformRoleGatedAction,
  setExercisePhase,
} from '../pure/exerciseRoom.js';
import {
  requireScenario,
  SessionExerciseHub,
} from './sessionExerciseHandlers.js';
import {dispatchSessionRoute, matchSessionRoute} from './sessionRouter.js';
import {
  buildClockPayload,
  buildSessionSnapshot,
  createBriefingSession,
  getGameTimeMs,
  isTerminalStatus,
  startStoredSession,
  type SessionBootstrap,
  type StoredSession,
} from './sessionState.js';
import {SessionSseHub} from './sessionSseHub.js';
import {SessionTimeline} from './sessionTimeline.js';
import {
  handleSessionTerminalInterrupt,
  handleSessionTerminalRequest,
  mergeTerminalResize,
  type TerminalDimensions,
} from './sessionTerminalHandlers.js';
import {
  destroySessionSandbox,
  injectFault,
  prepareScenarioSandbox,
  startScenarioSandbox,
  type SandboxPrepareResult,
} from '../sandbox/runtime.js';

const SESSION_BOOTSTRAP_BODY_MAX_BYTES = 8 * 1024;
const SESSION_CONTROL_BODY_MAX_BYTES = 8 * 1024;
const SESSION_FILE_BODY_MAX_BYTES = 1024 * 1024;
// Short TTL: only meant to absorb near-simultaneous double-fires of
// prepareSandbox (server-scheduled prepare + client-triggered prepare),
// not to serve as a long-lived cache — the sandbox container itself can
// sleep after ~16 minutes of inactivity, so a longer TTL risks the DO's
// in-memory cache drifting from the container's actual state.
const SANDBOX_PREPARE_CACHE_TTL_MS = 60 * 1000;

export class SessionDurableObject implements DurableObject {
  private metricsCache: MetricsCache = {cachedAt: 0};
  private timeline: SessionTimeline;
  private sseHub: SessionSseHub;
  private exercise: SessionExerciseHub;
  private sandboxPreparePromise?: Promise<SandboxPrepareResult>;
  private sandboxPrepareCache?: {
    result: SandboxPrepareResult;
    expiresAt: number;
  };
  private terminalDimensions: TerminalDimensions = {cols: 80, rows: 24};
  private lastAlertPagerSentAt = 0;

  constructor(
    private state: DurableObjectState,
    private env: Bindings
  ) {
    this.sseHub = new SessionSseHub({
      loadSnapshot: async () => await this.snapshot(),
      loadReplayBuffer: async () =>
        (await this.requireSession()).bufferedEvents.slice(-50),
      loadExerciseSnapshot: async () =>
        await this.exercise.snapshot(await this.requireSession()),
      touchClientActivity: async () => {
        await this.touchClientActivity();
      },
      onClientClose: async () => {
        await this.rescheduleIdleAlarm();
      },
    });
    this.exercise = new SessionExerciseHub({
      env: this.env,
      storage: this.state.storage,
      sseHub: this.sseHub,
      requireSession: () => this.requireSession(),
    });
    this.timeline = new SessionTimeline({
      loadSession: () => this.requireSession(),
      saveSession: async (session) => {
        await this.state.storage.put('session', session);
      },
      injectFault: async (sessionId, type, params) => {
        await injectFault(this.env, sessionId, type, params);
      },
      emit: (session, type, at, actor, payload) =>
        this.emit(session, type, at, actor, payload),
      snapshotFor: (session) => this.snapshotFor(session),
      broadcastSse: (event, data) => {
        this.sseHub.broadcast(event, data);
      },
      onPagerEvent: (session, event) => {
        this.lastAlertPagerSentAt = handleSessionPagerEvent(
          this.env,
          session,
          event,
          this.lastAlertPagerSentAt
        );
      },
      fireScheduledInject: async (injectId) => {
        const session = await this.requireSession();
        await this.exercise.fireScheduledInject(session, injectId);
      },
    });
  }

  async alarm() {
    await handleSessionAlarm({
      storage: this.state.storage,
      sseHubSize: this.sseHub.size,
      getSession: async () =>
        await this.state.storage.get<StoredSession>('session'),
      requireScenario,
      handlers: {
        deleteSession: async () => {
          await this.deleteSession();
        },
        timeout: async () => {
          await this.timeout();
        },
        scheduleLifecycleAlarms: (session, scenario) =>
          this.scheduleLifecycleAlarms(session, scenario),
      },
    });
  }

  async fetch(request: Request): Promise<Response> {
    const action = matchSessionRoute(request) ?? 'unknown';
    return await withWorkerSpan(
      this.env,
      INCIDENT_SPAN_NAMES.doRequest,
      {
        [INCIDENT_ATTRS.doAction]: action,
        [INCIDENT_ATTRS.httpMethod]: request.method,
      },
      async (span) => {
        try {
          const response = await dispatchSessionRoute(request, {
            bootstrap: (req) => this.bootstrap(req),
            prepare: (req) => this.prepare(req),
            start: (req) => this.start(req),
            resolve: () => this.resolve(),
            retire: () => this.retire(),
            timeout: () => this.timeout(),
            delete: () => this.deleteSession(),
            updateClock: (req) => this.updateClock(req),
            terminalResize: (req) => this.terminalResize(req),
            events: (req) => this.events(req),
            clock: async () =>
              jsonOk(this.clockPayload(await this.requireSession())),
            metrics: () => this.metrics(),
            logs: (req) => this.logs(req),
            storage: () => this.storage(),
            files: () => this.files(),
            readFile: (req) => this.readFile(req),
            writeFile: (req) => this.writeFile(req),
            terminal: (req) => this.terminal(req),
            terminalInterrupt: () => this.terminalInterrupt(),
            participantJoin: (req) => this.exercise.participantJoin(req),
            participantHeartbeat: (req) =>
              this.exercise.participantHeartbeat(req),
            participantCursor: (req) => this.exercise.participantCursor(req),
            participantRole: (req) => this.exercise.participantRole(req),
            participantLeave: (req) => this.exercise.participantLeave(req),
            exerciseState: () => this.exercise.state(),
            exerciseReady: (req) => this.exercise.ready(req),
            taskCreate: (req) => this.exercise.taskCreate(req),
            taskUpdate: (req) => this.exercise.taskUpdate(req),
            taskDelete: (req) => this.exercise.taskDelete(req),
            injectFire: (req) => this.exercise.injectFire(req),
            exercisePhase: (req) => this.exercise.phaseAdvance(req),
            incidentLog: (req) => this.exercise.incidentLog(req),
            incidentLogUpdate: (req) => this.exercise.incidentLogUpdate(req),
            incidentLogDelete: (req) => this.exercise.incidentLogDelete(req),
            hotwash: (req) => this.exercise.hotwash(req),
            aar: () => this.exercise.aar(),
            rtcSignal: (req) => this.rtcSignal(req),
            snapshot: async () => jsonOk(await this.snapshot()),
          });
          if (response) {
            span.setAttribute(INCIDENT_ATTRS.httpStatusCode, response.status);
            return response;
          }
          span.setAttribute(INCIDENT_ATTRS.httpStatusCode, 404);
          return jsonErr('not_found', 'session action not found', 404);
        } catch (error) {
          const response = errorResponse(error);
          span.setAttribute(INCIDENT_ATTRS.httpStatusCode, response.status);
          throw error;
        }
      },
      request.headers.get('traceparent') ?? undefined
    ).catch((error: unknown) => errorResponse(error));
  }

  private async bootstrap(request: Request) {
    const body = (await readBootstrap(request)) as Partial<SessionBootstrap> & {
      participantId?: string;
    };
    const session = await this.loadOrCreate(body);
    await this.state.storage.put('session', session);
    await persistSession(this.env, session);
    if (session.status === 'briefing') {
      await this.state.storage.setAlarm(Date.now() + BRIEFING_TIMEOUT_MS);
    }
    await this.exercise.loadOrCreate(
      session,
      typeof body.participantId === 'string' ? body.participantId : undefined
    );
    return jsonOk({session: this.snapshotFor(session)});
  }

  private async prepare(request: Request) {
    const session = await this.loadOrCreate(await readBootstrap(request));
    await this.state.storage.put('session', session);
    if (isTerminalStatus(session.status)) {
      return jsonOk({prepared: false, status: session.status});
    }
    const scenario = requireScenario(session.scenarioId);
    const startedAt = Date.now();
    const result = await this.prepareSandbox(session, scenario);
    logStructured('session_prepared', {
      sessionId: session.sessionId,
      scenarioId: scenario.id,
      reused: result.reused,
      durationMs: Date.now() - startedAt,
    });
    return jsonOk(result);
  }

  private async start(request: Request) {
    const body = (await readBootstrap(request)) as Partial<SessionBootstrap> & {
      originUrl?: string;
      participantId?: string;
    };
    const session = await this.loadOrCreate(body);
    if (session.status === 'running') {
      return jsonOk({session: this.snapshotFor(session), startup: []});
    }
    if (isTerminalStatus(session.status)) {
      throw new HttpError(
        409,
        'invalid_state',
        `session is already ${session.status}`
      );
    }

    const room = await this.exercise.loadOrCreate(session);
    const participantId =
      typeof body.participantId === 'string' ? body.participantId : undefined;
    const hostDecision = canPerformRoleGatedAction(room, participantId);
    if (!hostDecision.allowed) {
      return hostRequiredResponse();
    }
    if (!areParticipantsReadyToStart(room)) {
      return participantsNotReadyResponse();
    }

    const scenario = requireScenario(session.scenarioId);
    const started = new Date().toISOString();
    let running = startStoredSession(session, started, Date.now());
    if (typeof body.originUrl === 'string' && body.originUrl.length > 0) {
      running = {...running, pagerOriginUrl: body.originUrl};
    }
    await this.state.storage.put('session', running);
    await persistSession(this.env, running);
    await persistReplayStart(this.env, running);

    let startup: Awaited<ReturnType<typeof startScenarioSandbox>>;
    try {
      await this.prepareSandbox(running, scenario);
      startup = await startScenarioSandbox(
        this.env,
        running.sessionId,
        scenario
      );
    } catch (error) {
      const failed = await this.finishSession(running, 'failed', 'failed');
      await this.emit(
        failed,
        'sandbox_error',
        getGameTimeMs(failed),
        'sandbox',
        {
          message: messageFrom(error),
        }
      );
      throw new HttpError(502, 'sandbox_start_failed', messageFrom(error));
    }

    running = await this.emit(running, 'session_start', 0, 'system', {
      scenarioId: scenario.id,
      startup,
    });
    const runningExerciseSnapshot = await this.exercise.save(
      running,
      setExercisePhase(room, 'running')
    );
    this.sseHub.broadcast('exercise_state', runningExerciseSnapshot);
    await this.touchClientActivity();
    const firedInjectIds = room.injects
      .filter((inject) => inject.fired)
      .map((inject) => inject.id);
    this.timeline.schedule(running, scenario, firedInjectIds);
    return jsonOk({session: this.snapshotFor(running), startup});
  }

  private async resolve() {
    const session = await this.requireSession();
    return resolveSessionAction(session, {
      env: this.env,
      finishSession: (target, status, result) =>
        this.finishSession(target, status, result),
      emit: (target, type, at, actor, payload) =>
        this.emit(target, type, at, actor, payload),
      snapshotFor: (target) => this.snapshotFor(target),
      broadcast: (event, data) => {
        this.sseHub.broadcast(event, data);
      },
    });
  }

  private async retire() {
    const session = await this.requireSession();
    const retired = await this.finishSession(session, 'retired', 'retired');
    const result = await this.emit(
      retired,
      'session_end',
      getGameTimeMs(retired),
      'player',
      {result: 'retired'}
    );
    return jsonOk({session: this.snapshotFor(result)});
  }

  private async timeout() {
    const session = await this.requireSession();
    if (isTerminalStatus(session.status)) {
      await destroySessionSandbox(this.env, session.sessionId);
      return jsonOk({session: this.snapshotFor(session)});
    }
    const finished = await this.finishSession(session, 'failed', 'timeout');
    const result = await this.emit(
      finished,
      'session_end',
      getGameTimeMs(finished),
      'system',
      {result: 'timeout'}
    );
    return jsonOk({session: this.snapshotFor(result)});
  }

  private async deleteSession() {
    const session = await this.requireSession();
    const aborted = await this.finishSession(session, 'aborted', 'aborted');
    return jsonOk({session: this.snapshotFor(aborted)});
  }

  private async updateClock(request: Request) {
    const session = await this.requireSession();
    if (session.status !== 'running') {
      throw new HttpError(
        409,
        'invalid_state',
        'clock updates require a running session'
      );
    }
    const body = (await readInternalJsonObject(
      request,
      SESSION_CONTROL_BODY_MAX_BYTES
    )) as {speed?: number};
    const speed =
      typeof body.speed === 'number' && body.speed > 0 && body.speed <= 8
        ? body.speed
        : session.gameSpeed;
    const synced: StoredSession = {
      ...session,
      gameTimeMs: getGameTimeMs(session),
      gameSpeed: speed,
      gameClockWallMs: Date.now(),
    };
    await this.state.storage.put('session', synced);
    const scenario = requireScenario(synced.scenarioId);
    const room = await this.exercise.loadOrCreate(synced);
    const firedInjectIds = room.injects
      .filter((inject) => inject.fired)
      .map((inject) => inject.id);
    this.timeline.reschedule(synced, scenario, firedInjectIds);
    await this.touchClientActivity();
    return jsonOk(this.clockPayload(synced));
  }

  private async events(request: Request) {
    await this.requireSession();
    return this.sseHub.response(request);
  }

  private async rtcSignal(request: Request) {
    const session = await this.requireSession();
    return handleSessionRtcSignal(request, session.sessionId, this.sseHub);
  }

  private async terminal(request: Request) {
    const session = await this.requireSession();
    const room = await this.exercise.loadOrCreate(session);
    await this.touchClientActivity();
    // Operate decision, hot-path pass-through vs. read-only relay, and
    // the server-side enforcement rationale all live in
    // handleSessionTerminalRequest (sessionTerminalHandlers.ts) — see its
    // doc comment.
    return handleSessionTerminalRequest(
      this.env,
      session,
      request,
      this.terminalDimensions,
      room
    );
  }

  private async terminalResize(request: Request) {
    const session = await this.requireSession();
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

  private async terminalInterrupt() {
    const session = await this.requireSession();
    return handleSessionTerminalInterrupt(this.env, session);
  }

  private async metrics() {
    const session = await this.requireSession();
    const scenario = requireScenario(session.scenarioId);
    const response = await readSessionMetrics(
      this.env,
      session,
      this.metricsCache,
      scenario
    );
    await this.touchClientActivity();
    return response;
  }

  private async logs(request: Request) {
    const session = await this.requireSession();
    return readSessionLogs(this.env, session, request);
  }

  private async storage() {
    const session = await this.requireSession();
    return readSessionStorage(this.env, session);
  }

  private async files() {
    const session = await this.requireRunningSession(
      'files are only available while the session is running'
    );
    const response = await readSessionFiles(this.env, session);
    await this.touchClientActivity();
    return response;
  }

  private async readFile(request: Request) {
    const session = await this.requireRunningSession(
      'files are only available while the session is running'
    );
    const response = await readSessionFileContent(this.env, session, request);
    await this.touchClientActivity();
    return response;
  }

  private async writeFile(request: Request) {
    const session = await this.requireRunningSession(
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
    const response = await writeSessionFileContent(this.env, session, body);
    await this.touchClientActivity();
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
  private async denySandboxOperation(
    session: StoredSession,
    participantId: string | undefined
  ) {
    const room = await this.exercise.loadOrCreate(session);
    const decision = canOperateSandbox(room, participantId);
    return decision.allowed ? undefined : roleRequiredResponse('ops');
  }

  private clearMetricsCache() {
    this.metricsCache = {cachedAt: 0};
  }

  private async snapshot() {
    const session = await this.requireSession();
    return this.snapshotFor(session);
  }

  private snapshotFor(session: StoredSession) {
    return buildSessionSnapshot(session, requireScenario(session.scenarioId));
  }

  private clockPayload(session: StoredSession) {
    return buildClockPayload(session, requireScenario(session.scenarioId));
  }

  private async loadOrCreate(
    input: Partial<SessionBootstrap>
  ): Promise<StoredSession> {
    const existing = await this.state.storage.get<StoredSession>('session');
    if (existing) return existing;
    if (!input.sessionId || !input.replayId || !input.scenarioId) {
      throw new HttpError(
        400,
        'bad_request',
        'missing session bootstrap fields'
      );
    }
    return createBriefingSession({
      sessionId: input.sessionId,
      replayId: input.replayId,
      scenarioId: input.scenarioId,
    });
  }

  private async requireSession() {
    const session = await this.state.storage.get<StoredSession>('session');
    if (!session) {
      throw new HttpError(
        409,
        'session_not_initialized',
        'session not initialized'
      );
    }
    return session;
  }

  private prepareSandbox(
    session: StoredSession,
    scenario: ScenarioDefinition
  ): Promise<SandboxPrepareResult> {
    if (
      this.sandboxPrepareCache &&
      this.sandboxPrepareCache.expiresAt > Date.now()
    ) {
      return Promise.resolve(this.sandboxPrepareCache.result);
    }
    this.sandboxPreparePromise ??= prepareScenarioSandbox(
      this.env,
      session.sessionId,
      scenario
    )
      .then((result) => {
        this.sandboxPrepareCache = {
          result,
          expiresAt: Date.now() + SANDBOX_PREPARE_CACHE_TTL_MS,
        };
        return result;
      })
      .finally(() => {
        delete this.sandboxPreparePromise;
      });
    return this.sandboxPreparePromise;
  }

  private async requireRunningSession(message: string) {
    const session = await this.requireSession();
    if (session.status !== 'running') {
      throw new HttpError(409, 'invalid_state', message);
    }
    return session;
  }

  private async touchClientActivity() {
    const session = await this.state.storage.get<StoredSession>('session');
    await touchSessionClientActivity(
      this.state.storage,
      session,
      session ? requireScenario(session.scenarioId) : undefined,
      this.sseHub.size
    );
  }

  private async rescheduleIdleAlarm() {
    const session = await this.state.storage.get<StoredSession>('session');
    if (session?.status === 'running') {
      await this.scheduleLifecycleAlarms(
        session,
        requireScenario(session.scenarioId)
      );
    }
  }

  private async scheduleLifecycleAlarms(
    session: StoredSession,
    scenario: ScenarioDefinition
  ) {
    await scheduleSessionLifecycleAlarms(
      this.state.storage,
      session,
      scenario,
      this.sseHub.size
    );
  }

  private async finishSession(
    session: StoredSession,
    status: SessionStatus,
    result: string
  ) {
    this.timeline.clear();
    this.clearMetricsCache();
    await clearSessionLifecycleAlarms(this.state.storage);
    const finished = await finishSessionTransaction({
      env: this.env,
      session,
      status,
      result,
      storagePut: async (finished) => {
        await this.state.storage.put('session', finished);
      },
    });
    const room = await this.exercise.loadOrCreate(finished);
    await this.exercise.save(finished, setExercisePhase(room, 'resolved'));
    this.sseHub.broadcast(
      'exercise_state',
      await this.exercise.snapshot(finished)
    );
    return finished;
  }

  private async emit(
    session: StoredSession,
    type: ReplayEvent['type'],
    at: number,
    actor: ReplayEvent['actor'],
    payload: Record<string, unknown>
  ): Promise<StoredSession> {
    return emitSessionReplayEvent({
      env: this.env,
      session,
      type,
      at,
      actor,
      payload,
      storagePut: async (next) => {
        await this.state.storage.put('session', next);
      },
      broadcast: (event) => {
        this.sseHub.broadcast('replay', event);
      },
    });
  }
}

async function readBootstrap(
  request: Request
): Promise<Partial<SessionBootstrap>> {
  return await readInternalJsonObject(
    request,
    SESSION_BOOTSTRAP_BODY_MAX_BYTES
  );
}
