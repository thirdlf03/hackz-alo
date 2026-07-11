import {useEffect, useMemo, useRef, useState} from 'preact/hooks';
import type {
  AfterActionReport,
  Difficulty,
  ExerciseSnapshot,
  GameRenderState,
  ParticipantRole,
  ScenarioDefinition,
} from '@incident/shared';
import {
  BriefingScreen,
  HotwashScreen,
  LobbyScreen,
  PlayScreen,
  ReplayScreen,
  ResultScreen,
  ScenarioListScreen,
  SelectScreen,
  TopBar,
  type ScenarioSummary,
  type Screen,
} from './AppScreens.js';
import {
  api,
  useCanvasRecording,
  useCanvasRenderer,
  useSessionEditor,
  useTerminalBridge,
} from './appRuntime.js';
import {
  fetchPushPublicKey,
  registerPagerSubscription,
  type PagerSubscriptionPayload,
} from '../api/pushApi.js';
import {useCanvasInteraction} from './useCanvasInteraction.js';
import {useWebMcpTools} from './useWebMcpTools.js';
import {detectHtmlInCanvasSupport} from '../effect/htmlInCanvas.js';
import {useMetricsPolling} from './useMetricsPolling.js';
import {
  readReplayIdFromSearch,
  useSessionRuntime,
  type SessionRecordingBridge,
  type TerminalBridgeRef,
} from './useSessionRuntime.js';
import {
  buildInviteUrl,
  describeSessionActionError,
  readInviteFromSearch,
} from './appUtils.js';
import {isHostParticipant} from '../pure/isHostParticipant.js';
import '@xterm/xterm/css/xterm.css';

const CONSENT_KEY = 'incident-recording-consent';
const SAVE_RECORDING_KEY = 'incident-recording-save';
const PARTICIPANT_ID_KEY = 'incident-participant-id';
const PARTICIPANT_NAME_KEY = 'incident-participant-name';
const PARTICIPANT_ROLE_KEY = 'incident-participant-role';

