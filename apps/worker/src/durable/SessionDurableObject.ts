import {
  createReplayEvent,
  canDeclareRecovery,
  type ReplayEvent,
  type ScenarioDefinition,
  type SessionStatus,
  type MetricsSnapshot,
} from '@incident/shared';
import {getScenario} from '@incident/scenarios';
import {
  INCIDENT_ATTRS,
  INCIDENT_SPAN_NAMES,
  withWorkerSpan,
} from '@incident/observability/worker';
import {
  errorResponse,
  HttpError,
  jsonErr,
  jsonOk,
  messageFrom,
} from '../http/response.js';
import type {Bindings} from '../types.js';
import {lifecycleAlarmDeadline} from './sessionClock.js';
import {
  persistReplayEvent,
  persistReplayResult,
  persistReplayStart,
  persistSession,
} from './sessionPersistence.js';
import {
  buildClockPayload,
  buildSessionSnapshot,
  createBriefingSession,
  finishStoredSession,
  getGameTimeMs,
  isTerminalStatus,
  startStoredSession,
  type SessionBootstrap,
  type StoredSession,
  type SuccessCheck,
} from './sessionState.js';
import {dispatchSessionRoute} from './sessionRouter.js';
import {SessionTimeline} from './sessionTimeline.js';
import {
  destroySessionSandbox,
  evaluateSuccessCondition,
  fetchSessionMetrics,
  fetchSessionLogs,
  fetchSessionStorage,
  injectFault,
  interruptSessionTerminal,
  listSessionFiles,
  prepareScenarioSandbox,
  proxySessionTerminal,
  readSessionFile,
  writeSessionFile,
  startScenarioSandbox,
  type SandboxPrepareResult,
} from '../sandbox/runtime.js';
import {matchSessionRoute} from './sessionRouter.js';

const SESSION_IDLE_TIMEOUT_MS = 3 * 60 * 1000;
const BRIEFING_TIMEOUT_MS = 15 * 60 * 1000;
const GAME_END_BUFFER_MS = 60 * 1000;

export class SessionDurableObject implements DurableObject {
  private metricsCache?: MetricsSnapshot;
  private metricsCachedAt = 0;
  private timeline: SessionTimeline;
  private sandboxPreparePromise?: Promise<SandboxPrepareResult>;
  private sseClients: Set<ReadableStreamDefaultController<Uint8Array>> =
    new Set();
  private static readonly METRICS_TTL_MS = 3000;

