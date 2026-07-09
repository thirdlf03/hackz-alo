import type {
  AfterActionReport,
  AlertDefinition,
  Difficulty,
  ExerciseSnapshot,
  ExerciseTaskStatus,
  IncidentLogEntryKind,
  MetricsSnapshot,
  ParticipantCursorEvent,
  ParticipantRole,
  ReplayEvent,
  ScenarioDefinition,
  ServiceHealth,
  SessionStatus,
  ChatMessageDefinition,
} from '@incident/shared';
import type {HttpClient} from './httpClient.js';

export type SessionLogFile = 'access' | 'app' | 'batch';

export interface SessionLogsResponse {
  file: SessionLogFile;
  lines: string[];
}

export interface SessionStorageResponse {
  entries: Array<{key: string; value: string}>;
}

export interface SessionFilesResponse {
  files: Array<{path: string; size?: number}>;
}

export interface SessionFileResponse {
  path: string;
  content: string;
}

export interface SessionClockResponse {
  gameTimeMs: number;
  gameSpeed: number;
  timeLimitMs: number;
  alerts: AlertDefinition[];
  chatMessages: ChatMessageDefinition[];
}

export type SessionSnapshotResponse = SessionClockResponse & {
  sessionId: string;
  replayId: string;
  scenarioId: string;
  status: SessionStatus;
  elapsedMs: number;
  scenario: ScenarioDefinition;
  serviceHealth?: Record<string, ServiceHealth>;
};

export class SessionApi {
  constructor(private http: HttpClient) {}

  createSession(input: {
    difficulty?: Difficulty;
    scenarioId?: string;
    turnstileToken?: string;
    participantId?: string;
  }) {
    return this.http.post<{
      sessionId: string;
      replayId: string;
      writeToken: string;
      scenario: ScenarioDefinition;
    }>('/api/sessions', input);
  }

  startSession(sessionId: string, input: {participantId?: string} = {}) {
    return this.http.post(
      `/api/sessions/${encodeURIComponent(sessionId)}/start`,
      input
    );
  }

  getSession(sessionId: string) {
    return this.http.get<SessionSnapshotResponse>(
      `/api/sessions/${encodeURIComponent(sessionId)}`
    );
  }

  prepareSession(sessionId: string) {
    return this.http.post<{
      prepared: boolean;
      reused?: boolean;
      status?: SessionStatus;
    }>(`/api/sessions/${encodeURIComponent(sessionId)}/prepare`, {});
  }

