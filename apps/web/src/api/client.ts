import type { AlertDefinition, ApiResult, Difficulty, MetricsSnapshot, ReplayEvent, ScenarioDefinition, SessionStatus, SlackMessageDefinition } from "@incident/shared";

export type ReplayRecord = {
  id: string;
  scenario_id: string;
  difficulty: string;
  result: string | null;
  duration_ms: number | null;
  video_duration_ms?: number | null;
  ending_id?: string | null;
  featured?: number;
  browser_info_json?: string | null;
};

export type SessionLogFile = "access" | "app" | "batch";

export type SessionLogsResponse = {
  file: SessionLogFile;
  lines: string[];
};

export type SessionStorageResponse = {
  entries: Array<{ key: string; value: string }>;
};

export type SessionClockResponse = {
  gameTimeMs: number;
  gameSpeed: number;
  timeLimitMs: number;
  alerts: AlertDefinition[];
  slackMessages: SlackMessageDefinition[];
};

export type SessionSnapshotResponse = SessionClockResponse & {
  sessionId: string;
  replayId: string;
  scenarioId: string;
  status: SessionStatus;
  elapsedMs: number;
  scenario: ScenarioDefinition;
};

export type ReplayComment = {
  id: string;
  at_ms: number;
  body: string;
  created_at: string;
};

export class ApiClient {
  private eventSeq = 0;

  async listScenarios() {
    return this.get<Array<Pick<ScenarioDefinition, "id" | "title" | "difficulty" | "timeLimitMinutes">>>("/api/scenarios");
  }

  async getScenario(id: string) {
    return this.get<ScenarioDefinition>(`/api/scenarios/${encodeURIComponent(id)}`);
  }

  async listFeaturedReplays() {
    return this.get<Array<ReplayRecord & { created_at: string }>>("/api/replays/featured");
  }

  async createSession(input: { difficulty?: Difficulty; scenarioId?: string }) {
    const data = await this.post<{ sessionId: string; replayId: string; scenario: ScenarioDefinition }>("/api/sessions", input);
    return { sessionId: data.sessionId, replayId: data.replayId, scenario: data.scenario };
  }

  async startSession(sessionId: string) {
    return this.post(`/api/sessions/${encodeURIComponent(sessionId)}/start`, {});
  }

  async deleteSession(sessionId: string) {
    return this.request(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  }

  async getSessionClock(sessionId: string) {
    return this.get<SessionClockResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/clock`);
  }

  subscribeSessionEvents(
    sessionId: string,
    handlers: {
      onSnapshot?: (snapshot: SessionSnapshotResponse) => void;
      onReplay?: (event: ReplayEvent) => void;
      onError?: (event: Event) => void;
    }
  ) {
    const source = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/events`);
    source.addEventListener("snapshot", (event) => {
      handlers.onSnapshot?.(JSON.parse((event as MessageEvent<string>).data) as SessionSnapshotResponse);
    });
    source.addEventListener("replay", (event) => {
      handlers.onReplay?.(JSON.parse((event as MessageEvent<string>).data) as ReplayEvent);
    });
    source.addEventListener("error", (event) => handlers.onError?.(event));
    return source;
  }

