import {
  replayChunkKey,
  replayEventsKey,
  replayEventsManifestKey,
  replayEventSummary,
  replayThumbnailKey,
  replayVideoKey,
  type ReplayEvent
} from "@incident/shared";
import type { Bindings } from "../types.js";

const replayVideoContentType = "video/webm";
const eventKeySuffixLength = "000000.jsonl".length;

type ReplayChunkRow = {
  seq: number;
  object_key: string;
};

export async function putReplayChunk(env: Bindings, input: {
  replayId: string;
  seq: number;
  body: ReadableStream | ArrayBuffer | Blob;
  contentType?: string | undefined;
  startedAtMs?: number | undefined;
  endedAtMs?: number | undefined;
}) {
  const key = replayChunkKey(input.replayId, input.seq);
  const now = new Date().toISOString();
  const contentType = input.contentType ?? contentTypeForBody(input.body) ?? replayVideoContentType;
  const object = await env.REPLAY_BUCKET.put(key, input.body, {
    httpMetadata: { contentType }
  });
  await env.DB.prepare(
    `insert or replace into replay_chunks
     (replay_id, seq, object_key, byte_size, started_at_ms, ended_at_ms, sha256, uploaded_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      input.replayId,
      input.seq,
      key,
      object.size,
      normalizeOptionalMs(input.startedAtMs),
      normalizeOptionalMs(input.endedAtMs),
      object.checksums?.toJSON?.().sha256 ?? null,
      now
    )
    .run();
  await env.REPLAY_BUCKET.delete(replayVideoKey(input.replayId)).catch(() => undefined);
  await env.DB.prepare(
    `update replays
     set video_object_key = null,
         mime_type = coalesce(mime_type, ?),
         recording_status = case
           when recording_status in ('idle', 'recording_error', 'finalization_failed') then 'recording'
           else recording_status
         end,
         updated_at = ?
     where id = ?`
  )
    .bind(contentType, now, input.replayId)
    .run();
  return { key, size: object.size };
}

export async function putReplayEvents(env: Bindings, replayId: string, seq: number, events: ReplayEvent[]) {
  const normalizedEvents = events
    .map((event) => normalizeReplayEvent(replayId, event))
    .filter((event): event is ReplayEvent => event !== undefined);
  if (normalizedEvents.length === 0) return { key: "", count: 0 };

  const eventSeq = await nextAvailableEventsSeq(env, replayId, seq);
  const key = replayEventsKey(replayId, eventSeq);
  const body = normalizedEvents.map((event) => `${JSON.stringify(event)}\n`).join("");
  await env.REPLAY_BUCKET.put(key, body, { httpMetadata: { contentType: "application/jsonl" } });

  const statements = normalizedEvents.map((event) =>
    env.DB.prepare(
      `insert or replace into replay_events_index
       (replay_id, event_id, type, at_ms, summary, visibility)
       values (?, ?, ?, ?, ?, ?)`
    ).bind(replayId, event.id, event.type, event.at, replayEventSummary(event), event.visibility)
  );
  if (statements.length > 0) await env.DB.batch(statements);
  const manifest = await putReplayEventsManifest(env, replayId, await listReplayEventKeys(env, replayId));
  await env.DB.prepare("update replays set event_log_object_key = ?, updated_at = ? where id = ?")
    .bind(manifest.key, new Date().toISOString(), replayId)
    .run();
  return { key, count: normalizedEvents.length };
}

export async function putReplayEventsManifest(env: Bindings, replayId: string, keys: string[]) {
  const key = replayEventsManifestKey(replayId);
  await env.REPLAY_BUCKET.put(
    key,
    JSON.stringify({ replayId, keys, createdAt: new Date().toISOString() }),
    { httpMetadata: { contentType: "application/json" } }
  );
  return { key };
}

export async function createMultipartUpload(env: Bindings, replayId: string) {
  const key = replayVideoKey(replayId);
  const upload = await env.REPLAY_BUCKET.createMultipartUpload(key);
  await env.DB.prepare(
    `insert or replace into replay_multipart_uploads
     (replay_id, object_key, upload_id, next_part_number, uploaded_parts_json, status, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(replayId, key, upload.uploadId, 1, "[]", "created", new Date().toISOString(), new Date().toISOString())
    .run();
  return { key, uploadId: upload.uploadId };
}

export async function uploadMultipartPart(env: Bindings, input: {
  replayId: string;
  partNumber: number;
  body: ReadableStream | ArrayBuffer | Blob;
}) {
  const row = await env.DB.prepare("select * from replay_multipart_uploads where replay_id = ?")
    .bind(input.replayId)
    .first<{
      object_key: string;
      upload_id: string;
      uploaded_parts_json: string;
    }>();
  if (!row) throw new Error("multipart upload not found");

  const upload = env.REPLAY_BUCKET.resumeMultipartUpload(row.object_key, row.upload_id);
  const uploadedPart = await upload.uploadPart(input.partNumber, input.body);
  const parts = JSON.parse(row.uploaded_parts_json) as Array<{ partNumber: number; etag: string }>;
  const nextParts = [
    ...parts.filter((part) => part.partNumber !== input.partNumber),
    uploadedPart
  ].sort((a, b) => a.partNumber - b.partNumber);

  await env.DB.prepare(
    `update replay_multipart_uploads
     set next_part_number = ?, uploaded_parts_json = ?, status = ?, updated_at = ?
     where replay_id = ?`
  )
    .bind(input.partNumber + 1, JSON.stringify(nextParts), "uploading", new Date().toISOString(), input.replayId)
    .run();
  return { uploadedPart, nextPartNumber: input.partNumber + 1 };
}

export async function completeMultipartUpload(env: Bindings, replayId: string) {
  const row = await env.DB.prepare("select * from replay_multipart_uploads where replay_id = ?")
    .bind(replayId)
    .first<{
      object_key: string;
      upload_id: string;
      uploaded_parts_json: string;
    }>();
  if (!row) throw new Error("multipart upload not found");

  const parts = JSON.parse(row.uploaded_parts_json) as Array<{ partNumber: number; etag: string }>;
  const upload = env.REPLAY_BUCKET.resumeMultipartUpload(row.object_key, row.upload_id);
  const object = await upload.complete(parts);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("update replay_multipart_uploads set status = ?, updated_at = ? where replay_id = ?")
      .bind("completed", now, replayId),
    env.DB.prepare("update replays set video_object_key = ?, recording_status = ?, updated_at = ? where id = ?")
      .bind(row.object_key, "ready", now, replayId)
  ]);
  return { key: row.object_key, size: object.size };
}

