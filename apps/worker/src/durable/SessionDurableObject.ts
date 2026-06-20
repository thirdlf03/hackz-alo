import {
  createReplayEvent,
  replayEventSummary,
  type ApiResult,
  type ReplayEvent,
  type ScenarioDefinition,
  type SessionStatus,
  type MetricsSnapshot
} from "@incident/shared";
import { getScenario } from "@incident/scenarios";
import type { Bindings } from "../types.js";
import {
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
  userId: string;
  scenarioId: string;
  status: SessionStatus;
  startedAt?: string;
  finishedAt?: string;
  gameStartedAtMs?: number;
  triggeredIds: string[];
  eventSeq: number;
  bufferedEvents: ReplayEvent[];
};

type SessionBootstrap = Pick<StoredSession, "sessionId" | "replayId" | "userId" | "scenarioId">;

type SuccessCheck = {
  condition: ScenarioDefinition["successConditions"][number];
  ok: boolean;
};

export class SessionDurableObject implements DurableObject {
  private metricsCache?: MetricsSnapshot;
  private metricsCachedAt = 0;
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
      if (request.method === "GET" && action === "events") return this.events();
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
    const started = Date.now();
    let running: StoredSession = {
      ...session,
      status: "running",
      startedAt: new Date(started).toISOString(),
      gameStartedAtMs: started
    };
    await this.state.storage.put("session", running);
    await this.persistSession(running);
    await this.persistReplayStart(running);

    let startup: Awaited<ReturnType<typeof startScenarioSandbox>>;
    try {
      startup = await startScenarioSandbox(this.env, running.sessionId, scenario);
    } catch (error) {
      const failed: StoredSession = {
        ...running,
        status: "failed",
        finishedAt: new Date().toISOString()
      };
      await this.state.storage.put("session", failed);
      await this.persistSession(failed, "failed");
      await this.persistReplayResult(failed, "failed");
      await this.emit(failed, "sandbox_error", this.elapsedMs(failed), "sandbox", {
        message: messageFrom(error)
      });
      throw new HttpError(502, "sandbox_start_failed", messageFrom(error));
    }

    running = await this.emit(running, "session_start", 0, "system", {
      scenarioId: scenario.id,
      startup
    });
    await this.scheduleTriggers(running, scenario);
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
    let finished: StoredSession = {
      ...session,
      status: resolved ? "resolved" : "failed",
      finishedAt: new Date().toISOString()
    };
    await this.state.storage.put("session", finished);
    await this.persistSession(finished, resolved ? "resolved" : "failed");
    await this.persistReplayResult(finished, resolved ? "resolved" : "failed");
    this.clearMetricsCache();
    finished = await this.emit(
      finished,
      resolved ? "incident_resolved" : "session_end",
      this.elapsedMs(finished),
      "system",
      { checks }
    );
    return jsonOk({ ok: resolved, checks, session: await this.snapshotFor(finished) });
  }

  private async retire() {
    const session = await this.requireSession();
    let retired: StoredSession = {
      ...session,
      status: "retired",
      finishedAt: new Date().toISOString()
    };
    await this.state.storage.put("session", retired);
    await this.persistSession(retired, "retired");
    await this.persistReplayResult(retired, "retired");
    this.clearMetricsCache();
    retired = await this.emit(retired, "session_end", this.elapsedMs(retired), "player", { result: "retired" });
    return jsonOk({ session: await this.snapshotFor(retired) });
  }

  private async events() {
    const session = await this.requireSession();
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start: async (controller) => {
        controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(await this.snapshot())}\n\n`));
        for (const event of session.bufferedEvents.slice(-20)) {
          controller.enqueue(encoder.encode(`event: replay\ndata: ${JSON.stringify(event)}\n\n`));
        }
        controller.close();
      }
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache"
      }
    });
  }

  private async terminal(request: Request) {
    const session = await this.requireSession();
    return proxySessionTerminal(this.env, session.sessionId, request, { cols: 100, rows: 30 });
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
    return {
      ...session,
      elapsedMs: this.elapsedMs(session),
      scenario: requireScenario(session.scenarioId)
    };
  }

  private async loadOrCreate(input: Partial<SessionBootstrap>): Promise<StoredSession> {
    const existing = await this.state.storage.get<StoredSession>("session");
    if (existing) return existing;
    if (!input.sessionId || !input.replayId || !input.userId || !input.scenarioId) {
      throw new HttpError(400, "bad_request", "missing session bootstrap fields");
    }
    return {
      sessionId: input.sessionId,
      replayId: input.replayId,
      userId: input.userId,
      scenarioId: input.scenarioId,
      status: "briefing",
      triggeredIds: [],
      eventSeq: 0,
      bufferedEvents: []
    };
  }

  private async requireSession() {
    const session = await this.state.storage.get<StoredSession>("session");
    if (!session) throw new HttpError(409, "session_not_initialized", "session not initialized");
    return session;
  }

  private async scheduleTriggers(session: StoredSession, scenario: ScenarioDefinition) {
    for (const trigger of scenario.triggers) {
      if (session.triggeredIds.includes(trigger.id)) continue;
      const delay = Math.max(0, trigger.atMs - this.elapsedMs(session));
      this.state.waitUntil(
        (async () => {
          await new Promise((resolve) => setTimeout(resolve, delay));
          const latest = await this.requireSession();
          if (latest.status !== "running" || latest.triggeredIds.includes(trigger.id)) return;
          try {
            await injectFault(this.env, latest.sessionId, trigger.type, trigger.params);
            const triggered: StoredSession = {
              ...latest,
              triggeredIds: [...latest.triggeredIds, trigger.id]
            };
            await this.state.storage.put("session", triggered);
            await this.emit(triggered, "scenario_event", trigger.atMs, "scenario", { trigger });
          } catch (error) {
            await this.emit(latest, "sandbox_error", this.elapsedMs(latest), "sandbox", {
              triggerId: trigger.id,
              message: messageFrom(error)
            });
          }
        })()
      );
    }
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
    return next;
  }

  private async persistSession(session: StoredSession, result?: string) {
    await this.env.DB.prepare(
      `update play_sessions
       set status = ?, started_at = ?, finished_at = ?, result = ?, duration_ms = ?
       where id = ? and user_id = ?`
    )
      .bind(
        session.status,
        session.startedAt ?? null,
        session.finishedAt ?? null,
        result ?? null,
        session.finishedAt ? this.elapsedMs(session) : null,
        session.sessionId,
        session.userId
      )
      .run();
  }

  private async persistReplayStart(session: StoredSession) {
    const now = new Date().toISOString();
    await this.env.DB.prepare(
      `update replays
       set started_at = ?, recording_status = ?, updated_at = ?
       where id = ? and user_id = ?`
    )
      .bind(session.startedAt ?? now, "recording", now, session.replayId, session.userId)
      .run();
  }

  private async persistReplayResult(session: StoredSession, result: string) {
    const finishedAt = session.finishedAt ?? new Date().toISOString();
    await this.env.DB.prepare(
      `update replays
       set finished_at = coalesce(finished_at, ?), result = ?, duration_ms = ?, updated_at = ?
       where id = ? and user_id = ?`
    )
      .bind(finishedAt, result, this.elapsedMs(session), new Date().toISOString(), session.replayId, session.userId)
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

  private elapsedMs(session: StoredSession) {
    if (!session.gameStartedAtMs) return 0;
    return Math.max(0, Date.now() - session.gameStartedAtMs);
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