  async updateSessionClock(sessionId: string, speed: number) {
    return this.post<SessionClockResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/clock`, { speed });
  }

  async getSessionMetrics(sessionId: string) {
    return this.get<MetricsSnapshot>(`/api/sessions/${encodeURIComponent(sessionId)}/metrics`);
  }

  async getSessionLogs(sessionId: string, file: SessionLogFile, tail = 50) {
    const params = new URLSearchParams({ file, tail: String(tail) });
    return this.get<SessionLogsResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/logs?${params}`);
  }

  async getSessionStorage(sessionId: string) {
    return this.get<SessionStorageResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/storage`);
  }

  async resizeTerminal(sessionId: string, cols: number, rows: number) {
    return this.post<{ cols: number; rows: number }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/terminal/resize`,
      { cols, rows }
    );
  }

  async interruptTerminal(sessionId: string) {
    return this.post<{ interrupted: true }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/terminal/interrupt`,
      {}
    );
  }

  async resolveSession(sessionId: string) {
    return this.post<{ ok: boolean }>(`/api/sessions/${encodeURIComponent(sessionId)}/resolve`, {});
  }

  async retireSession(sessionId: string) {
    return this.post(`/api/sessions/${encodeURIComponent(sessionId)}/retire`, {});
  }

  async uploadChunk(replayId: string, chunk: { seq: number; blob: Blob; startedAtMs: number; endedAtMs: number }) {
    const params = new URLSearchParams({
      seq: String(chunk.seq),
      startedAtMs: String(chunk.startedAtMs),
      endedAtMs: String(chunk.endedAtMs)
    });
    return this.request(`/api/replays/${encodeURIComponent(replayId)}/chunks?${params}`, {
      method: "POST",
      body: chunk.blob
    });
  }

  async uploadEvents(replayId: string, events: ReplayEvent[]) {
    const seq = this.eventSeq++;
    return this.request(`/api/replays/${encodeURIComponent(replayId)}/events?seq=${seq}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(events)
    });
  }

  resetEventSequence() {
    this.eventSeq = 0;
  }

  async finishReplay(replayId: string, input?: { browserInfo?: Record<string, unknown>; videoDurationMs?: number }) {
    return this.post(`/api/replays/${encodeURIComponent(replayId)}/finish`, input ?? {});
  }

  async createMultipartUpload(replayId: string) {
    return this.post<{ key: string; uploadId: string }>(
      `/api/replays/${encodeURIComponent(replayId)}/mpu/create`,
      {}
    );
  }

  async uploadMultipartPart(replayId: string, partNumber: number, body: Blob) {
    return this.request(`/api/replays/${encodeURIComponent(replayId)}/mpu/parts/${partNumber}`, {
      method: "PUT",
      body
    });
  }

  async completeMultipartUpload(replayId: string) {
    return this.post(`/api/replays/${encodeURIComponent(replayId)}/mpu/complete`, {});
  }

  async listReplayChunks(replayId: string) {
    return this.get<Array<{ seq: number; object_key: string; byte_size: number }>>(
      `/api/replays/${encodeURIComponent(replayId)}/chunks`
    );
  }

  async fetchReplayChunkBlob(replayId: string, seq: number) {
    const response = await fetch(`/api/replays/${encodeURIComponent(replayId)}/chunks/${seq}`);
    if (!response.ok) throw new Error("chunk fetch failed");
    return response.blob();
  }

  async assemblePartialReplayVideo(replayId: string) {
    const chunks = await this.listReplayChunks(replayId);
    if (chunks.length === 0) throw new Error("no chunks");
    const blobs = await Promise.all(chunks.map((chunk) => this.fetchReplayChunkBlob(replayId, chunk.seq)));
    return URL.createObjectURL(new Blob(blobs, { type: blobs[0]?.type || "video/webm" }));
  }

  async getReplay(replayId: string) {
    return this.get<ReplayRecord>(`/api/replays/${encodeURIComponent(replayId)}`);
  }

  async getReplayEvents(replayId: string) {
    return this.get<Array<{ event_id: string; type: string; at_ms: number; summary?: string | null }>>(
      `/api/replays/${encodeURIComponent(replayId)}/events`
    );
  }

  async getReplayComments(replayId: string) {
    return this.get<ReplayComment[]>(`/api/replays/${encodeURIComponent(replayId)}/comments`);
  }

  async addReplayComment(replayId: string, atMs: number, body: string) {
    return this.post<ReplayComment>(`/api/replays/${encodeURIComponent(replayId)}/comments`, { atMs, body });
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(path, init);
    if (init.method === "DELETE" && response.status === 200) {
      const payload = (await response.json()) as ApiResult<T>;
      if (!payload.ok) throw new Error(payload.error.message);
      return payload.data;
    }
    const payload = (await response.json()) as ApiResult<T>;
    if (!payload.ok) throw new Error(payload.error.message);
    return payload.data;
  }
}
