import {useEffect, useMemo, useRef, useState} from 'preact/hooks';
import type {
  Difficulty,
  GameRenderState,
  ScenarioDefinition,
} from '@incident/shared';
import {
  BriefingScreen,
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
import {useCanvasInteraction} from './useCanvasInteraction.js';
import {useMetricsPolling} from './useMetricsPolling.js';
import {
  readReplayIdFromSearch,
  useSessionRuntime,
  type SessionRecordingBridge,
  type TerminalBridgeRef,
} from './useSessionRuntime.js';
import '@xterm/xterm/css/xterm.css';

const CONSENT_KEY = 'incident-recording-consent';
const SAVE_RECORDING_KEY = 'incident-recording-save';

export function App() {
  const initialReplayId = readReplayIdFromSearch();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<{scrollMetricsPanel(deltaY: number): void} | null>(
    null
  );
  const gameSpeedRef = useRef(1);
  const recordingRef = useRef<SessionRecordingBridge | undefined>(undefined);
  const terminalBridgeRef = useRef<TerminalBridgeRef | undefined>(undefined);

  const [screen, setScreen] = useState<Screen>(
    initialReplayId ? 'replay' : 'select'
  );
  const [deepLinkReplayId, setDeepLinkReplayId] = useState(initialReplayId);
  const [deepLinkValidated, setDeepLinkValidated] = useState(!initialReplayId);
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty>();
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [scenario, setScenario] = useState<ScenarioDefinition | undefined>();
  const [session, setSession] = useState<{
    sessionId: string;
    replayId: string;
  }>();
  const [gameState, setGameState] = useState<GameRenderState>();
  const [timeline, setTimeline] = useState<Array<{at: number; label: string}>>(
    []
  );
  const [isStarting, setIsStarting] = useState(false);
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

  const sessionRuntime = useSessionRuntime({
    api,
    screen,
    session,
    scenario,
    gameState,
    gameSpeed,
    saveRecording,
    recordingConsent,
    isStarting,
    deepLinkReplayId,
    deepLinkValidated,
    recordingRef,
    terminalBridgeRef,
    setScreen,
    setSession,
    setScenario,
    setGameState,
    setTimeline,
    setAppError,
    setIsStarting,
    setHasRecordingConsent,
    setDeepLinkReplayId,
    setDeepLinkValidated,
    setScenarios,
  });

  const {
    gameStateRef,
    sessionRef,
    scenarioRef,
    eventEmitterRef,
    patchGameStateRef,
    currentGameTimeMs,
    createSessionForScenario,
    startPlay,
    endSession,
    submitSlackMessage,
  } = sessionRuntime;

  const {
    attachTerminalSession,
    destroyTerminal,
    handleCanvasPaste,
    handleTerminalKey,
  } = useTerminalBridge({
    api,
    screen,
    gameState,
    gameStateRef,
    sessionRef,
    scenarioRef,
    eventEmitterRef,
    patchGameStateRef,
    currentGameTimeMs,
    submitSlackMessage,
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
    rendererRef,
    gameStateRef,
    scenarioRef,
  });

  const {editorTextareaRef, loadEditorFiles, openEditorFile, saveEditorFile} =
    useSessionEditor({
      api,
      screen,
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
      rendererRef,
      gameStateRef,
      sessionRef,
      scenarioRef,
      eventEmitterRef,
      patchGameStateRef,
      currentGameTimeMs,
      endSession,
      submitSlackMessage,
      loadEditorFiles,
      openEditorFile,
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
        gameSpeed={gameSpeed}
        canNavigateToReplay={canNavigateToReplay}
        onSetScreen={setScreen}
        onSetGameSpeed={setGameSpeed}
        onOpenReplay={openReplay}
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

      {screen === 'briefing' && scenario && (
        <BriefingScreen
          scenario={scenario}
          isStarting={isStarting}
          recordingConsent={recordingConsent}
          saveRecording={saveRecording}
          onBack={() => {
            setScreen('scenario-list');
          }}
          onSetRecordingConsent={setRecordingConsent}
          onSetSaveRecording={setSaveRecording}
          onStartPlay={() => void startPlay()}
        />
      )}

      {screen === 'play' && (
        <PlayScreen
          gameState={gameState}
          canvasRef={canvasRef}
          editorTextareaRef={editorTextareaRef}
          patchGameStateRef={patchGameStateRef}
          onSaveEditorFile={() => void saveEditorFile()}
          onCanvasClick={handleCanvasClick}
          onCanvasMove={handleCanvasMove}
          onCanvasWheel={handleCanvasWheel}
          onTerminalKey={handleTerminalKey}
          onCanvasPaste={handleCanvasPaste}
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
