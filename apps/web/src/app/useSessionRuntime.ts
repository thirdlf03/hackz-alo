import {useEffect, useRef} from 'preact/hooks';
import type {
  ExerciseSnapshot,
  GameRenderState,
  ParticipantCursorEvent,
  ScenarioDefinition,
} from '@incident/shared';
import {
  INCIDENT_ATTRS,
  INCIDENT_SPAN_NAMES,
  markJourney,
} from '@incident/observability/browser';
import {
  advanceGameState,
  createInitialGameState,
  submitPlayerChatMessage,
} from '../game/state/gameState.js';
import type {ReplayEventEmitter} from '../game/events/emitReplayEvent.js';
import {createEmptyTerminalMirror} from '../game/terminal/mirror.js';
import {playAlertBeep} from '../game/recording/audio.js';
import {collectStateTransitions} from '../game/events/sessionEvents.js';
import type {ApiClientSurface} from '../api/client.js';
import type {
  SessionClockResponse,
  SessionSnapshotResponse,
} from './appRuntime.js';
import type {FinishMode, Screen, ScenarioSummary} from './AppScreens.js';
import {
  computeLiveGameTimeMs,
  describeSessionActionError,
  readReplayIdFromSearch,
  toErrorMessage,
} from './appUtils.js';
import {canOperateSandbox} from '../pure/rolePermissions.js';
import {useExercisePhaseSync} from './useExercisePhaseSync.js';
import {useSessionBootstrap} from './useSessionBootstrap.js';
import {useSessionClockSync} from './useSessionClockSync.js';
import {useSessionGameLoop} from './useSessionGameLoop.js';
import {useSessionLifecycleGuards} from './useSessionLifecycleGuards.js';
import {useSessionSse} from './useSessionSse.js';
import type {
  SessionRecordingBridge,
  SessionRuntimeBindings,
  TerminalBridgeRef,
} from './sessionRuntimeTypes.js';

const CONSENT_KEY = 'incident-recording-consent';
const SAVE_RECORDING_KEY = 'incident-recording-save';

export type {SessionRecordingBridge, TerminalBridgeRef};