export function App() {
  const initialReplayId = readReplayIdFromSearch();
  const initialInvite = readInviteFromSearch();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const rendererRef = useRef<{
    scrollMetricsPanel(deltaY: number): void;
    setChatInput(input: HTMLInputElement | null): void;
  } | null>(null);
  const gameSpeedRef = useRef(1);
  const recordingRef = useRef<SessionRecordingBridge | undefined>(undefined);
  const terminalBridgeRef = useRef<TerminalBridgeRef | undefined>(undefined);
  const lastCursorSentAtRef = useRef(0);

  const [screen, setScreen] = useState<Screen>(
    initialReplayId ? 'replay' : 'select'
  );
  const [deepLinkReplayId, setDeepLinkReplayId] = useState(initialReplayId);
  const [deepLinkValidated, setDeepLinkValidated] = useState(!initialReplayId);
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty>();
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [scenario, setScenario] = useState<ScenarioDefinition | undefined>();
  const [exerciseSnapshot, setExerciseSnapshot] = useState<
    ExerciseSnapshot | undefined
  >();
  const [afterActionReport, setAfterActionReport] = useState<
    AfterActionReport | undefined
  >();
  const [session, setSession] = useState<{
    sessionId: string;
    replayId: string;
  }>();
  const [participantId] = useState(() => readOrCreateParticipantId());
  const [htmlInCanvasChat] = useState(() => detectHtmlInCanvasSupport());
  const [participantName, setParticipantName] = useState(
    () => sessionStorage.getItem(PARTICIPANT_NAME_KEY) ?? 'Player'
  );
  const [participantRole, setParticipantRole] = useState<ParticipantRole>(() =>
    readParticipantRole()
  );
  const [gameState, setGameState] = useState<GameRenderState>();
  const [timeline, setTimeline] = useState<Array<{at: number; label: string}>>(
    []
  );
  const [isStarting, setIsStarting] = useState(false);
  const [sandboxReady, setSandboxReady] = useState(false);
  const [gameSpeed, setGameSpeed] = useState(1);
  const [appError, setAppError] = useState<string>();
  const [recordingConsent, setRecordingConsent] = useState(
    () => localStorage.getItem(CONSENT_KEY) === '1'
  );
  const [hasRecordingConsent, setHasRecordingConsent] = useState(
    () => localStorage.getItem(CONSENT_KEY) === '1'
  );
  const [saveRecording, setSaveRecording] = useState(
    () => localStorage.getItem(SAVE_RECORDING_KEY) !== '0'
  );
  const [pagerPublicKey, setPagerPublicKey] = useState<
    string | null | undefined
  >(undefined);
  const [pagerRegistered, setPagerRegistered] = useState(false);
  const [pagerBusy, setPagerBusy] = useState(false);

  const sessionRuntime = useSessionRuntime({
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
  });

  useEffect(() => {
    sessionStorage.setItem(PARTICIPANT_NAME_KEY, participantName);
  }, [participantName]);

  useEffect(() => {
    sessionStorage.setItem(PARTICIPANT_ROLE_KEY, participantRole);
  }, [participantRole]);

  useEffect(() => {
    void fetchPushPublicKey().then(setPagerPublicKey);
  }, []);

  useEffect(() => {
    if (!initialInvite) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('join');
    url.searchParams.delete('wt');
    window.history.replaceState(
      null,
      '',
      `${url.pathname}${url.search}${url.hash}`
    );
    void sessionRuntime.joinSessionFromInvite(
      initialInvite.sessionId,
      initialInvite.writeToken
    );
  }, []);

  useEffect(() => {
    setPagerRegistered(false);
  }, [session?.sessionId]);

  useEffect(() => {
    if (
      !session ||
      !['lobby', 'briefing', 'play', 'result', 'hotwash'].includes(screen)
    ) {
      return;
    }
    let cancelled = false;
    const join = () => {
      void api
        .joinParticipant(session.sessionId, {
          participantId,
          displayName: participantName,
          role: participantRole,
        })
        .then(({exercise}) => {
          if (!cancelled) setExerciseSnapshot(exercise);
        })
        .catch(console.error);
    };
    join();
    const interval = window.setInterval(() => {
      void api
        .heartbeatParticipant(session.sessionId, {participantId})
        .then(({exercise}) => {
          if (!cancelled) setExerciseSnapshot(exercise);
        })
        .catch(console.error);
    }, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    screen,
    session?.sessionId,
    participantId,
    participantName,
    participantRole,
  ]);

  const {
    gameStateRef,
    sessionRef,
    scenarioRef,
    eventEmitterRef,
    patchGameStateRef,
    currentGameTimeMs,
    createSessionForScenario,
    startPlay,
    advanceToBriefing,
    endSession,
    submitChatMessage,
  } = sessionRuntime;

  const isHost = isHostParticipant(exerciseSnapshot, participantId);

  useWebMcpTools({
    api,
    screen,
    session,
    participantId,
    gameStateRef,
    setExerciseSnapshot,
  });

  const registerPager = async () => {
    if (!pagerPublicKey || !session) return;
    if (
      typeof Notification === 'undefined' ||
      !('serviceWorker' in navigator) ||
      typeof PushManager === 'undefined'
    ) {
      return;
    }
    setPagerBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPagerBusy(false);
        return;
      }
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          pagerPublicKey
        ) as BufferSource,
      });
      await registerPagerSubscription(
        session.sessionId,
        api.sessionAccessToken(),
        subscription.toJSON() as PagerSubscriptionPayload
      );
      setPagerRegistered(true);
    } catch (error) {
      console.error(error);
    } finally {
      setPagerBusy(false);
    }
  };

  const {
    attachTerminalSession,
    destroyTerminal,
    handleCanvasPaste,
    handleTerminalKey,
  } = useTerminalBridge({
    api,
    screen,
    participantId,
    gameState,
    gameStateRef,
    sessionRef,
    scenarioRef,
    eventEmitterRef,
    patchGameStateRef,
    currentGameTimeMs,
    submitChatMessage,
  });
  terminalBridgeRef.current = {
    attachTerminalSession,
    destroyTerminal,
  };

  const recording = useCanvasRecording({
    api,
    canvasRef,
    screen,
    session,
    isHost,
    hasRecordingConsent,
    saveRecording,
    gameSpeedRef,
    currentGameTimeMs,
    setGameState,
    setAppError,
  });
  recordingRef.current = recording;

  useCanvasRenderer({
    screen,
    canvasRef,
    chatInputRef,
    rendererRef,
    gameStateRef,
    scenarioRef,
  });

  const {editorTextareaRef, loadEditorFiles, openEditorFile, saveEditorFile} =
    useSessionEditor({
      api,
      screen,
      participantId,
      gameState,
      sessionRef,
      gameStateRef,
      eventEmitterRef,
      patchGameStateRef,
      currentGameTimeMs,
    });

  useMetricsPolling({
    api,
    screen,
    session,
    sessionRef,
    gameStateRef,
    eventEmitterRef,
    patchGameStateRef,
    currentGameTimeMs,
  });

  const {handleCanvasClick, handleCanvasMove, handleCanvasWheel} =
    useCanvasInteraction({
      screen,
      canvasRef,
      chatInputRef,
      rendererRef,
      gameStateRef,
      sessionRef,
      scenarioRef,
      eventEmitterRef,
      patchGameStateRef,
      currentGameTimeMs,
      endSession,
      submitChatMessage,
      loadEditorFiles,
      openEditorFile,
      onCursorMove: (point) => {
        if (!session) return;
        const now = performance.now();
        if (now - lastCursorSentAtRef.current < 80) return;
        lastCursorSentAtRef.current = now;
        void api.updateParticipantCursor(session.sessionId, {
          participantId,
          x: point.x,
          y: point.y,
          visible: true,
        });
      },
    });

  useEffect(() => {
    gameSpeedRef.current = gameSpeed;
  }, [gameSpeed]);

  const filteredScenarios = useMemo(
    () =>
      selectedDifficulty
        ? scenarios.filter((item) => item.difficulty === selectedDifficulty)
        : [],
    [scenarios, selectedDifficulty]
  );
  const canPlayVideo = Boolean(
    saveRecording &&
    session &&
    (gameState?.recording.status === 'ready' ||
      gameState?.recording.status === 'upload_degraded')
  );
  const hasReplayContent = Boolean(
    session && (canPlayVideo || timeline.length > 0)
  );
  const canNavigateToReplay = hasReplayContent && screen === 'result';
  const activeReplayId = session?.replayId ?? deepLinkReplayId;
  const sessionAccessToken = api.sessionAccessToken();
  const inviteUrl =
    session && sessionAccessToken
      ? buildInviteUrl(session.sessionId, sessionAccessToken)
      : undefined;

  function openReplay() {
    if (!canNavigateToReplay) return;
    setScreen('replay');
  }

  return (
    <main class='app-shell' id='main-content'>
      <a href='#main-content' class='skip-link'>
        メインコンテンツへスキップ
      </a>
      <TopBar
        screen={screen}
        isStarting={isStarting}
        canNavigateToReplay={canNavigateToReplay}
        gameSpeed={gameSpeed}
        onSetScreen={setScreen}
        onOpenReplay={openReplay}
        onSetGameSpeed={setGameSpeed}
      />
      {appError && (
        <p class='app-error' role='alert'>
          {appError}
        </p>
      )}

      {screen === 'select' && (
        <SelectScreen
          scenarios={scenarios}
          isStarting={isStarting}
          onSelectDifficulty={(difficulty) => {
            setSelectedDifficulty(difficulty);
            setScreen('scenario-list');
          }}
        />
      )}

      {screen === 'scenario-list' && selectedDifficulty && (
        <ScenarioListScreen
          selectedDifficulty={selectedDifficulty}
          scenarios={filteredScenarios}
          isStarting={isStarting}
          onBack={() => {
            setScreen('select');
          }}
          onStartScenario={(scenarioId) =>
            void createSessionForScenario(scenarioId)
          }
        />
      )}

      {screen === 'briefing' && scenario && session && (
        <BriefingScreen
          scenario={scenario}
          isStarting={isStarting}
          isHost={isHost}
          sandboxReady={sandboxReady}
          recordingConsent={recordingConsent}
          saveRecording={saveRecording}
          pagerAvailable={pagerPublicKey != null}
          pagerRegistered={pagerRegistered}
          pagerBusy={pagerBusy}
          onBack={() => {
            setScreen('scenario-list');
          }}
          onSetRecordingConsent={setRecordingConsent}
          onSetSaveRecording={setSaveRecording}
          onRegisterPager={() => void registerPager()}
          onStartPlay={() => void startPlay()}
        />
      )}

      {screen === 'lobby' && session && scenario && (
        <LobbyScreen
          scenario={scenario}
          participantId={participantId}
          participantName={participantName}
          participantRole={participantRole}
          exercise={exerciseSnapshot}
          sandboxReady={sandboxReady}
          isHost={isHost}
          inviteUrl={inviteUrl}
          onSetParticipantName={setParticipantName}
          onSetParticipantRole={(role) => {
            setParticipantRole(role);
            void api.updateParticipantRole(session.sessionId, {
              participantId,
              role,
            });
          }}
          onReady={() => {
            void api
              .setParticipantReady(session.sessionId, {
                participantId,
                ready: true,
              })
              .then(({exercise}) => {
                setExerciseSnapshot(exercise);
              });
          }}
          onContinue={() => {
            advanceToBriefing();
          }}
        />
      )}

      {screen === 'play' && (
        <PlayScreen
          gameState={gameState}
          gameSpeed={gameSpeed}
          scenario={scenario}
          canvasRef={canvasRef}
          chatInputRef={chatInputRef}
          htmlInCanvasChat={htmlInCanvasChat}
          editorTextareaRef={editorTextareaRef}
          patchGameStateRef={patchGameStateRef}
          onSetGameSpeed={setGameSpeed}
          onSaveEditorFile={() => void saveEditorFile()}
          onCanvasClick={handleCanvasClick}
          onCanvasMove={handleCanvasMove}
          onCanvasWheel={handleCanvasWheel}
          onTerminalKey={handleTerminalKey}
          onCanvasPaste={handleCanvasPaste}
          onChatSubmit={submitChatMessage}
          participantId={participantId}
          exercise={exerciseSnapshot}
          onCreateTask={(title) => {
            if (!session) return;
            void api
              .createTask(session.sessionId, {
                title,
                actorParticipantId: participantId,
              })
              .then(({exercise}) => {
                setExerciseSnapshot(exercise);
              })
              .catch((error: unknown) => {
                setAppError(describeSessionActionError(error, 'task'));
              });
          }}
          onAppendIncidentLog={(body, kind) => {
            if (!session) return;
            void api
              .appendIncidentLog(session.sessionId, {
                body,
                kind: kind ?? 'note',
                actorParticipantId: participantId,
              })
              .then(({exercise}) => {
                setExerciseSnapshot(exercise);
              })
              .catch((error: unknown) => {
                setAppError(describeSessionActionError(error, 'incidentLog'));
              });
          }}
          onFireInject={(injectId) => {
            if (!session) return;
            void api
              .fireInject(session.sessionId, injectId, {
                actorParticipantId: participantId,
                participantId,
              })
              .then(({exercise}) => {
                setExerciseSnapshot(exercise);
              })
              .catch((error: unknown) => {
                setAppError(describeSessionActionError(error, 'fireInject'));
              });
          }}
        />
      )}

      {screen === 'hotwash' && session && (
        <HotwashScreen
          exercise={exerciseSnapshot}
          participantId={participantId}
          report={afterActionReport}
          onSubmit={(input) => {
            void api
              .submitHotwash(session.sessionId, {
                participantId,
                ...input,
              })
              .then(({exercise}) => {
                setExerciseSnapshot(exercise);
              })
              .catch((error: unknown) => {
                setAppError(describeSessionActionError(error, 'hotwash'));
              });
          }}
          onGenerateAar={() => {
            void api
              .getAfterActionReport(session.sessionId)
              .then(({report}) => {
                setAfterActionReport(report);
              });
          }}
          onOpenReplay={openReplay}
        />
      )}

      {screen === 'result' && session && scenario && (
        <ResultScreen
          replayId={session.replayId}
          sessionId={session.sessionId}
          scenario={scenario}
          canOpenReplay={canNavigateToReplay}
          isRetrying={isStarting}
          onGoHome={() => {
            setScreen('select');
          }}
          onRetry={() => {
            void createSessionForScenario(scenario.id);
          }}
          onOpenReplay={openReplay}
          onOpenHotwash={() => {
            setScreen('hotwash');
          }}
        />
      )}

      {screen === 'replay' && activeReplayId && (
        <ReplayScreen
          replayId={activeReplayId}
          deepLinkValidated={deepLinkValidated}
          timeline={session ? timeline : []}
        />
      )}
    </main>
  );
}

function readOrCreateParticipantId() {
  const existing = sessionStorage.getItem(PARTICIPANT_ID_KEY);
  if (existing) return existing;
  const created = `part_${crypto.randomUUID().replaceAll('-', '')}`;
  sessionStorage.setItem(PARTICIPANT_ID_KEY, created);
  return created;
}

function readParticipantRole(): ParticipantRole {
  const value = sessionStorage.getItem(PARTICIPANT_ROLE_KEY);
  if (
    value === 'incident_commander' ||
    value === 'ops' ||
    value === 'scribe' ||
    value === 'comms' ||
    value === 'facilitator' ||
    value === 'observer'
  ) {
    return value;
  }
  return 'ops';
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replaceAll('-', '+')
    .replaceAll('_', '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