  constructor(
    private state: DurableObjectState,
    private env: Bindings
  ) {
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
        this.broadcastSse(event, data);
      },
    });
  }

  async alarm() {
    try {
      const session = await this.state.storage.get<StoredSession>('session');
      if (!session) return;

      if (session.status === 'briefing') {
        await this.deleteSession();
        return;
      }

      if (session.status !== 'running') return;

      const scenario = requireScenario(session.scenarioId);
      const timeLimitMs = scenario.timeLimitMinutes * 60 * 1000;
      if (getGameTimeMs(session) >= timeLimitMs) {
        await this.timeout();
        return;
      }

      const lastActivity =
        (await this.state.storage.get<number>('lastClientActivityAt')) ?? 0;
      if (
        this.sseClients.size === 0 &&
        Date.now() - lastActivity >= SESSION_IDLE_TIMEOUT_MS
      ) {
        await this.timeout();
        return;
      }

      await this.scheduleLifecycleAlarms(session, scenario);
    } catch (error) {
      console.error('[session-alarm]', messageFrom(error));
    }
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
    const session = await this.loadOrCreate(await readBootstrap(request));
    await this.state.storage.put('session', session);
    await persistSession(this.env, session);
    if (session.status === 'briefing') {
      await this.state.storage.setAlarm(Date.now() + BRIEFING_TIMEOUT_MS);
    }
    return jsonOk({session: this.snapshotFor(session)});
  }

  private async prepare(request: Request) {
    const session = await this.loadOrCreate(await readBootstrap(request));
    await this.state.storage.put('session', session);
    if (isTerminalStatus(session.status)) {
      return jsonOk({prepared: false, status: session.status});
    }
    const scenario = requireScenario(session.scenarioId);
    const result = await this.prepareSandbox(session, scenario);
    return jsonOk(result);
  }

  private async start(request: Request) {
    const body = await readBootstrap(request);
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

    const scenario = requireScenario(session.scenarioId);
    const started = new Date().toISOString();
    let running = startStoredSession(session, started, Date.now());
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
    await this.touchClientActivity();
    this.timeline.schedule(running, scenario);
    return jsonOk({session: this.snapshotFor(running), startup});
  }

  private async resolve() {
    const session = await this.requireSession();
    const scenario = requireScenario(session.scenarioId);
    const incidentStarted = canDeclareRecovery(scenario, session.triggeredIds);
    const checks: SuccessCheck[] = await Promise.all(
      scenario.successConditions.map(async (condition) => ({
        condition,
        ok: await evaluateSuccessCondition(
          this.env,
          session.sessionId,
          condition
        ),
      }))
    );
    const resolved = incidentStarted && checks.every((check) => check.ok);
    const finished = await this.finishSession(
      session,
      resolved ? 'resolved' : 'failed',
      resolved ? 'resolved' : 'false_resolve'
    );
    const result = await this.emit(
      finished,
      resolved ? 'incident_resolved' : 'session_end',
      getGameTimeMs(finished),
      resolved ? 'system' : 'player',
      resolved ? {checks} : {result: 'false_resolve', checks}
    );
    return jsonOk({
      ok: resolved,
      checks,
      session: this.snapshotFor(result),
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
    const body = (await request.json().catch(() => ({}))) as {speed?: number};
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
    this.timeline.reschedule(synced, scenario);
    await this.touchClientActivity();
    return jsonOk(this.clockPayload(synced));
  }

  private async events(request: Request) {
    await this.requireSession();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        this.sseClients.add(controller);
        void this.touchClientActivity();
        request.signal.addEventListener(
          'abort',
          () => {
            this.sseClients.delete(controller);
            void this.rescheduleIdleAlarm();
            try {
              controller.close();
            } catch {
              /* ignore */
            }
          },
          {once: true}
        );
        const snapshot = await this.snapshot();
        controller.enqueue(
          encoder.encode(
            `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`
          )
        );
        const session = await this.requireSession();
        for (const event of session.bufferedEvents.slice(-50)) {
          controller.enqueue(
            encoder.encode(`event: replay\ndata: ${JSON.stringify(event)}\n\n`)
          );
        }
      },
      cancel: () => {
        // Removed on abort above or broadcast error handling.
      },
    });
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    });
  }

  private terminalCols = 80;
  private terminalRows = 24;

  private async terminal(request: Request) {
    const session = await this.requireSession();
    await this.touchClientActivity();
    return proxySessionTerminal(this.env, session.sessionId, request, {
      cols: this.terminalCols,
      rows: this.terminalRows,
    });
  }

  private async terminalResize(request: Request) {
    const body = (await request.json().catch(() => ({}))) as {
      cols?: number;
      rows?: number;
    };
    if (typeof body.cols === 'number' && body.cols >= 40 && body.cols <= 200) {
      this.terminalCols = body.cols;
    }
    if (typeof body.rows === 'number' && body.rows >= 10 && body.rows <= 60) {
      this.terminalRows = body.rows;
    }
    return jsonOk({cols: this.terminalCols, rows: this.terminalRows});
  }

  private async terminalInterrupt() {
    const session = await this.requireSession();
    if (session.status !== 'running') {
      throw new HttpError(
        409,
        'invalid_state',
        'terminal interrupt is only available while the session is running'
      );
    }
    await interruptSessionTerminal(this.env, session.sessionId);
    return jsonOk({interrupted: true});
  }

  private async metrics() {
    const session = await this.requireSession();
    if (session.status !== 'running') {
      throw new HttpError(
        409,
        'invalid_state',
        'metrics are only available while the session is running'
      );
    }
    const now = Date.now();
    if (
      this.metricsCache &&
      now - this.metricsCachedAt < SessionDurableObject.METRICS_TTL_MS
    ) {
      await withWorkerSpan(
        this.env,
        INCIDENT_SPAN_NAMES.doSnapshotPoll,
        {
          [INCIDENT_ATTRS.sessionId]: session.sessionId,
          [INCIDENT_ATTRS.cached]: true,
        },
        () => undefined
      );
      return jsonOk(this.metricsCache);
    }
    const metrics = await withWorkerSpan(
      this.env,
      INCIDENT_SPAN_NAMES.doSnapshotPoll,
      {
        [INCIDENT_ATTRS.sessionId]: session.sessionId,
        [INCIDENT_ATTRS.cached]: false,
      },
      async () => await fetchSessionMetrics(this.env, session.sessionId)
    );
    if (!metrics) {
      throw new HttpError(
        502,
        'sandbox_unavailable',
        'failed to fetch sandbox metrics'
      );
    }
    this.metricsCache = metrics;
    this.metricsCachedAt = now;
    await this.touchClientActivity();
    return jsonOk(metrics);
  }

  private async logs(request: Request) {
    const session = await this.requireSession();
    if (session.status !== 'running') {
      throw new HttpError(
        409,
        'invalid_state',
        'logs are only available while the session is running'
      );
    }
    const url = new URL(request.url);
    const file = url.searchParams.get('file') ?? 'access';
    const tail = Number(url.searchParams.get('tail') ?? '50');
    const lines = await fetchSessionLogs(
      this.env,
      session.sessionId,
      file,
      tail
    );
    return jsonOk({file, lines});
  }

  private async storage() {
    const session = await this.requireSession();
    if (session.status !== 'running') {
      throw new HttpError(
        409,
        'invalid_state',
        'storage is only available while the session is running'
      );
    }
    const entries = await fetchSessionStorage(this.env, session.sessionId);
    return jsonOk({entries});
  }

  private async files() {
    const session = await this.requireRunningSession(
      'files are only available while the session is running'
    );
    const files = await listSessionFiles(this.env, session.sessionId);
    await this.touchClientActivity();
    return jsonOk({files});
  }

  private async readFile(request: Request) {
    const session = await this.requireRunningSession(
      'files are only available while the session is running'
    );
    const path = new URL(request.url).searchParams.get('path') ?? '';
    if (!path) throw new HttpError(400, 'bad_request', 'path is required');
    const file = await readSessionFile(this.env, session.sessionId, path);
    await this.touchClientActivity();
    return jsonOk(file);
  }

  private async writeFile(request: Request) {
    const session = await this.requireRunningSession(
      'files are only available while the session is running'
    );
    const body = (await request.json().catch(() => ({}))) as {
      path?: unknown;
      content?: unknown;
    };
    if (typeof body.path !== 'string') {
      throw new HttpError(400, 'bad_request', 'path is required');
    }
    if (typeof body.content !== 'string') {
      throw new HttpError(400, 'bad_request', 'content is required');
    }
    const file = await writeSessionFile(
      this.env,
      session.sessionId,
      body.path,
      body.content
    );
    await this.touchClientActivity();
    return jsonOk(file);
  }

  private clearMetricsCache() {
    delete this.metricsCache;
    this.metricsCachedAt = 0;
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
    this.sandboxPreparePromise ??= prepareScenarioSandbox(
      this.env,
      session.sessionId,
      scenario
    ).finally(() => {
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
    await this.state.storage.put('lastClientActivityAt', Date.now());
    const session = await this.state.storage.get<StoredSession>('session');
    if (session?.status === 'running') {
      await this.scheduleLifecycleAlarms(
        session,
        requireScenario(session.scenarioId)
      );
    }
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
    if (session.status !== 'running') return;

    const lastActivity =
      (await this.state.storage.get<number>('lastClientActivityAt')) ??
      Date.now();
    const deadline = lifecycleAlarmDeadline({
      session,
      timeLimitMs: scenario.timeLimitMinutes * 60 * 1000,
      idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
      gameEndBufferMs: GAME_END_BUFFER_MS,
      lastActivityAt: lastActivity,
      hasSseClients: this.sseClients.size > 0,
    });
    if (deadline !== undefined) await this.state.storage.setAlarm(deadline);
  }

  private async clearLifecycleAlarms() {
    await this.state.storage.deleteAlarm();
    await this.state.storage.delete('lastClientActivityAt');
  }

  private broadcastSse(event: string, data: unknown) {
    const encoder = new TextEncoder();
    const chunk = encoder.encode(
      `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    );
    for (const client of this.sseClients) {
      try {
        client.enqueue(chunk);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  private async finishSession(
    session: StoredSession,
    status: SessionStatus,
    result: string
  ) {
    this.timeline.clear();
    this.clearMetricsCache();
    await this.clearLifecycleAlarms();
    const finished = finishStoredSession(
      session,
      status,
      new Date().toISOString(),
      Date.now()
    );
    await this.state.storage.put('session', finished);
    try {
      await persistSession(this.env, finished, result);
      await persistReplayResult(this.env, finished, result);
    } finally {
      await destroySessionSandbox(this.env, session.sessionId);
    }
    return finished;
  }

  private async emit(
    session: StoredSession,
    type: ReplayEvent['type'],
    at: number,
    actor: ReplayEvent['actor'],
    payload: Record<string, unknown>
  ): Promise<StoredSession> {
    const event = createReplayEvent({
      replayId: session.replayId,
      type,
      at,
      actor,
      payload,
    });
    const next = {
      ...session,
      eventSeq: session.eventSeq + 1,
      bufferedEvents: [...session.bufferedEvents, event].slice(-200),
    };
    await this.state.storage.put('session', next);
    await persistReplayEvent(this.env, event);
    this.broadcastSse('replay', event);
    return next;
  }
}

function requireScenario(id: string) {
  const scenario = getScenario(id);
  if (!scenario) {
    throw new HttpError(400, 'bad_request', `unknown scenario: ${id}`);
  }
  return scenario;
}

async function readBootstrap(
  request: Request
): Promise<Partial<SessionBootstrap>> {
  const value = await request.json().catch(() => ({}));
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Partial<SessionBootstrap>;
}
