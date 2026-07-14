import type {
  AfterActionReport,
  Difficulty,
  ExerciseSnapshot,
  ExerciseTaskStatus,
  IncidentLogEntryKind,
  ParticipantCursorEvent,
  ParticipantRole,
  ReplayEvent,
  ScenarioDefinition,
} from '@incident/shared';
import {bindApiMethods} from './bindApiMethods.js';
import {
  requestTurnstileToken,
  turnstileSiteKey,
} from '../effect/turnstileClient.js';
import {shouldRetryCreateSessionAfterTurnstileFailure} from '../pure/turnstileErrors.js';
import {HttpClient} from './httpClient.js';
import {
  RecordingUploadApi,
  ReplayApi,
  type ReplayComment,
  type ReplayRecord,
  type ReplayShareLink,
} from './replayApi.js';
import {ScenarioApi} from './scenarioApi.js';
import {
  SessionApi,
  type SessionClockResponse,
  type SessionFileResponse,
  type SessionFilesResponse,
  type SessionLogFile,
  type SessionLogsResponse,
  type SessionSnapshotResponse,
  type SessionStorageResponse,
} from './sessionApi.js';

export type {
  ReplayComment,
  ReplayRecord,
  ReplayShareLink,
  SessionClockResponse,
  SessionFileResponse,
  SessionFilesResponse,
  SessionLogFile,
  SessionLogsResponse,
  SessionSnapshotResponse,
  SessionStorageResponse,
};

interface SessionHandlers {
  onSnapshot?: (snapshot: SessionSnapshotResponse) => void;
  onExercise?: (snapshot: ExerciseSnapshot) => void;
  onCursor?: (event: ParticipantCursorEvent) => void;
  onReplay?: (event: ReplayEvent) => void;
  onRtcSignal?: (data: unknown) => void;
  onError?: (event: Event) => void;
}

export interface ApiClientSurface
  extends
    Pick<ScenarioApi, 'listScenarios' | 'getScenario'>,
    Pick<
      ReplayApi,
      | 'listFeaturedReplays'
      | 'finishReplay'
      | 'listReplayChunks'
      | 'fetchReplayChunkBlob'
      | 'assemblePartialReplayVideo'
      | 'waitForReplayVideo'
      | 'replayVideoExists'
      | 'fetchReplayVideoBlob'
      | 'finalizeReplayVideo'
      | 'getReplay'
      | 'getReplayEvents'
      | 'getReplayComments'
      | 'addReplayComment'
      | 'createShareLink'
    >,
    Pick<
      SessionApi,
      | 'prepareSession'
      | 'startSession'
      | 'getSession'
      | 'deleteSession'
      | 'getSessionClock'
      | 'updateSessionClock'
      | 'getSessionMetrics'
      | 'getSessionLogs'
      | 'getSessionStorage'
      | 'listSessionFiles'
      | 'readSessionFile'
      | 'writeSessionFile'
      | 'resizeTerminal'
      | 'interruptTerminal'
      | 'resolveSession'
      | 'checkRecovery'
      | 'retireSession'
      | 'timeoutSession'
      | 'getExerciseState'
      | 'joinParticipant'
      | 'heartbeatParticipant'
      | 'updateParticipantCursor'
      | 'updateParticipantRole'
      | 'setParticipantReady'
      | 'advanceExercisePhase'
      | 'createTask'
      | 'updateTask'
      | 'deleteTask'
      | 'fireInject'
      | 'appendIncidentLog'
      | 'updateIncidentLog'
      | 'deleteIncidentLog'
      | 'submitHotwash'
      | 'getAfterActionReport'
      | 'getRtcIceServers'
      | 'sendRtcSignal'
    >,
    Pick<
      RecordingUploadApi,
      | 'uploadChunk'
      | 'uploadEvents'
      | 'createMultipartUpload'
      | 'uploadMultipartPart'
      | 'completeMultipartUpload'
    > {
  createSession(input: {
    difficulty?: Difficulty;
    scenarioId?: string;
    participantId?: string;
  }): Promise<{
    sessionId: string;
    replayId: string;
    writeToken: string;
    scenario: ScenarioDefinition;
  }>;
  subscribeSessionEvents(
    sessionId: string,
    handlers: SessionHandlers
  ): EventSource;
  notifySessionTimeout(sessionId: string): void;
  resetEventSequence(replayId?: string): void;
  sessionAccessToken(): string | undefined;
  setSessionAccessToken(token: string | undefined): void;
  getExerciseState(sessionId: string): Promise<ExerciseSnapshot>;
  joinParticipant(
    sessionId: string,
    input: {
      participantId: string;
      displayName: string;
      role: ParticipantRole;
      teamId?: string;
      ready?: boolean;
    }
  ): Promise<{exercise: ExerciseSnapshot}>;
  heartbeatParticipant(
    sessionId: string,
    input: {participantId: string; ready?: boolean}
  ): Promise<{exercise: ExerciseSnapshot}>;
  updateParticipantCursor(
    sessionId: string,
    input: {participantId: string; x: number; y: number; visible?: boolean}
  ): Promise<{ok: true}>;
  updateParticipantRole(
    sessionId: string,
    input: {participantId: string; role: ParticipantRole}
  ): Promise<{exercise: ExerciseSnapshot}>;
  setParticipantReady(
    sessionId: string,
    input: {participantId: string; ready: boolean}
  ): Promise<{exercise: ExerciseSnapshot}>;
  advanceExercisePhase(
    sessionId: string,
    input: {participantId: string; phase: 'briefing'}
  ): Promise<{exercise: ExerciseSnapshot}>;
  createTask(
    sessionId: string,
    input: {
      title: string;
      taskId?: string;
      assigneeParticipantId?: string;
      actorParticipantId?: string;
    }
  ): Promise<{exercise: ExerciseSnapshot}>;
  updateTask(
    sessionId: string,
    taskId: string,
    input: {
      title?: string;
      status?: ExerciseTaskStatus;
      assigneeParticipantId?: string | null;
      actorParticipantId?: string;
    }
  ): Promise<{exercise: ExerciseSnapshot}>;
  deleteTask(
    sessionId: string,
    taskId: string,
    input?: {actorParticipantId?: string}
  ): Promise<{exercise: ExerciseSnapshot}>;
  fireInject(
    sessionId: string,
    injectId: string,
    input?: {
      title?: string;
      body?: string;
      actorParticipantId?: string;
      participantId?: string;
    }
  ): Promise<{exercise: ExerciseSnapshot}>;
  appendIncidentLog(
    sessionId: string,
    input: {
      body: string;
      kind?: IncidentLogEntryKind;
      entryId?: string;
      actorParticipantId?: string;
    }
  ): Promise<{exercise: ExerciseSnapshot}>;
  updateIncidentLog(
    sessionId: string,
    entryId: string,
    input: {
      body?: string;
      kind?: IncidentLogEntryKind;
      actorParticipantId?: string;
    }
  ): Promise<{exercise: ExerciseSnapshot}>;
  deleteIncidentLog(
    sessionId: string,
    entryId: string,
    input?: {actorParticipantId?: string}
  ): Promise<{exercise: ExerciseSnapshot}>;
  submitHotwash(
    sessionId: string,
    input: {
      participantId?: string;
      wentWell: string;
      improve: string;
      followUp: string;
    }
  ): Promise<{exercise: ExerciseSnapshot}>;
  getAfterActionReport(sessionId: string): Promise<{report: AfterActionReport}>;
}