export function useSessionRuntime(options: {
  api: ApiClientSurface;
  screen: Screen;
  session: {sessionId: string; replayId: string} | undefined;
  scenario: ScenarioDefinition | undefined;
  gameState: GameRenderState | undefined;
  gameSpeed: number;
  exerciseSnapshot: ExerciseSnapshot | undefined;
  saveRecording: boolean;
  recordingConsent: boolean;
  isStarting: boolean;
  sandboxReady: boolean;
  participantId: string;
  deepLinkReplayId: string | undefined;
  deepLinkValidated: boolean;
  recordingRef: {current: SessionRecordingBridge | undefined};
  terminalBridgeRef: {current: TerminalBridgeRef | undefined};
  setScreen: (screen: Screen) => void;
  setSession: (
    session: {sessionId: string; replayId: string} | undefined
  ) => void;
  setScenario: (scenario: ScenarioDefinition | undefined) => void;
  setGameState: (
    value:
      | GameRenderState
      | undefined
      | ((current: GameRenderState | undefined) => GameRenderState | undefined)
  ) => void;
  setExerciseSnapshot: (
    value:
      | ExerciseSnapshot
      | undefined
      | ((
          current: ExerciseSnapshot | undefined
        ) => ExerciseSnapshot | undefined)
  ) => void;
  setTimeline: (
    value:
      | Array<{at: number; label: string}>
      | ((current: Array<{at: number; label: string}>) => Array<{
          at: number;
          label: string;
        }>)
  ) => void;
  setAppError: (message: string | undefined) => void;
  setIsStarting: (value: boolean) => void;
  setSandboxReady: (value: boolean) => void;
  setHasRecordingConsent: (value: boolean) => void;
  setDeepLinkReplayId: (value: string | undefined) => void;
  setDeepLinkValidated: (value: boolean) => void;
  setScenarios: (
    value:
      | ScenarioSummary[]
      | ((current: ScenarioSummary[]) => ScenarioSummary[])
  ) => void;
}) {
  const gameStateRef = useRef<GameRenderState | undefined>(undefined);
  const elapsedMsRef = useRef(0);
  const lastTickAtRef = useRef(0);
  const sessionRef = useRef<{sessionId: string; replayId: string} | undefined>(
    undefined
  );
  const scenarioRef = useRef<ScenarioDefinition | undefined>(undefined);
  const eventEmitterRef = useRef<ReplayEventEmitter | null>(null);
  const finishingRef = useRef(false);
  const tabBeaconSentRef = useRef(false);
  const liveReplayEventIdsRef = useRef(new Set<string>());
  const sandboxPrepareSessionIdRef = useRef<string | undefined>(undefined);
  const creatingSessionRef = useRef(false);

  const {
    api,
    screen,
    session,
    scenario,
    gameState,
    gameSpeed,
    exerciseSnapshot,
    saveRecording,
    recordingConsent,
    isStarting,
    sandboxReady,
    participantId,
    deepLinkReplayId,
    deepLinkValidated,
    recordingRef,
    terminalBridgeRef,
    setScreen,
    setSession,
    setScenario,
    setGameState,
    setExerciseSnapshot,
    setTimeline,
    setAppError,
    setIsStarting,
    setSandboxReady,
    setHasRecordingConsent,
    setDeepLinkReplayId,
    setDeepLinkValidated,
    setScenarios,
  } = options;

  const refs = {
    gameStateRef,
    elapsedMsRef,
    lastTickAtRef,
    sessionRef,
    scenarioRef,
    eventEmitterRef,
    finishingRef,
    tabBeaconSentRef,
    liveReplayEventIdsRef,
  };

  const patchGameStateRef = (
    updater: (state: GameRenderState) => GameRenderState,
    patchOptions: {render?: boolean; collectTransitions?: boolean} = {}
  ) => {
    const current = gameStateRef.current;
    if (!current) return;
    const next = updater(current);
    if (next === current) return;
    const replayId = sessionRef.current?.replayId;
    if (
      patchOptions.collectTransitions !== false &&
      replayId &&
      eventEmitterRef.current
    ) {
      collectStateTransitions(
        current,
        next,
        scenarioRef.current,
        currentGameTimeMs(),
        eventEmitterRef.current,
        replayId
      );
    }
    gameStateRef.current = next;
    if (patchOptions.render !== false) setGameState(next);
  };

  function currentGameTimeMs() {
    const current = gameStateRef.current;
    return computeLiveGameTimeMs({
      screen,
      baseMs: elapsedMsRef.current,
      lastTickAt: lastTickAtRef.current,
      speed: current?.clock.speed ?? 1,
      timeLimitMs: current?.clock.timeLimitMs ?? 0,
      finishing: finishingRef.current,
    });
  }

  async function endSession(mode: FinishMode) {
    if (!session || finishingRef.current) return;
    finishingRef.current = true;
    const recording = recordingRef.current;
    const shouldSaveVideo = recording?.shouldSaveVideo() ?? false;
    setGameState((current) =>
      current
        ? {
            ...current,
            recording: {
              ...current.recording,
              status: shouldSaveVideo ? 'stopping' : 'idle',
            },
          }
        : current
    );

    let resolved = false;
    if (mode === 'resolve') {
      const result = await api
        .resolveSession(session.sessionId)
        .catch(() => undefined);
      resolved = Boolean(result?.ok);
    } else if (mode === 'retire') {
      await api.retireSession(session.sessionId).catch(console.error);
    } else {
      await api.timeoutSession(session.sessionId).catch(console.error);
    }

    terminalBridgeRef.current?.destroyTerminal();

    const status =
      mode === 'retire' ? 'retired' : resolved ? 'resolved' : 'failed';
    setGameState((current) =>
      current
        ? {
            ...current,
            session: {...current.session, status},
            recording: {
              ...current.recording,
              status: shouldSaveVideo ? 'stopping' : 'idle',
            },
          }
        : current
    );
    setScreen('result');

    const recordingStatus = recording
      ? await recording.finishRecording(session, shouldSaveVideo)
      : 'idle';
    setGameState((current) =>
      current
        ? {
            ...current,
            recording: {
              ...current.recording,
              status: recordingStatus,
              saveEnabled: shouldSaveVideo,
            },
          }
        : current
    );
  }

  const applyClockSnapshot = (
    clock: SessionClockResponse & Pick<SessionSnapshotResponse, 'serviceHealth'>
  ) => {
    elapsedMsRef.current = clock.gameTimeMs;
    lastTickAtRef.current = performance.now();
    const previous = gameStateRef.current;
    if (!previous) return;
    const delta = Math.max(0, clock.gameTimeMs - previous.clock.elapsedMs);
    const next = advanceGameState(
      previous,
      clock.gameTimeMs,
      scenarioRef.current,
      clock.gameSpeed,
      delta,
      clock.alerts,
      clock.chatMessages,
      clock.serviceHealth
    );
    const prevAlertCount = previous.monitors.left.alerts.length;
    if (next.monitors.left.alerts.length > prevAlertCount) {
      for (const alert of next.monitors.left.alerts.slice(prevAlertCount)) {
        playAlertBeep(alert.severity);
      }
    }
    const replayId = sessionRef.current?.replayId;
    if (replayId && eventEmitterRef.current) {
      collectStateTransitions(
        previous,
        next,
        scenarioRef.current,
        Math.round(clock.gameTimeMs),
        eventEmitterRef.current,
        replayId
      );
    }
    gameStateRef.current = next;
    setGameState(next);
    if (clock.gameTimeMs >= clock.timeLimitMs) void endSession('timeout');
  };

  const applyExerciseSnapshot = (snapshot: ExerciseSnapshot) => {
    setExerciseSnapshot(snapshot);
    setGameState((current) =>
      current
        ? {
            ...current,
            room: {
              participants: snapshot.participants,
              tasks: snapshot.tasks,
              incidentLog: snapshot.incidentLog,
              injects: snapshot.injects,
            },
          }
        : current
    );
  };

  const applyParticipantCursor = (event: ParticipantCursorEvent) => {
    const current = gameStateRef.current;
    if (!current) return;
    const existing = current.room.participants.find(
      (participant) => participant.participantId === event.participantId
    );
    if (!existing) return;
    if (existing.cursor && event.updatedAt <= existing.cursor.updatedAt) {
      // Stale event arrived out of order; a newer cursor position is
      // already applied, so ignore this one to avoid snapping backwards.
      return;
    }
    const participants = current.room.participants.map((participant) => {
      if (participant.participantId !== event.participantId) return participant;
      return {
        ...participant,
        online: true,
        cursor: {
          x: event.x,
          y: event.y,
          visible: event.visible,
          updatedAt: event.updatedAt,
        },
      };
    });
    const next = {
      ...current,
      room: {
        ...current.room,
        participants,
      },
    };
    gameStateRef.current = next;
    setGameState(next);
  };

  const bindings: SessionRuntimeBindings = {
    api,
    screen,
    session,
    scenario,
    gameState,
    gameSpeed,
    exerciseSnapshot,
    isStarting,
    participantId,
    refs,
    recordingRef,
    terminalBridgeRef,
    setGameState,
    setScreen,
    setTimeline,
    patchGameStateRef,
    currentGameTimeMs,
    endSession,
    applyClockSnapshot,
    applyExerciseSnapshot,
    applyParticipantCursor,
  };

  async function createSessionForScenario(scenarioId: string) {
    if (creatingSessionRef.current) return;
    creatingSessionRef.current = true;
    setAppError(undefined);
    setDeepLinkReplayId(undefined);
    setDeepLinkValidated(true);
    setIsStarting(true);
    setSandboxReady(false);
    try {
      terminalBridgeRef.current?.destroyTerminal();
      const created = await api.createSession({scenarioId, participantId});
      markJourney(INCIDENT_SPAN_NAMES.journeySessionCreated, {
        [INCIDENT_ATTRS.sessionId]: created.sessionId,
        [INCIDENT_ATTRS.replayId]: created.replayId,
        [INCIDENT_ATTRS.scenarioId]: created.scenario.id,
      });
      api.resetEventSequence();
      eventEmitterRef.current?.reset();
      liveReplayEventIdsRef.current.clear();
      recordingRef.current?.resetRecordingClock();
      elapsedMsRef.current = 0;
      lastTickAtRef.current = 0;
      finishingRef.current = false;
      tabBeaconSentRef.current = false;
      setScenario(created.scenario);
      setSession(created);
      setTimeline([]);
      setGameState(
        createInitialGameState(
          created.scenario,
          created.sessionId,
          created.replayId,
          createEmptyTerminalMirror(),
          {speed: gameSpeed, localParticipantId: participantId}
        )
      );
      setScreen('lobby');
      markJourney(INCIDENT_SPAN_NAMES.journeyBriefingReady, {
        [INCIDENT_ATTRS.sessionId]: created.sessionId,
        [INCIDENT_ATTRS.scenarioId]: created.scenario.id,
      });
      sandboxPrepareSessionIdRef.current = created.sessionId;
      void api
        .prepareSession(created.sessionId)
        .then(() => {
          if (sandboxPrepareSessionIdRef.current === created.sessionId) {
            setSandboxReady(true);
          }
        })
        .catch((error: unknown) => {
          if (sandboxPrepareSessionIdRef.current !== created.sessionId) return;
          setSandboxReady(false);
          setAppError(toErrorMessage(error));
        });
    } catch (error) {
      sandboxPrepareSessionIdRef.current = undefined;
      setAppError(toErrorMessage(error));
    } finally {
      creatingSessionRef.current = false;
      setIsStarting(false);
    }
  }

  async function startPlay() {
    if (
      !session ||
      !scenario ||
      isStarting ||
      !recordingConsent ||
      !sandboxReady
    ) {
      return;
    }
    localStorage.setItem(CONSENT_KEY, '1');
    localStorage.setItem(SAVE_RECORDING_KEY, saveRecording ? '1' : '0');
    setHasRecordingConsent(true);
    setIsStarting(true);
    try {
      await api.startSession(session.sessionId, {participantId});
      // Role gate mirrors the server (see pure/rolePermissions.ts):
      // participants who may not operate the sandbox never attach the
      // shared terminal.
      if (
        canOperateSandbox(exerciseSnapshot?.participants ?? [], participantId)
      ) {
        await terminalBridgeRef.current?.attachTerminalSession(session);
      }
      markJourney(INCIDENT_SPAN_NAMES.journeyTerminalReady, {
        [INCIDENT_ATTRS.sessionId]: session.sessionId,
      });
      elapsedMsRef.current = 0;
      lastTickAtRef.current = performance.now();
      recordingRef.current?.resetRecordingClock();
      setTimeline([]);
      setGameState(
        createInitialGameState(
          scenario,
          session.sessionId,
          session.replayId,
          createEmptyTerminalMirror(),
          {
            sessionStatus: 'running',
            recordingStatus: saveRecording ? 'initializing' : 'idle',
            recordingSaveEnabled: saveRecording,
            speed: gameSpeed,
            localParticipantId: participantId,
          }
        )
      );
      setScreen('play');
      markJourney(INCIDENT_SPAN_NAMES.journeyGameStarted, {
        [INCIDENT_ATTRS.sessionId]: session.sessionId,
        [INCIDENT_ATTRS.scenarioId]: scenario.id,
      });
    } catch (error) {
      setAppError(describeSessionActionError(error, 'start'));
    } finally {
      setIsStarting(false);
    }
  }

  function advanceToBriefing() {
    if (!session) return;
    setScreen('briefing');
    void api
      .advanceExercisePhase(session.sessionId, {
        participantId,
        phase: 'briefing',
      })
      .catch((error: unknown) => {
        setAppError(describeSessionActionError(error, 'phase'));
      });
  }

  async function joinSessionFromInvite(
    inviteSessionId: string,
    writeToken: string
  ) {
    if (creatingSessionRef.current) return;
    creatingSessionRef.current = true;
    setAppError(undefined);
    setDeepLinkReplayId(undefined);
    setDeepLinkValidated(true);
    setIsStarting(true);
    setSandboxReady(false);
    try {
      terminalBridgeRef.current?.destroyTerminal();
      api.setSessionAccessToken(writeToken);
      const snapshot = await api.getSession(inviteSessionId);
      api.resetEventSequence();
      eventEmitterRef.current?.reset();
      liveReplayEventIdsRef.current.clear();
      recordingRef.current?.resetRecordingClock();
      elapsedMsRef.current = 0;
      lastTickAtRef.current = 0;
      finishingRef.current = false;
      tabBeaconSentRef.current = false;
      setScenario(snapshot.scenario);
      setSession({sessionId: snapshot.sessionId, replayId: snapshot.replayId});
      setTimeline([]);
      setGameState(
        createInitialGameState(
          snapshot.scenario,
          snapshot.sessionId,
          snapshot.replayId,
          createEmptyTerminalMirror(),
          {
            sessionStatus: snapshot.status,
            speed: gameSpeed,
            localParticipantId: participantId,
          }
        )
      );
      setScreen('lobby');
      sandboxPrepareSessionIdRef.current = snapshot.sessionId;
      void api
        .prepareSession(snapshot.sessionId)
        .then(() => {
          if (sandboxPrepareSessionIdRef.current === snapshot.sessionId) {
            setSandboxReady(true);
          }
        })
        .catch((error: unknown) => {
          if (sandboxPrepareSessionIdRef.current !== snapshot.sessionId) return;
          setSandboxReady(false);
          setAppError(toErrorMessage(error));
        });
    } catch {
      sandboxPrepareSessionIdRef.current = undefined;
      api.setSessionAccessToken(undefined);
      setAppError(
        '招待リンクからの参加に失敗しました。セッションが見つからないか、リンクが無効です。'
      );
      setScreen('select');
    } finally {
      creatingSessionRef.current = false;
      setIsStarting(false);
    }
  }

  function submitChatMessage() {
    const state = gameStateRef.current;
    const replayId = sessionRef.current?.replayId;
    const emitter = eventEmitterRef.current;
    if (!state || !replayId || !emitter) return;
    const body = state.chatCompose.draft.trim();
    if (!body) return;
    const at = currentGameTimeMs();
    patchGameStateRef((current) => submitPlayerChatMessage(current, body, at));
    void emitter.emit({
      replayId,
      type: 'player_note',
      at,
      payload: {body, channel: 'chat'},
    });
  }

  useSessionBootstrap({
    api,
    deepLinkReplayId,
    deepLinkValidated,
    setScenarios,
    setAppError,
    setTimeline,
    setDeepLinkReplayId,
    setDeepLinkValidated,
    setScreen,
    refs,
  });

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    scenarioRef.current = scenario;
  }, [scenario]);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useSessionClockSync(bindings);
  useSessionLifecycleGuards(bindings);
  useSessionSse(bindings);
  useSessionGameLoop(bindings);
  useExercisePhaseSync(bindings);

  return {
    gameStateRef,
    sessionRef,
    scenarioRef,
    eventEmitterRef,
    patchGameStateRef,
    currentGameTimeMs,
    createSessionForScenario,
    joinSessionFromInvite,
    startPlay,
    advanceToBriefing,
    endSession,
    submitChatMessage,
  };
}

export {readReplayIdFromSearch};
