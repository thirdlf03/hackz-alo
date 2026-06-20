import type { ApiResult, Difficulty, MetricsSnapshot, ReplayEvent, ReplayVisibility, ScenarioDefinition } from "@incident/shared";

export type ReplayRecord = {
  id: string;
  scenario_id: string;
  difficulty: string;
  result: string | null;
  duration_ms: number | null;
  visibility: ReplayVisibility;
};

export type SessionLogFile = "access" | "app" | "batch";

export type SessionLogsResponse = {
  file: SessionLogFile;
  lines: string[];
};

export type SessionStorageResponse = {
  entries: Array<{ key: string; value: string }>;
};

export class ApiClient {
  private eventSeq = 0;

  async listScenarios() {
    return this.get<Array<Pick<ScenarioDefinition, "id" | "title" | "difficulty" | "timeLimitMinutes">>>("/api/scenarios");
  }

  async getScenario(id: string) {
    return this.get<ScenarioDefinition>(`/api/scenarios/${encodeURIComponent(id)}`);
  }

  async createSession(input: { difficulty?: Difficulty; scenarioId?: string }) {
    const data = await this.post<{ sessionId: string; replayId: string; scenario: ScenarioDefinition }>("/api/sessions", input);
    return { sessionId: data.sessionId, replayId: data.replayId, scenario: data.scenario };
  }

  async startSession(sessionId: string) {
    return this.post(`/api/sessions/${encodeURIComponent(sessionId)}/start`, {});
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

  async finishReplay(replayId: string) {
    return this.post(`/api/replays/${encodeURIComponent(replayId)}/finish`, {});
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

  async uploadThumbnail(replayId: string, blob: Blob) {
    return this.request(`/api/replays/${encodeURIComponent(replayId)}/thumbnail`, {
      method: "POST",
      body: blob
    });
  }

  async warmReplayVideo(replayId: string) {
    const response = await fetch(`/api/replays/${encodeURIComponent(replayId)}/video`, { method: "HEAD" });
    if (!response.ok) throw new Error("video assembly failed");
  }

  async getReplay(replayId: string) {
    return this.get<ReplayRecord>(`/api/replays/${encodeURIComponent(replayId)}`);
  }

  async getReplayEvents(replayId: string) {
    return this.get<Array<{ event_id: string; type: string; at_ms: number; summary?: string | null }>>(
      `/api/replays/${encodeURIComponent(replayId)}/events`
    );
  }

  async updateReplayVisibility(replayId: string, visibility: ReplayVisibility) {
    return this.patch(`/api/replays/${encodeURIComponent(replayId)}/visibility`, { visibility });
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

  private async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(path, init);
    const payload = (await response.json()) as ApiResult<T>;
    if (!payload.ok) throw new Error(payload.error.message);
    return payload.data;
  }
}
