import type { ApiResult, Difficulty, ReplayEvent, ScenarioDefinition } from "@incident/shared";

export class ApiClient {
  async listScenarios() {
    return this.get<Array<Pick<ScenarioDefinition, "id" | "title" | "difficulty" | "timeLimitMinutes">>>("/api/scenarios");
  }

  async getScenario(id: string) {
    return this.get<ScenarioDefinition>(`/api/scenarios/${encodeURIComponent(id)}`);
  }

  async createSession(difficulty: Difficulty) {
    const data = await this.post<{ sessionId: string; replayId: string; scenario: ScenarioDefinition }>("/api/sessions", { difficulty });
    return { sessionId: data.sessionId, replayId: data.replayId, scenario: data.scenario };
  }

  async startSession(sessionId: string) {
    return this.post(`/api/sessions/${encodeURIComponent(sessionId)}/start`, {});
  }

  async resolveSession(sessionId: string) {
    return this.post<{ ok: boolean }>(`/api/sessions/${encodeURIComponent(sessionId)}/resolve`, {});
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
    return this.post(`/api/replays/${encodeURIComponent(replayId)}/events`, events);
  }

  async finishReplay(replayId: string) {
    return this.post(`/api/replays/${encodeURIComponent(replayId)}/finish`, {});
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
    const payload = (await response.json()) as ApiResult<T>;
    if (!payload.ok) throw new Error(payload.error.message);
    return payload.data;
  }
}
