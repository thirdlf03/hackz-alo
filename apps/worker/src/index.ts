import { proxyToSandbox } from "@cloudflare/sandbox";
import { Hono } from "hono";
import type { Context } from "hono";
import { listScenarios, getScenario } from "@incident/scenarios";
import {
  replayThumbnailKey,
  type ApiResult,
  type ReplayEvent,
  type ReplayVisibility
} from "@incident/shared";
import { devAuth } from "./auth.js";
import { SessionDurableObject } from "./durable/SessionDurableObject.js";
import {
  completeMultipartUpload,
  createMultipartUpload,
  getReplayObject,
  putReplayChunk,
  putReplayEvents,
  uploadMultipartPart
} from "./storage/replayStorage.js";
import type { AppVariables, AuthUser, Bindings } from "./types.js";

export { SessionDurableObject };
export { Sandbox } from "@cloudflare/sandbox";

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();
type WorkerContext = Context<{ Bindings: Bindings; Variables: AppVariables }>;

const replayVisibilities = new Set<ReplayVisibility>(["private", "self", "unlisted", "team", "public"]);

app.use("/api/*", devAuth);

app.get("/api/scenarios", (c) => c.json(ok(listScenarios())));

app.get("/api/scenarios/:scenarioId", (c) => {
  const scenario = getScenario(c.req.param("scenarioId"));
  if (!scenario) return c.json(err("not_found", "scenario not found"), 404);
  return c.json(ok(scenario));
});

app.post("/api/sessions", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json().catch(() => ({}))) as { scenarioId?: string };
  const scenario = body.scenarioId ? getScenario(body.scenarioId) : undefined;
  if (!scenario) return c.json(err("bad_request", "scenarioId is required"), 400);

  const sessionId = `sess_${crypto.randomUUID().replaceAll("-", "")}`;
  const replayId = `repl_${crypto.randomUUID().replaceAll("-", "")}`;
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `insert or ignore into users (id, display_name, created_at)
     values (?, ?, ?)`
  )
    .bind(user.id, user.displayName, now)
    .run();
  await c.env.DB.prepare(
    `insert into play_sessions
     (id, user_id, scenario_id, scenario_version, sandbox_id, replay_id, status, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(sessionId, user.id, scenario.id, scenario.version, `session-${sessionId}`, replayId, "created", now)
    .run();
  await c.env.DB.prepare(
    `insert into replays
     (id, user_id, session_id, scenario_id, difficulty, started_at, visibility, recording_status, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(replayId, user.id, sessionId, scenario.id, scenario.difficulty, now, "private", "idle", now, now)
    .run();

  const bootstrapResponse = await fetchSessionObject(c.env, sessionId, "bootstrap", {
    sessionId,
    replayId,
    userId: user.id,
    scenarioId: scenario.id
  });
  if (!bootstrapResponse.ok) return bootstrapResponse;

  return c.json(ok({ sessionId, replayId, scenario }));
});

app.get("/api/sessions/:sessionId", async (c) => proxySession(c, "snapshot"));
app.post("/api/sessions/:sessionId/start", async (c) => {
  const user = c.get("user");
  const sessionId = c.req.param("sessionId");
  const record = await getOwnedSession(c.env, user, sessionId);
  if (!record) return c.json(err("not_found", "session not found"), 404);
  return proxySession(c, "start", {
    sessionId,
    replayId: String(record.replay_id),
    userId: user.id,
    scenarioId: String(record.scenario_id)
  });
});
app.post("/api/sessions/:sessionId/resolve", async (c) => proxySession(c, "resolve"));
app.post("/api/sessions/:sessionId/retire", async (c) => proxySession(c, "retire"));
app.get("/api/sessions/:sessionId/events", async (c) => proxySession(c, "events"));
app.get("/api/sessions/:sessionId/ws/terminal", async (c) => proxySession(c, "terminal"));

