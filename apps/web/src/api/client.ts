import type {
  Difficulty,
  ReplayEvent,
  ScenarioDefinition,
} from '@incident/shared';
import {bindApiMethods} from './bindApiMethods.js';
import {requestTurnstileToken} from '../effect/turnstileClient.js';
import {HttpClient} from './httpClient.js';
import {
  RecordingUploadApi,
  ReplayApi,
  type ReplayComment,
  type ReplayRecord,
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
  onReplay?: (event: ReplayEvent) => void;
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
      | 'finalizeReplayVideo'
      | 'getReplay'
      | 'getReplayEvents'
      | 'getReplayComments'
      | 'addReplayComment'
    >,
    Pick<
      SessionApi,
      | 'prepareSession'
      | 'startSession'
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
      | 'retireSession'
      | 'timeoutSession'
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
      'finalizeReplayVideo',
      'getReplay',
      'getReplayEvents',
      'getReplayComments',
      'addReplayComment',
    ]);
    bindApiMethods(this, this.sessions, [
      'prepareSession',
      'startSession',
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
      'retireSession',
      'timeoutSession',
    ]);
    bindApiMethods(this, this.recordingUpload, [
      'uploadChunk',
      'uploadEvents',
      'createMultipartUpload',
      'uploadMultipartPart',
      'completeMultipartUpload',
    ]);
  }

  async createSession(input: {difficulty?: Difficulty; scenarioId?: string}) {
    const turnstileToken = await requestTurnstileToken();
    const data = await this.sessions.createSession({
      ...input,
      ...(turnstileToken === undefined ? {} : {turnstileToken}),
    });
    this.http.setWriteToken(data.writeToken);
    return {
      sessionId: data.sessionId,
      replayId: data.replayId,
      writeToken: data.writeToken,
      scenario: data.scenario,
    };
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
}

export function createApiClient(): ApiClientSurface {
  return new ApiClient() as unknown as ApiClientSurface;
}