export class ApiClient {
  private http = new HttpClient();
  private scenarios = new ScenarioApi(this.http);
  private sessions = new SessionApi(this.http);
  private replays = new ReplayApi(this.http);
  private recordingUpload = new RecordingUploadApi(this.http);

  constructor() {
    bindApiMethods(this, this.scenarios, ['listScenarios', 'getScenario']);
    bindApiMethods(this, this.replays, [
      'listFeaturedReplays',
      'finishReplay',
      'listReplayChunks',
      'fetchReplayChunkBlob',
      'assemblePartialReplayVideo',
      'waitForReplayVideo',
      'replayVideoExists',
      'fetchReplayVideoBlob',
      'finalizeReplayVideo',
      'getReplay',
      'getReplayEvents',
      'getReplayComments',
      'addReplayComment',
      'createShareLink',
    ]);
    bindApiMethods(this, this.sessions, [
      'prepareSession',
      'startSession',
      'getSession',
      'deleteSession',
      'getSessionClock',
      'updateSessionClock',
      'getSessionMetrics',
      'getSessionLogs',
      'getSessionStorage',
      'listSessionFiles',
      'readSessionFile',
      'writeSessionFile',
      'resizeTerminal',
      'interruptTerminal',
      'resolveSession',
      'checkRecovery',
      'retireSession',
      'timeoutSession',
      'getExerciseState',
      'joinParticipant',
      'heartbeatParticipant',
      'updateParticipantCursor',
      'updateParticipantRole',
      'setParticipantReady',
      'advanceExercisePhase',
      'createTask',
      'updateTask',
      'deleteTask',
      'fireInject',
      'appendIncidentLog',
      'updateIncidentLog',
      'deleteIncidentLog',
      'submitHotwash',
      'getAfterActionReport',
      'getRtcIceServers',
      'sendRtcSignal',
    ]);
    bindApiMethods(this, this.recordingUpload, [
      'uploadChunk',
      'uploadEvents',
      'createMultipartUpload',
      'uploadMultipartPart',
      'completeMultipartUpload',
    ]);
  }

  async createSession(input: {
    difficulty?: Difficulty;
    scenarioId?: string;
    participantId?: string;
  }) {
    const postSession = async (turnstileToken?: string) =>
      this.sessions.createSession({
        ...input,
        ...(turnstileToken === undefined ? {} : {turnstileToken}),
      });

    let turnstileToken = await requestTurnstileToken();
    try {
      const data = await postSession(turnstileToken);
      this.http.setWriteToken(data.writeToken);
      return {
        sessionId: data.sessionId,
        replayId: data.replayId,
        writeToken: data.writeToken,
        scenario: data.scenario,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '';
      if (
        !shouldRetryCreateSessionAfterTurnstileFailure(
          Boolean(turnstileSiteKey()),
          message
        )
      ) {
        throw error;
      }
      turnstileToken = await requestTurnstileToken();
      const data = await postSession(turnstileToken);
      this.http.setWriteToken(data.writeToken);
      return {
        sessionId: data.sessionId,
        replayId: data.replayId,
        writeToken: data.writeToken,
        scenario: data.scenario,
      };
    }
  }

  subscribeSessionEvents(sessionId: string, handlers: SessionHandlers) {
    return this.sessions.subscribeSessionEvents(sessionId, handlers);
  }

  notifySessionTimeout(sessionId: string) {
    this.sessions.notifySessionTimeout(sessionId);
  }

  resetEventSequence(replayId?: string) {
    this.recordingUpload.resetEventSequence(replayId);
  }

  sessionAccessToken() {
    return this.http.getWriteToken();
  }

  setSessionAccessToken(token: string | undefined) {
    this.http.setWriteToken(token);
  }
}

export function createApiClient(): ApiClientSurface {
  return new ApiClient() as unknown as ApiClientSurface;
}
