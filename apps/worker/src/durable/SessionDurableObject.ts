import {
  createReplayEvent,
  replayEventSummary,
  resolveEndingId,
  type AlertDefinition,
  type ApiResult,
  type ReplayEvent,
  type ScenarioDefinition,
  type SessionStatus,
  type MetricsSnapshot
} from "@incident/shared";
import { getScenario } from "@incident/scenarios";
import type { Bindings } from "../types.js";
import {
  destroySessionSandbox,
  evaluateSuccessCondition,
  fetchSessionMetrics,
  fetchSessionLogs,
  fetchSessionStorage,
  injectFault,
  interruptSessionTerminal,
  proxySessionTerminal,
  startScenarioSandbox
} from "../sandbox/runtime.js";

type StoredSession = {
  sessionId: string;
  replayId: string;
  scenarioId: string;
  status: SessionStatus;
  startedAt?: string;
  finishedAt?: string;
  gameTimeMs: number;
  gameSpeed: number;
  gameClockWallMs?: number;
  triggeredIds: string[];
  firedAlertIds: string[];
  firedSlackIds: string[];
  eventSeq: number;
  bufferedEvents: ReplayEvent[];
};

type SessionBootstrap = Pick<StoredSession, "sessionId" | "replayId" | "scenarioId">;

type SuccessCheck = {
  condition: ScenarioDefinition["successConditions"][number];
  ok: boolean;
};

type PendingTimer = {
  kind: "trigger" | "alert" | "slack";
  id: string;
  handle: ReturnType<typeof setTimeout>;
};

export class SessionDurableObject implements DurableObject {
  private metricsCache?: MetricsSnapshot;
  private metricsCachedAt = 0;
  private pendingTimers: PendingTimer[] = [];
  private sseClients: Set<ReadableStreamDefaultController<Uint8Array>> = new Set();
  private static readonly METRICS_TTL_MS = 3000;

  constructor(private state: DurableObjectState, private env: Bindings) {}

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const segments = url.pathname.split("/").filter(Boolean);
      const action = segments.at(-1);

      if (request.method === "POST" && action === "bootstrap") return this.bootstrap(request);
      if (request.method === "POST" && action === "start") return this.start(request);
      if (request.method === "POST" && action === "resolve") return this.resolve();
      if (request.method === "POST" && action === "retire") return this.retire();
      if (request.method === "DELETE" && action === "delete") return this.deleteSession();
      if (request.method === "POST" && action === "clock") return this.updateClock(request);
      if (request.method === "POST" && action === "terminal-resize") return this.terminalResize(request);
      if (request.method === "GET" && action === "events") return this.events(request);
      if (request.method === "GET" && action === "clock") return jsonOk(this.clockPayload(await this.requireSession()));
      if (request.method === "GET" && action === "metrics") return this.metrics();
      if (request.method === "GET" && action === "logs") return this.logs(request);
      if (request.method === "GET" && action === "storage") return this.storage();
      if (request.method === "GET" && action === "terminal") return this.terminal(request);
      if (request.method === "POST" && action === "terminal-interrupt") return this.terminalInterrupt();
      if (request.method === "GET") return jsonOk(await this.snapshot());

