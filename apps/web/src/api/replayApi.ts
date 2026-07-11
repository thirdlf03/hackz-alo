import type {ReplayEvent} from '@incident/shared';
import type {HttpClient} from './httpClient.js';

export interface ReplayRecord {
  id: string;
  scenario_id: string;
  difficulty: string;
  result: string | null;
  duration_ms: number | null;
  video_duration_ms?: number | null;
  ending_id?: string | null;
  featured?: number;
  browser_info_json?: string | null;
  recording_status?: string;
}

export interface ReplayComment {
  id: string;
  at_ms: number;
  body: string;
  created_at: string;
}

export interface ReplayShareLink {
  scope: 'read';
  expiresAt: string;
  visibility: string;
  sharePath: string;
  readToken: string;
}

export class ReplayApi {
  constructor(private http: HttpClient) {}

  listFeaturedReplays() {
    return this.http.get<Array<ReplayRecord & {created_at: string}>>(
      '/api/replays/featured'
    );
  }

  finishReplay(
    replayId: string,
    input?: {
      browserInfo?: Record<string, unknown>;
      videoDurationMs?: number;
      consentRecorded?: boolean;
    }
  ) {
    return this.http.post(
      `/api/replays/${encodeURIComponent(replayId)}/finish`,
      input ?? {}
    );
  }

  listReplayChunks(replayId: string) {
    return this.http.get<
      Array<{seq: number; object_key: string; byte_size: number}>
    >(`/api/replays/${encodeURIComponent(replayId)}/chunks`);
  }

  async fetchReplayChunkBlob(replayId: string, seq: number) {
    const response = await this.http.fetch(
      `/api/replays/${encodeURIComponent(replayId)}/chunks/${String(seq)}`
    );
    if (!response.ok) throw new Error('chunk fetch failed');
    return response.blob();
  }

  async waitForReplayVideo(replayId: string, timeoutMs = 120_000) {
    const videoPath = `/api/replays/${encodeURIComponent(replayId)}/video`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const response = await this.http.fetch(videoPath, {method: 'HEAD'});
      if (response.ok) return videoPath;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error('video not ready');
  }

  async replayVideoExists(replayId: string) {
    return this.http
      .fetch(`/api/replays/${encodeURIComponent(replayId)}/video`, {
        method: 'HEAD',
      })
      .then((response) => response.ok)
      .catch(() => false);
  }

  async fetchReplayVideoBlob(replayId: string) {
    const response = await this.http.fetch(
      `/api/replays/${encodeURIComponent(replayId)}/video`
    );
    if (!response.ok) throw new Error('video fetch failed');
    return response.blob();
  }

  /** @deprecated Prefer waitForReplayVideo — avoids client-side chunk merging. */
  async assemblePartialReplayVideo(replayId: string) {
    return this.waitForReplayVideo(replayId);
  }

  getReplay(replayId: string) {
    return this.http.get<ReplayRecord>(
      `/api/replays/${encodeURIComponent(replayId)}`
    );
  }

  createShareLink(replayId: string, input?: {ttlHours?: number}) {
    return this.http.post<ReplayShareLink>(
      `/api/replays/${encodeURIComponent(replayId)}/share-links`,
      input ?? {}
    );
  }

  getReplayEvents(replayId: string) {
    return this.http.get<
      Array<{
        event_id: string;
        type: string;
        at_ms: number;
        summary?: string | null;
      }>
    >(`/api/replays/${encodeURIComponent(replayId)}/events`);
  }

  getReplayComments(replayId: string) {
    return this.http.get<ReplayComment[]>(
      `/api/replays/${encodeURIComponent(replayId)}/comments`
    );
  }

  addReplayComment(replayId: string, atMs: number, body: string) {
    return this.http.post<ReplayComment>(
      `/api/replays/${encodeURIComponent(replayId)}/comments`,
      {atMs, body}
    );
  }

  finalizeReplayVideo(replayId: string) {
    return this.http.post<{key: string; size: number; status: string}>(
      `/api/replays/${encodeURIComponent(replayId)}/finalize-video`,
      {}
    );
  }
}

export class RecordingUploadApi {
  private eventSeqByReplay = new Map<string, number>();

  constructor(private http: HttpClient) {}

  uploadChunk(
    replayId: string,
    chunk: {seq: number; blob: Blob; startedAtMs: number; endedAtMs: number}
  ) {
    const params = new URLSearchParams({
      seq: String(chunk.seq),
      startedAtMs: String(chunk.startedAtMs),
      endedAtMs: String(chunk.endedAtMs),
    });
    return this.http.request(
      `/api/replays/${encodeURIComponent(replayId)}/chunks?${params}`,
      {
        method: 'POST',
        body: chunk.blob,
      }
    );
  }

  uploadEvents(replayId: string, events: ReplayEvent[]) {
    const seq = this.eventSeqByReplay.get(replayId) ?? 0;
    this.eventSeqByReplay.set(replayId, seq + 1);
    return this.http.request(
      `/api/replays/${encodeURIComponent(replayId)}/events?seq=${String(seq)}`,
      {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(events),
      }
    );
  }

  resetEventSequence(replayId?: string) {
    if (replayId) {
      this.eventSeqByReplay.delete(replayId);
      return;
    }
    this.eventSeqByReplay.clear();
  }

  createMultipartUpload(replayId: string) {
    return this.http.post<{key: string; uploadId: string}>(
      `/api/replays/${encodeURIComponent(replayId)}/mpu/create`,
      {}
    );
  }

  uploadMultipartPart(replayId: string, partNumber: number, body: Blob) {
    return this.http.request(
      `/api/replays/${encodeURIComponent(replayId)}/mpu/parts/${String(partNumber)}`,
      {
        method: 'PUT',
        body,
      }
    );
  }

  completeMultipartUpload(replayId: string) {
    return this.http.post(
      `/api/replays/${encodeURIComponent(replayId)}/mpu/complete`,
      {}
    );
  }
}
