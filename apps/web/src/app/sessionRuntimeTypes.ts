import type {MutableRef} from 'preact/hooks';
import type {
  ExerciseSnapshot,
  GameRenderState,
  ParticipantCursorEvent,
  ParticipantPresence,
  ScenarioDefinition,
} from '@incident/shared';
import type {ApiClientSurface} from '../api/client.js';
import type {GameStateWriteGuard} from '../pure/gameStateWriteGuard.js';
import type {ReplayEventEmitter} from '../game/events/emitReplayEvent.js';
import type {
  SessionClockResponse,
  SessionSnapshotResponse,
} from './appRuntime.js';
import type {FinishMode, Screen, ScenarioSummary} from './appTypes.js';

export interface SessionRecordingBridge {
  finishRecording(
    session: {sessionId: string; replayId: string},
    shouldSaveVideo: boolean
  ): Promise<GameRenderState['recording']['status']>;
  shouldSaveVideo(): boolean;
  resetRecordingClock(): void;
  recordSpeedChange(gameMs: number, speed: number): void;
}

export interface TerminalBridgeRef {
  attachTerminalSession: (
    session: {
      sessionId: string;
      replayId: string;
    },
    participants: ParticipantPresence[]
  ) => Promise<void>;
  destroyTerminal: () => void;
}

export interface SessionRuntimeRefs {
  gameStateRef: MutableRef<GameRenderState | undefined>;
  elapsedMsRef: MutableRef<number>;
  lastTickAtRef: MutableRef<number>;
  sessionRef: MutableRef<{sessionId: string; replayId: string} | undefined>;
  scenarioRef: MutableRef<ScenarioDefinition | undefined>;
  eventEmitterRef: MutableRef<ReplayEventEmitter | null>;
  finishingRef: MutableRef<boolean>;
  tabBeaconSentRef: MutableRef<boolean>;
  liveReplayEventIdsRef: MutableRef<Set<string>>;
}

export interface SessionRuntimeBindings {
  api: ApiClientSurface;
  screen: Screen;
  session: {sessionId: string; replayId: string} | undefined;
  scenario: ScenarioDefinition | undefined;
  gameState: GameRenderState | undefined;
  gameSpeed: number;
  exerciseSnapshot: ExerciseSnapshot | undefined;
  isStarting: boolean;
  participantId: string;
  refs: SessionRuntimeRefs;
  recordingRef: {current: SessionRecordingBridge | undefined};
  terminalBridgeRef: {current: TerminalBridgeRef | undefined};
  setGameState: (
    value:
      | GameRenderState
      | undefined
      | ((current: GameRenderState | undefined) => GameRenderState | undefined)
  ) => void;
  setScreen: (screen: Screen) => void;
  setTimeline: (
    value:
      | Array<{at: number; label: string}>
      | ((current: Array<{at: number; label: string}>) => Array<{
          at: number;
          label: string;
        }>)
  ) => void;
  setAppError: (message: string | undefined) => void;
  patchGameStateRef: (
    updater: (state: GameRenderState) => GameRenderState,
    patchOptions?: {render?: boolean; collectTransitions?: boolean}
  ) => void;
  currentGameTimeMs: () => number;
  endSession: (mode: FinishMode) => Promise<void>;
  // Accepts both the full SSE snapshot payload and the narrower POST /clock
  // response; only the optional serviceHealth/recoveryConfirmedAtMs fields
  // need to be readable (recoveryConfirmedAtMs is absent from the POST
  // /clock response, so it simply no-ops there).
  applyClockSnapshot: (
    clock: SessionClockResponse &
      Pick<SessionSnapshotResponse, 'serviceHealth' | 'recoveryConfirmedAtMs'>
  ) => void;
  applyExerciseSnapshot: (snapshot: ExerciseSnapshot) => void;
  applyParticipantCursor: (event: ParticipantCursorEvent) => void;
  /** ウォールーム音声(WebRTC)のシグナリング受信ハンドラ。 */
  rtcSignalHandlerRef: {current: ((data: unknown) => void) | undefined};
  /** Direct gameStateRef writers (including useSessionGameLoop's 500ms
   * tick) tag every state they write so the gameState->ref mirroring
   * effect in useSessionRuntime can detect and skip stale commits; see
   * gameStateWriteGuard.ts. */
  gameStateWriteGuard: GameStateWriteGuard<GameRenderState>;
}

export interface SessionRuntimeBootstrapOptions {
  api: ApiClientSurface;
  deepLinkReplayId: string | undefined;
  deepLinkValidated: boolean;
  setScenarios: (
    value:
      | ScenarioSummary[]
      | ((current: ScenarioSummary[]) => ScenarioSummary[])
  ) => void;
  setAppError: (message: string | undefined) => void;
  setTimeline: SessionRuntimeBindings['setTimeline'];
  setDeepLinkReplayId: (value: string | undefined) => void;
  setDeepLinkValidated: (value: boolean) => void;
  setScreen: (screen: Screen) => void;
  refs: Pick<SessionRuntimeRefs, 'eventEmitterRef'>;
}