  deleteSession(sessionId: string) {
    return this.http.request(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    });
  }

  getSessionClock(sessionId: string) {
    return this.http.get<SessionClockResponse>(
      `/api/sessions/${encodeURIComponent(sessionId)}/clock`
    );
  }

  subscribeSessionEvents(
    sessionId: string,
    handlers: {
      onSnapshot?: (snapshot: SessionSnapshotResponse) => void;
      onExercise?: (snapshot: ExerciseSnapshot) => void;
      onCursor?: (event: ParticipantCursorEvent) => void;
      onReplay?: (event: ReplayEvent) => void;
      onError?: (event: Event) => void;
    }
  ) {
    const params = sessionAccessParams(this.http.getWriteToken());
    const query = params.size > 0 ? `?${params.toString()}` : '';
    const source = new EventSource(
      `/api/sessions/${encodeURIComponent(sessionId)}/events${query}`
    );
    source.addEventListener('snapshot', (event) => {
      handlers.onSnapshot?.(
        JSON.parse(
          (event as MessageEvent<string>).data
        ) as SessionSnapshotResponse
      );
    });
    source.addEventListener('replay', (event) => {
      handlers.onReplay?.(
        JSON.parse((event as MessageEvent<string>).data) as ReplayEvent
      );
    });
    source.addEventListener('cursor', (event) => {
      handlers.onCursor?.(
        JSON.parse(
          (event as MessageEvent<string>).data
        ) as ParticipantCursorEvent
      );
    });
    for (const eventName of [
      'exercise_state',
      'presence',
      'task',
      'inject',
      'phase',
      'incident_log',
      'hotwash',
    ]) {
      source.addEventListener(eventName, (event) => {
        handlers.onExercise?.(
          JSON.parse((event as MessageEvent<string>).data) as ExerciseSnapshot
        );
      });
    }
    source.addEventListener('error', (event) => handlers.onError?.(event));
    return source;
  }

  getExerciseState(sessionId: string) {
    return this.http.get<ExerciseSnapshot>(
      `/api/sessions/${encodeURIComponent(sessionId)}/exercise`
    );
  }

  joinParticipant(
    sessionId: string,
    input: {
      participantId: string;
      displayName: string;
      role: ParticipantRole;
      teamId?: string;
      ready?: boolean;
    }
  ) {
    return this.http.post<{exercise: ExerciseSnapshot}>(
      `/api/sessions/${encodeURIComponent(sessionId)}/participants/join`,
      input
    );
  }

  heartbeatParticipant(
    sessionId: string,
    input: {participantId: string; ready?: boolean}
  ) {
    return this.http.post<{exercise: ExerciseSnapshot}>(
      `/api/sessions/${encodeURIComponent(sessionId)}/participants/heartbeat`,
      input
    );
  }

  updateParticipantCursor(
    sessionId: string,
    input: {participantId: string; x: number; y: number; visible?: boolean}
  ) {
    return this.http.post<{ok: true}>(
      `/api/sessions/${encodeURIComponent(sessionId)}/participants/cursor`,
      input
    );
  }

  updateParticipantRole(
    sessionId: string,
    input: {participantId: string; role: ParticipantRole}
  ) {
    return this.http.post<{exercise: ExerciseSnapshot}>(
      `/api/sessions/${encodeURIComponent(sessionId)}/participants/role`,
      input
    );
  }

  setParticipantReady(
    sessionId: string,
    input: {participantId: string; ready: boolean}
  ) {
    return this.http.post<{exercise: ExerciseSnapshot}>(
      `/api/sessions/${encodeURIComponent(sessionId)}/exercise/ready`,
      input
    );
  }

  advanceExercisePhase(
    sessionId: string,
    input: {participantId: string; phase: 'briefing'}
  ) {
    return this.http.post<{exercise: ExerciseSnapshot}>(
      `/api/sessions/${encodeURIComponent(sessionId)}/exercise/phase`,
      input
    );
  }

  createTask(
    sessionId: string,
    input: {
      title: string;
      taskId?: string;
      assigneeParticipantId?: string;
      actorParticipantId?: string;
    }
  ) {
    return this.http.post<{exercise: ExerciseSnapshot}>(
      `/api/sessions/${encodeURIComponent(sessionId)}/tasks`,
      input
    );
  }

  updateTask(
    sessionId: string,
    taskId: string,
    input: {
      title?: string;
      status?: ExerciseTaskStatus;
      assigneeParticipantId?: string | null;
    }
  ) {
    return this.http.post<{exercise: ExerciseSnapshot}>(
      `/api/sessions/${encodeURIComponent(sessionId)}/tasks/${encodeURIComponent(taskId)}/update`,
      input
    );
  }

  fireInject(
    sessionId: string,
    injectId: string,
    input: {
      title?: string;
      body?: string;
      actorParticipantId?: string;
      participantId?: string;
    } = {}
  ) {
    return this.http.post<{exercise: ExerciseSnapshot}>(
      `/api/sessions/${encodeURIComponent(sessionId)}/injects/${encodeURIComponent(injectId)}/fire`,
      input
    );
  }

  appendIncidentLog(
    sessionId: string,
    input: {
      body: string;
      kind?: IncidentLogEntryKind;
      entryId?: string;
      actorParticipantId?: string;
    }
  ) {
    return this.http.post<{exercise: ExerciseSnapshot}>(
      `/api/sessions/${encodeURIComponent(sessionId)}/incident-log`,
      input
    );
  }

  submitHotwash(
    sessionId: string,
    input: {
      participantId?: string;
      wentWell: string;
      improve: string;
      followUp: string;
    }
  ) {
    return this.http.post<{exercise: ExerciseSnapshot}>(
      `/api/sessions/${encodeURIComponent(sessionId)}/hotwash`,
      input
    );
  }

  getAfterActionReport(sessionId: string) {
    return this.http.get<{report: AfterActionReport}>(
      `/api/sessions/${encodeURIComponent(sessionId)}/aar`
    );
  }

  updateSessionClock(sessionId: string, speed: number) {
    return this.http.post<SessionClockResponse>(
      `/api/sessions/${encodeURIComponent(sessionId)}/clock`,
      {speed}
    );
  }

  getSessionMetrics(sessionId: string) {
    return this.http.get<MetricsSnapshot>(
      `/api/sessions/${encodeURIComponent(sessionId)}/metrics`
    );
  }

  getSessionLogs(sessionId: string, file: SessionLogFile, tail = 50) {
    const params = new URLSearchParams({file, tail: String(tail)});
    return this.http.get<SessionLogsResponse>(
      `/api/sessions/${encodeURIComponent(sessionId)}/logs?${params}`
    );
  }

  getSessionStorage(sessionId: string) {
    return this.http.get<SessionStorageResponse>(
      `/api/sessions/${encodeURIComponent(sessionId)}/storage`
    );
  }

  listSessionFiles(sessionId: string) {
    return this.http.get<SessionFilesResponse>(
      `/api/sessions/${encodeURIComponent(sessionId)}/files`
    );
  }

  readSessionFile(sessionId: string, path: string) {
    const params = new URLSearchParams({path});
    return this.http.get<SessionFileResponse>(
      `/api/sessions/${encodeURIComponent(sessionId)}/file?${params}`
    );
  }

  writeSessionFile(sessionId: string, path: string, content: string) {
    return this.http.put<{path: string; byteLength: number}>(
      `/api/sessions/${encodeURIComponent(sessionId)}/file`,
      {path, content}
    );
  }

  resizeTerminal(sessionId: string, cols: number, rows: number) {
    return this.http.post<{cols: number; rows: number}>(
      `/api/sessions/${encodeURIComponent(sessionId)}/terminal/resize`,
      {cols, rows}
    );
  }

  interruptTerminal(sessionId: string) {
    return this.http.post<{interrupted: true}>(
      `/api/sessions/${encodeURIComponent(sessionId)}/terminal/interrupt`,
      {}
    );
  }

  resolveSession(sessionId: string) {
    return this.http.post<{ok: boolean}>(
      `/api/sessions/${encodeURIComponent(sessionId)}/resolve`,
      {}
    );
  }

  async retireSession(sessionId: string) {
    await this.http.post(
      `/api/sessions/${encodeURIComponent(sessionId)}/retire`,
      {}
    );
  }

  async timeoutSession(sessionId: string) {
    await this.http.post(
      `/api/sessions/${encodeURIComponent(sessionId)}/timeout`,
      {}
    );
  }

  /** Best-effort cleanup when the tab is closing during play. */
  notifySessionTimeout(sessionId: string) {
    const url = `/api/sessions/${encodeURIComponent(sessionId)}/timeout`;
    const body = new Blob(['{}'], {type: 'application/json'});
    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.sendBeacon === 'function'
    ) {
      navigator.sendBeacon(url, body);
      return;
    }
    void fetch(url, {
      method: 'POST',
      body: '{}',
      headers: {'content-type': 'application/json'},
      keepalive: true,
    });
  }
}

function sessionAccessParams(token: string | undefined) {
  const params = new URLSearchParams();
  if (token) params.set('accessToken', token);
  return params;
}
