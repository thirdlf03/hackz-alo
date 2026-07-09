import type {MutableRef} from 'preact/hooks';
import type {
  ExerciseSnapshot,
  GameRenderState,
  ParticipantCursorEvent,
  ScenarioDefinition,
} from '@incident/shared';
import type {ApiClientSurface} from '../api/client.js';
import type {ReplayEventEmitter} from '../game/events/emitReplayEvent.js';
import type {SessionClockResponse} from './appRuntime.js';
import type {FinishMode, Screen, ScenarioSummary} from './AppScreens.js';

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
  attachTerminalSession: (session: {
    sessionId: string;
    replayId: string;
  }) => Promise<void>;
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
  refs: SessionRuntimeRefs;
  recordingRef: {current: SessionRecordingBridge | undefined};
  terminalBridgeRef: {current: TerminalBridgeRef | undefined};
  setGameState: (
    value:
      | GameRenderState
      | undefined
      | ((current: GameRenderState | undefined) => GameRenderState | undefined)
  ) => void;
  setTimeline: (
    value:
      | Array<{at: number; label: string}>
      | ((current: Array<{at: number; label: string}>) => Array<{
          at: number;
          label: string;
        }>)
  ) => void;
  patchGameStateRef: (
    updater: (state: GameRenderState) => GameRenderState,
    patchOptions?: {render?: boolean; collectTransitions?: boolean}
  ) => void;
  currentGameTimeMs: () => number;
  endSession: (mode: FinishMode) => Promise<void>;
  applyClockSnapshot: (clock: SessionClockResponse) => void;
  applyExerciseSnapshot: (snapshot: ExerciseSnapshot) => void;
  applyParticipantCursor: (event: ParticipantCursorEvent) => void;
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