      return jsonErr("not_found", "session action not found", 404);
    } catch (error) {
      return errorResponse(error);
    }
  }

  private async bootstrap(request: Request) {
    const session = await this.loadOrCreate(await readBootstrap(request));
    await this.persistSession(session);
    return jsonOk({ session: await this.snapshotFor(session) });
  }

  private async start(request: Request) {
    const body = await readBootstrap(request);
    const session = await this.loadOrCreate(body);
    if (session.status === "running") {
      return jsonOk({ session: await this.snapshotFor(session), startup: [] });
    }
    if (isTerminalStatus(session.status)) {
      throw new HttpError(409, "invalid_state", `session is already ${session.status}`);
    }

    const scenario = requireScenario(session.scenarioId);
    const started = new Date().toISOString();
    let running: StoredSession = {
      ...session,
      status: "running",
      startedAt: started,
      gameTimeMs: 0,
      gameSpeed: session.gameSpeed || 1,
      gameClockWallMs: Date.now()
    };
    await this.state.storage.put("session", running);
    await this.persistSession(running);
    await this.persistReplayStart(running);

    let startup: Awaited<ReturnType<typeof startScenarioSandbox>>;
    try {
      startup = await startScenarioSandbox(this.env, running.sessionId, scenario);
    } catch (error) {
      const failed = await this.finishSession(running, "failed", "failed");
      await this.emit(failed, "sandbox_error", this.getGameTimeMs(failed), "sandbox", {
        message: messageFrom(error)
      });
      throw new HttpError(502, "sandbox_start_failed", messageFrom(error));
    }

    running = await this.emit(running, "session_start", 0, "system", {
      scenarioId: scenario.id,
      startup
    });
    this.scheduleScenarioTimeline(running, scenario);
    return jsonOk({ session: await this.snapshotFor(running), startup });
  }

  private async resolve() {
    const session = await this.requireSession();
    const scenario = requireScenario(session.scenarioId);
    const checks: SuccessCheck[] = await Promise.all(
      scenario.successConditions.map(async (condition) => ({
        condition,
        ok: await evaluateSuccessCondition(this.env, session.sessionId, condition)
      }))
    );
    const resolved = checks.every((check) => check.ok);
    const finished = await this.finishSession(session, resolved ? "resolved" : "failed", resolved ? "resolved" : "failed");
    const result = await this.emit(
      finished,
      resolved ? "incident_resolved" : "session_end",
      this.getGameTimeMs(finished),
      "system",
      { checks }
    );
    return jsonOk({ ok: resolved, checks, session: await this.snapshotFor(result) });
  }

  private async retire() {
    const session = await this.requireSession();
    const retired = await this.finishSession(session, "retired", "retired");
    const result = await this.emit(retired, "session_end", this.getGameTimeMs(retired), "player", { result: "retired" });
    return jsonOk({ session: await this.snapshotFor(result) });
  }

  private async deleteSession() {
    const session = await this.requireSession();
    this.clearPendingTimers();
    await destroySessionSandbox(this.env, session.sessionId);
    const aborted = await this.finishSession(session, "aborted", "aborted");
    return jsonOk({ session: await this.snapshotFor(aborted) });
  }

  private async updateClock(request: Request) {
    const session = await this.requireSession();
    if (session.status !== "running") {
      throw new HttpError(409, "invalid_state", "clock updates require a running session");
    }
    const body = (await request.json().catch(() => ({}))) as { speed?: number };
    const speed = typeof body.speed === "number" && body.speed > 0 && body.speed <= 4 ? body.speed : session.gameSpeed;
    const synced: StoredSession = {
      ...session,
      gameTimeMs: this.getGameTimeMs(session),
      gameSpeed: speed,
      gameClockWallMs: Date.now()
    };
    await this.state.storage.put("session", synced);
    const scenario = requireScenario(synced.scenarioId);
    this.rescheduleScenarioTimeline(synced, scenario);
    return jsonOk(this.clockPayload(synced));
  }

  private async events(request: Request) {
    await this.requireSession();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        this.sseClients.add(controller);
        request.signal.addEventListener(
          "abort",
          () => {
            this.sseClients.delete(controller);
            try { controller.close(); } catch { /* ignore */ }
          },
          { once: true }
        );
        const snapshot = await this.snapshot();
        controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`));
        const session = await this.requireSession();
        for (const event of session.bufferedEvents.slice(-50)) {
          controller.enqueue(encoder.encode(`event: replay\ndata: ${JSON.stringify(event)}\n\n`));
        }
      },
      cancel: () => {
        // Removed on abort above or broadcast error handling.
      }
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive"
      }
    });
  }

  private terminalCols = 100;
  private terminalRows = 30;

  private async terminal(request: Request) {
    const session = await this.requireSession();
    return proxySessionTerminal(this.env, session.sessionId, request, {
      cols: this.terminalCols,
      rows: this.terminalRows
    });
  }

  private async terminalResize(request: Request) {
    const body = (await request.json().catch(() => ({}))) as { cols?: number; rows?: number };
    if (typeof body.cols === "number" && body.cols >= 40 && body.cols <= 200) this.terminalCols = body.cols;
    if (typeof body.rows === "number" && body.rows >= 10 && body.rows <= 60) this.terminalRows = body.rows;
    return jsonOk({ cols: this.terminalCols, rows: this.terminalRows });
  }

  private async terminalInterrupt() {
    const session = await this.requireSession();
    if (session.status !== "running") {
      throw new HttpError(409, "invalid_state", "terminal interrupt is only available while the session is running");
    }
    await interruptSessionTerminal(this.env, session.sessionId);
    return jsonOk({ interrupted: true });
  }

  private async metrics() {
    const session = await this.requireSession();
    if (session.status !== "running") {
      throw new HttpError(409, "invalid_state", "metrics are only available while the session is running");
    }
    const now = Date.now();
    if (this.metricsCache && now - this.metricsCachedAt < SessionDurableObject.METRICS_TTL_MS) {
      return jsonOk(this.metricsCache);
    }
    const metrics = await fetchSessionMetrics(this.env, session.sessionId);
    if (!metrics) throw new HttpError(502, "sandbox_unavailable", "failed to fetch sandbox metrics");
    this.metricsCache = metrics;
    this.metricsCachedAt = now;
    return jsonOk(metrics);
  }

  private async logs(request: Request) {
    const session = await this.requireSession();
    if (session.status !== "running") {
      throw new HttpError(409, "invalid_state", "logs are only available while the session is running");
    }
    const url = new URL(request.url);
    const file = url.searchParams.get("file") ?? "access";
    const tail = Number(url.searchParams.get("tail") ?? "50");
    const lines = await fetchSessionLogs(this.env, session.sessionId, file, tail);
    return jsonOk({ file, lines });
  }

  private async storage() {
    const session = await this.requireSession();
    if (session.status !== "running") {
      throw new HttpError(409, "invalid_state", "storage is only available while the session is running");
    }
    const entries = await fetchSessionStorage(this.env, session.sessionId);
    return jsonOk({ entries });
  }

  private clearMetricsCache() {
    delete this.metricsCache;
    this.metricsCachedAt = 0;
  }

  private async snapshot() {
    const session = await this.requireSession();
    return this.snapshotFor(session);
  }

  private async snapshotFor(session: StoredSession) {
    const scenario = requireScenario(session.scenarioId);
    return {
      ...session,
      gameTimeMs: this.getGameTimeMs(session),
      elapsedMs: this.getGameTimeMs(session),
      alerts: this.firedAlerts(scenario, session),
      slackMessages: this.firedSlackMessages(scenario, session),
      scenario
    };
  }

  private clockPayload(session: StoredSession) {
    const scenario = requireScenario(session.scenarioId);
    return {
      gameTimeMs: this.getGameTimeMs(session),
      gameSpeed: session.gameSpeed,
      timeLimitMs: scenario.timeLimitMinutes * 60 * 1000,
      alerts: this.firedAlerts(scenario, session),
      slackMessages: this.firedSlackMessages(scenario, session)
    };
  }

  private firedAlerts(scenario: ScenarioDefinition, session: StoredSession): AlertDefinition[] {
    return scenario.alerts.filter((alert) => session.firedAlertIds.includes(alert.id));
  }

  private firedSlackMessages(scenario: ScenarioDefinition, session: StoredSession) {
    return scenario.slackMessages.filter((message) => session.firedSlackIds.includes(message.id));
  }

  private async loadOrCreate(input: Partial<SessionBootstrap>): Promise<StoredSession> {
    const existing = await this.state.storage.get<StoredSession>("session");
    if (existing) return existing;
    if (!input.sessionId || !input.replayId || !input.scenarioId) {
      throw new HttpError(400, "bad_request", "missing session bootstrap fields");
    }
    return {
      sessionId: input.sessionId,
      replayId: input.replayId,
      scenarioId: input.scenarioId,
      status: "briefing",
      gameTimeMs: 0,
      gameSpeed: 1,
      triggeredIds: [],
      firedAlertIds: [],
      firedSlackIds: [],
      eventSeq: 0,
      bufferedEvents: []
    };
  }

  private async requireSession() {
    const session = await this.state.storage.get<StoredSession>("session");
    if (!session) throw new HttpError(409, "session_not_initialized", "session not initialized");
    return session;
  }

  private getGameTimeMs(session: StoredSession) {
    if (session.status !== "running" || !session.gameClockWallMs) return session.gameTimeMs;
    const wallDelta = Date.now() - session.gameClockWallMs;
    return Math.max(0, Math.round(session.gameTimeMs + wallDelta * session.gameSpeed));
  }

  private clearPendingTimers() {
    for (const timer of this.pendingTimers) clearTimeout(timer.handle);
    this.pendingTimers = [];
  }

  private rescheduleScenarioTimeline(session: StoredSession, scenario: ScenarioDefinition) {
    this.clearPendingTimers();
    if (session.status !== "running") return;
    this.scheduleScenarioTimeline(session, scenario);
  }

  private scheduleScenarioTimeline(session: StoredSession, scenario: ScenarioDefinition) {
    for (const trigger of scenario.triggers) {
      if (session.triggeredIds.includes(trigger.id)) continue;
      this.scheduleAtGameTime(session, trigger.atMs, "trigger", trigger.id, async () => {
        const latest = await this.requireSession();
        if (latest.status !== "running" || latest.triggeredIds.includes(trigger.id)) return;
        try {
          await injectFault(this.env, latest.sessionId, trigger.type, trigger.params);
          let triggered: StoredSession = {
            ...latest,
            triggeredIds: [...latest.triggeredIds, trigger.id]
          };
          await this.state.storage.put("session", triggered);
          triggered = await this.emit(triggered, "scenario_event", trigger.atMs, "scenario", { trigger });
          this.broadcastSse("snapshot", await this.snapshotFor(triggered));
        } catch (error) {
          await this.emit(latest, "sandbox_error", trigger.atMs, "sandbox", {
            triggerId: trigger.id,
            message: messageFrom(error)
          });
        }
      });
    }

    for (const alert of scenario.alerts) {
      if (session.firedAlertIds.includes(alert.id)) continue;
      this.scheduleAtGameTime(session, alert.atMs, "alert", alert.id, async () => {
        const latest = await this.requireSession();
        if (latest.status !== "running" || latest.firedAlertIds.includes(alert.id)) return;
        const next: StoredSession = {
          ...latest,
          firedAlertIds: [...latest.firedAlertIds, alert.id]
        };
        await this.state.storage.put("session", next);
        const updated = await this.emit(next, "alert", alert.atMs, "scenario", {
          alertId: alert.id,
          message: alert.message,
          severity: alert.severity
        });
        this.broadcastSse("replay", updated.bufferedEvents.at(-1));
        this.broadcastSse("snapshot", await this.snapshotFor(updated));
      });
    }

    for (const message of scenario.slackMessages) {
      if (session.firedSlackIds.includes(message.id)) continue;
      this.scheduleAtGameTime(session, message.atMs, "slack", message.id, async () => {
        const latest = await this.requireSession();
        if (latest.status !== "running" || latest.firedSlackIds.includes(message.id)) return;
        const next: StoredSession = {
          ...latest,
          firedSlackIds: [...latest.firedSlackIds, message.id]
        };
        await this.state.storage.put("session", next);
        this.broadcastSse("snapshot", await this.snapshotFor(next));
      });
    }
  }

  private scheduleAtGameTime(
    session: StoredSession,
    atMs: number,
    kind: PendingTimer["kind"],
    id: string,
    run: () => Promise<void>
  ) {
    const delay = Math.max(0, (atMs - this.getGameTimeMs(session)) / Math.max(session.gameSpeed, 0.1));
    const handle = setTimeout(() => {
      this.pendingTimers = this.pendingTimers.filter((timer) => timer.handle !== handle);
      void run();
    }, delay);
    this.pendingTimers.push({ kind, id, handle });
  }

  private broadcastSse(event: string, data: unknown) {
    const encoder = new TextEncoder();
    const chunk = encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    for (const client of this.sseClients) {
      try {
        client.enqueue(chunk);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  private async finishSession(session: StoredSession, status: SessionStatus, result: string) {
    this.clearPendingTimers();
    this.clearMetricsCache();
    const finished: StoredSession = {
      ...session,
      status,
      gameTimeMs: this.getGameTimeMs(session),
      finishedAt: new Date().toISOString()
    };
    delete finished.gameClockWallMs;
    await this.state.storage.put("session", finished);
    await this.persistSession(finished, result);
    await this.persistReplayResult(finished, result);
    await destroySessionSandbox(this.env, session.sessionId);
    return finished;
  }

  private async emit(
    session: StoredSession,
    type: ReplayEvent["type"],
    at: number,
    actor: ReplayEvent["actor"],
    payload: Record<string, unknown>
  ): Promise<StoredSession> {
    const event = createReplayEvent({ replayId: session.replayId, type, at, actor, payload });
    const next = {
      ...session,
      eventSeq: session.eventSeq + 1,
      bufferedEvents: [...session.bufferedEvents, event].slice(-200)
    };
    await this.state.storage.put("session", next);
    await this.persistReplayEvent(event);
    this.broadcastSse("replay", event);
    return next;
  }

  private async persistSession(session: StoredSession, result?: string) {
    await this.env.DB.prepare(
      `update play_sessions
       set status = ?, started_at = ?, finished_at = ?, result = ?, duration_ms = ?
       where id = ?`
    )
      .bind(
        session.status,
        session.startedAt ?? null,
        session.finishedAt ?? null,
        result ?? null,
        session.finishedAt ? this.getGameTimeMs(session) : null,
        session.sessionId
      )
      .run();
  }

  private async persistReplayStart(session: StoredSession) {
    const now = new Date().toISOString();
    await this.env.DB.prepare(
      `update replays set started_at = ?, recording_status = ?, updated_at = ? where id = ?`
    )
      .bind(session.startedAt ?? now, "recording", now, session.replayId)
      .run();
  }

  private async persistReplayResult(session: StoredSession, result: string) {
    const finishedAt = session.finishedAt ?? new Date().toISOString();
    await this.env.DB.prepare(
      `update replays
       set finished_at = coalesce(finished_at, ?), result = ?, ending_id = ?, duration_ms = ?, updated_at = ?
       where id = ?`
    )
      .bind(
        finishedAt,
        result,
        resolveEndingId(result),
        this.getGameTimeMs(session),
        new Date().toISOString(),
        session.replayId
      )
      .run();
  }

  private async persistReplayEvent(event: ReplayEvent) {
    await this.env.DB.prepare(
      `insert or replace into replay_events_index
       (replay_id, event_id, type, at_ms, summary, visibility)
       values (?, ?, ?, ?, ?, ?)`
    )
      .bind(event.replayId, event.id, event.type, event.at, replayEventSummary(event), event.visibility)
      .run();
  }
}

function requireScenario(id: string) {
  const scenario = getScenario(id);
  if (!scenario) throw new HttpError(400, "bad_request", `unknown scenario: ${id}`);
  return scenario;
}

async function readBootstrap(request: Request): Promise<Partial<SessionBootstrap>> {
  const value = await request.json().catch(() => ({}));
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Partial<SessionBootstrap>;
}

function isTerminalStatus(status: SessionStatus) {
  return status === "resolved" || status === "failed" || status === "retired" || status === "aborted";
}

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

function err(code: string, message: string): ApiResult<never> {
  return { ok: false, error: { code, message } };
}

function jsonOk<T>(data: T, init?: ResponseInit) {
  return json(ok(data), init);
}

function jsonErr(code: string, message: string, status = 500) {
  return json(err(code, message), { status });
}

function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return jsonErr(error.code, error.message, error.status);
  }
  return jsonErr("internal_error", messageFrom(error), 500);
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "session request failed";
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function json<T>(payload: ApiResult<T>, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(payload), {
    ...init,
    headers
  });
}