export async function getReplayObject(env: Bindings, replayId: string) {
  const key = replayVideoKey(replayId);
  const object = await env.REPLAY_BUCKET.get(key);
  if (object) return object;
  return assembleReplayVideo(env, replayId, key);
}

export function replayThumbnailObjectKey(replayId: string) {
  return replayThumbnailKey(replayId);
}

function contentTypeForBody(body: ReadableStream | ArrayBuffer | Blob) {
  return body instanceof Blob && body.type ? body.type : undefined;
}

function normalizeOptionalMs(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

function normalizeReplayEvent(replayId: string, value: unknown): ReplayEvent | undefined {
  if (!isRecord(value) || typeof value.type !== "string" || value.type.length === 0) return undefined;
  const id = typeof value.id === "string" && value.id.length > 0 ? value.id : `evt_${crypto.randomUUID()}`;
  const at = typeof value.at === "number" && Number.isFinite(value.at) ? Math.max(0, Math.floor(value.at)) : 0;
  const actor = typeof value.actor === "string" && value.actor.length > 0 ? value.actor : "system";
  const visibility = isReplayVisibility(value.visibility) ? value.visibility : "public_safe";
  const event: ReplayEvent = {
    id,
    replayId,
    type: value.type as ReplayEvent["type"],
    at,
    actor: actor as ReplayEvent["actor"],
    payload: isRecord(value.payload) ? value.payload : {},
    visibility
  };
  if (typeof value.wallTime === "string") event.wallTime = value.wallTime;
  return event;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReplayVisibility(value: unknown): value is ReplayEvent["visibility"] {
  return value === "public_safe" || value === "private" || value === "sensitive";
}

async function nextAvailableEventsSeq(env: Bindings, replayId: string, seq: number) {
  let candidate = Number.isInteger(seq) && seq >= 0 ? seq : 0;
  while (candidate <= 999999) {
    const key = replayEventsKey(replayId, candidate);
    if (!(await env.REPLAY_BUCKET.head(key))) return candidate;
    candidate += 1;
  }
  throw new Error("too many replay event batches");
}

async function listReplayEventKeys(env: Bindings, replayId: string) {
  const prefix = replayEventsKey(replayId, 0).slice(0, -eventKeySuffixLength);
  const keys: string[] = [];
  let cursor: string | undefined;

  do {
    const page = cursor
      ? await env.REPLAY_BUCKET.list({ prefix, cursor })
      : await env.REPLAY_BUCKET.list({ prefix });
    keys.push(
      ...page.objects
        .map((object: { key: string }) => object.key)
        .filter((key: string) => key.endsWith(".jsonl"))
    );
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return keys.sort();
}

async function assembleReplayVideo(env: Bindings, replayId: string, key: string) {
  const chunks = await listReplayChunks(env, replayId);
  if (chunks.length === 0) return null;

  const buffers: ArrayBuffer[] = [];
  let contentType = replayVideoContentType;
  for (const chunk of chunks) {
    const object = await env.REPLAY_BUCKET.get(chunk.object_key);
    if (!object) return null;
    contentType = buffers.length === 0 ? object.httpMetadata?.contentType ?? contentType : contentType;
    buffers.push(await object.arrayBuffer());
  }

  await env.REPLAY_BUCKET.put(key, new Blob(buffers, { type: contentType }), {
    httpMetadata: { contentType }
  });
  await env.DB.prepare("update replays set video_object_key = ?, mime_type = coalesce(mime_type, ?), updated_at = ? where id = ?")
    .bind(key, contentType, new Date().toISOString(), replayId)
    .run();
  return env.REPLAY_BUCKET.get(key);
}

async function listReplayChunks(env: Bindings, replayId: string) {
  const rows = await env.DB.prepare(
    "select seq, object_key from replay_chunks where replay_id = ? order by seq asc"
  )
    .bind(replayId)
    .all<ReplayChunkRow>();
  return rows.results ?? [];
}