app.post("/api/replays/:replayId/chunks", async (c) => {
  const replay = await getOwnedReplay(c.env, c.get("user"), c.req.param("replayId"));
  if (!replay) return c.json(err("not_found", "replay not found"), 404);
  const seq = parseSequence(c.req.query("seq"));
  if (seq === undefined) return c.json(err("bad_request", "invalid seq"), 400);
  const startedAtMs = parseOptionalNumber(c.req.query("startedAtMs"));
  const endedAtMs = parseOptionalNumber(c.req.query("endedAtMs"));
  if (startedAtMs === null || endedAtMs === null) {
    return c.json(err("bad_request", "invalid chunk time range"), 400);
  }
  const stored = await putReplayChunk(c.env, {
    replayId: String(replay.id),
    seq,
    body: c.req.raw.body ?? new ArrayBuffer(0),
    ...(startedAtMs === undefined ? {} : { startedAtMs }),
    ...(endedAtMs === undefined ? {} : { endedAtMs })
  });
  return c.json(ok(stored));
});

app.post("/api/replays/:replayId/mpu/create", async (c) => {
  const replay = await getOwnedReplay(c.env, c.get("user"), c.req.param("replayId"));
  if (!replay) return c.json(err("not_found", "replay not found"), 404);
  return c.json(ok(await createMultipartUpload(c.env, String(replay.id))));
});

app.put("/api/replays/:replayId/mpu/parts/:partNumber", async (c) => {
  const replay = await getOwnedReplay(c.env, c.get("user"), c.req.param("replayId"));
  if (!replay) return c.json(err("not_found", "replay not found"), 404);
  const partNumber = parsePartNumber(c.req.param("partNumber"));
  if (partNumber === undefined) {
    return c.json(err("bad_request", "invalid part number"), 400);
  }
  return c.json(
    ok(
      await uploadMultipartPart(c.env, {
        replayId: String(replay.id),
        partNumber,
        body: c.req.raw.body ?? new ArrayBuffer(0)
      })
    )
  );
});

app.post("/api/replays/:replayId/mpu/complete", async (c) => {
  const replay = await getOwnedReplay(c.env, c.get("user"), c.req.param("replayId"));
  if (!replay) return c.json(err("not_found", "replay not found"), 404);
  return c.json(ok(await completeMultipartUpload(c.env, String(replay.id))));
});

app.post("/api/replays/:replayId/events", async (c) => {
  const replay = await getOwnedReplay(c.env, c.get("user"), c.req.param("replayId"));
  if (!replay) return c.json(err("not_found", "replay not found"), 404);
  const events = await c.req.json().catch(() => []);
  if (!Array.isArray(events)) return c.json(err("bad_request", "events must be an array"), 400);
  const seq = parseSequence(c.req.query("seq"));
  if (seq === undefined) return c.json(err("bad_request", "invalid seq"), 400);
  return c.json(ok(await putReplayEvents(c.env, String(replay.id), seq, events as ReplayEvent[])));
});

app.post("/api/replays/:replayId/finish", async (c) => {
  const replay = await getOwnedReplay(c.env, c.get("user"), c.req.param("replayId"));
  if (!replay) return c.json(err("not_found", "replay not found"), 404);
  const now = new Date().toISOString();
  const object = await getReplayObject(c.env, String(replay.id));
  const status = object ? "ready" : "upload_degraded";
  await c.env.DB.prepare(
    `update replays
     set finished_at = coalesce(finished_at, ?),
         recording_status = ?,
         updated_at = ?
     where id = ?`
  )
    .bind(now, status, now, replay.id)
    .run();
  return c.json(ok({ replayId: replay.id, status }));
});

app.get("/api/replays/:replayId", async (c) => {
  const replay = await getVisibleReplay(c.env, c.get("user"), c.req.param("replayId"));
  if (!replay) return c.json(err("not_found", "replay not found"), 404);
  return c.json(ok(replay));
});

app.get("/api/replays/:replayId/video", async (c) => {
  const replay = await getVisibleReplay(c.env, c.get("user"), c.req.param("replayId"));
  if (!replay) return c.json(err("not_found", "replay not found"), 404);
  const object = await getReplayObject(c.env, String(replay.id));
  if (!object) return c.json(err("not_found", "video not found"), 404);
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "video/webm",
      "cache-control": "private, max-age=60"
    }
  });
});

app.get("/api/replays/:replayId/events", async (c) => {
  const replay = await getVisibleReplay(c.env, c.get("user"), c.req.param("replayId"));
  if (!replay) return c.json(err("not_found", "replay not found"), 404);
  const rows = await c.env.DB.prepare(
    "select event_id, type, at_ms, summary, visibility from replay_events_index where replay_id = ? order by at_ms asc"
  )
    .bind(replay.id)
    .all();
  return c.json(ok(rows.results));
});

app.patch("/api/replays/:replayId/visibility", async (c) => {
  const replay = await getOwnedReplay(c.env, c.get("user"), c.req.param("replayId"));
  if (!replay) return c.json(err("not_found", "replay not found"), 404);
  const body = (await c.req.json().catch(() => ({}))) as { visibility?: ReplayVisibility };
  if (!body.visibility || !replayVisibilities.has(body.visibility)) {
    return c.json(err("bad_request", "invalid visibility"), 400);
  }
  await c.env.DB.prepare("update replays set visibility = ?, updated_at = ? where id = ?")
    .bind(body.visibility, new Date().toISOString(), replay.id)
    .run();
  return c.json(ok({ replayId: replay.id, visibility: body.visibility }));
});

app.post("/api/replays/:replayId/thumbnail", async (c) => {
  const replay = await getOwnedReplay(c.env, c.get("user"), c.req.param("replayId"));
  if (!replay) return c.json(err("not_found", "replay not found"), 404);
  const key = replayThumbnailKey(String(replay.id));
  await c.env.REPLAY_BUCKET.put(key, c.req.raw.body ?? new ArrayBuffer(0), {
    httpMetadata: { contentType: "image/webp" }
  });
  await c.env.DB.prepare("update replays set thumbnail_object_key = ?, updated_at = ? where id = ?")
    .bind(key, new Date().toISOString(), replay.id)
    .run();
  return c.json(ok({ key }));
});

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    const sandboxResponse = await proxyToSandbox(request, env);
    if (sandboxResponse) return sandboxResponse;
    return app.fetch(request, env, ctx);
  }
};

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

function err(code: string, message: string): ApiResult<never> {
  return { ok: false, error: { code, message } };
}

async function proxySession(
  c: WorkerContext,
  action: string,
  body?: unknown
) {
  const sessionId = c.req.param("sessionId");
  if (!sessionId) return c.json(err("bad_request", "sessionId is required"), 400);
  const user = c.get("user");
  const record = await getOwnedSession(c.env, user, sessionId);
  if (!record) return c.json(err("not_found", "session not found"), 404);

  const id = c.env.SESSION_DO.idFromName(sessionId);
  const stub = c.env.SESSION_DO.get(id);
  const target = new URL(c.req.url);
  target.pathname = `/internal/sessions/${sessionId}/${action}`;
  const request =
    body === undefined
      ? new Request(target, c.req.raw)
      : new Request(target, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        });
  return stub.fetch(request);
}

async function fetchSessionObject(env: Bindings, sessionId: string, action: string, body: unknown) {
  const id = env.SESSION_DO.idFromName(sessionId);
  const stub = env.SESSION_DO.get(id);
  const target = new URL(`https://session.internal/internal/sessions/${encodeURIComponent(sessionId)}/${action}`);
  return stub.fetch(
    new Request(target, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}

type SessionRow = {
  id: string;
  user_id: string;
  scenario_id: string;
  replay_id: string;
};

type ReplayRow = {
  id: string;
  user_id: string;
  visibility: ReplayVisibility;
};

async function getOwnedSession(env: Bindings, user: AuthUser, sessionId: string) {
  const result = await env.DB.prepare("select * from play_sessions where id = ? and user_id = ?")
    .bind(sessionId, user.id)
    .first<SessionRow>();
  return result;
}

async function getOwnedReplay(env: Bindings, user: AuthUser, replayId: string) {
  return env.DB.prepare("select * from replays where id = ? and user_id = ?")
    .bind(replayId, user.id)
    .first<ReplayRow>();
}

async function getVisibleReplay(env: Bindings, user: AuthUser, replayId: string) {
  const replay = await env.DB.prepare("select * from replays where id = ?")
    .bind(replayId)
    .first<ReplayRow>();
  if (!replay) return undefined;
  if (replay.user_id === user.id) return replay;
  if (replay.visibility === "public" || replay.visibility === "unlisted") return replay;
  return undefined;
}

function parseSequence(value: string | undefined) {
  const raw = value ?? "0";
  const number = Number(raw);
  return Number.isInteger(number) && number >= 0 && number <= 999999 ? number : undefined;
}

function parsePartNumber(value: string) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 10000 ? number : undefined;
}

function parseOptionalNumber(value: string | undefined) {
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
