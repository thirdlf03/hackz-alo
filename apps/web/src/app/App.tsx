import {useEffect, useMemo, useRef, useState} from 'preact/hooks';
import {
  replayEventSummary,
  type Difficulty,
  type GameRenderState,
  type ScenarioDefinition,
} from '@incident/shared';
import {
  advanceGameState,
  applyLiveMetrics,
  activateSlackCompose,
  blurCommandInput,
  createInitialGameState,
  decayWorldOverlays,
  deactivateSlackCompose,
  dismissNavigationStep,
  focusCommandInput,
  mergedSlackMessages,
  setActiveRunbook,
  setCenterTool,
  setRightPanelTab,
  setSlackDraft,
  submitPlayerSlackMessage,
  toggleExpandedMonitor,
  toggleNotificationPanel,
  updateEditorPanel,
  visibleRunbooks,
} from '../game/state/gameState.js';
import {
  CanvasRenderer,
  centerEditorOverlayRegion,
  centerToolAt,
  expandedMonitorLayout,
  inputDockRects,
  metricsPanelScrollRegion,
  monitorMagnifyAt,
  navigationOverlayRect,
  notificationBellRegion,
  runbookTabAt,
  rightPanelPrimaryTabAt,
  slackComposeAt,
} from '../game/render/canvasRenderer.js';
import {createEmptyTerminalMirror} from '../game/terminal/mirror.js';
import {
  defaultTerminalDimensions,
  expandedTerminalDimensions,
} from '../game/terminal/layout.js';
import {TerminalSession} from '../game/terminal/session.js';
import {terminalDebug} from '../game/terminal/debug.js';
import {keyboardEventToTerminalInput} from '../game/terminal/input.js';
import {CanvasRecorder} from '../game/recording/recorder.js';
import {playAlertBeep} from '../game/recording/audio.js';
import {RecordingFinalizer} from '../game/recording/finalizer.js';
import {
  installOfflineFlush,
  OfflineUploadQueue,
} from '../game/recording/offlineQueue.js';
import {
  classifyCommandEvent,
  commandEventPayload,
  ReplayEventEmitter,
} from '../game/events/emitReplayEvent.js';
import {detectMetricThresholdCrossings} from '../game/events/monitorEvents.js';
import {collectStateTransitions} from '../game/events/sessionEvents.js';
import {ApiClient, type SessionClockResponse} from '../api/client.js';
import {
  isTimelineEventType,
  type RecordingClockSegment,
} from '../replay/replayMediaUtils.js';
import {ReplayPage} from '../pages/ReplayPage.js';
import {ResultPage} from '../pages/ResultPage.js';
import '@xterm/xterm/css/xterm.css';

type Screen =
  | 'select'
  | 'scenario-list'
  | 'briefing'
  | 'play'
  | 'result'
  | 'replay';
type ScenarioSummary = Pick<
  ScenarioDefinition,
  'id' | 'title' | 'difficulty' | 'timeLimitMinutes'
>;
type FinishMode = 'resolve' | 'retire' | 'timeout';

const CONSENT_KEY = 'incident-recording-consent';
const SAVE_RECORDING_KEY = 'incident-recording-save';
const TUTORIAL_SCENARIO_ID = 'process-stop-001';
const DANGEROUS_COMMAND = /\brm\s+-rf\b/i;
const difficultyOptions: Array<{
  difficulty: Difficulty;
  label: string;
  tone: string;
  summary: string;
}> = [
  {
    difficulty: 'beginner',
    label: '初級',
    tone: 'green',
    summary: '監視とログを順番に追う短い初動訓練',
  },
  {
    difficulty: 'intermediate',
    label: '中級',
    tone: 'amber',
    summary: '原因候補を絞り込みながら復旧まで進める訓練',
  },
  {
    difficulty: 'advanced',
    label: '上級',
    tone: 'red',
    summary: '少ない手掛かりから仮説を立てて完走する訓練',
  },
];
const speedOptions = [0.5, 1, 1.5, 2, 4, 8] as const;

const api = new ApiClient();
const offlineQueue = new OfflineUploadQueue(api);
const recordingFlushRef: {stop?: () => void} = {};
installOfflineFlush(offlineQueue, () => recordingFlushRef.stop?.());

function readReplayIdFromSearch() {
  if (typeof window === 'undefined') return undefined;
  const replayId = new URLSearchParams(window.location.search)
    .get('replay')
    ?.trim();
  return replayId || undefined;
}

export function App() {
  const initialReplayId = readReplayIdFromSearch();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const editorTextareaRef = useRef<HTMLTextAreaElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const recorderRef = useRef<CanvasRecorder | null>(null);
  const finalizerRef = useRef<RecordingFinalizer | null>(null);
  const saveRecordingRef = useRef(true);
  const gameStateRef = useRef<GameRenderState | undefined>(undefined);
  const elapsedMsRef = useRef(0);
  const lastTickAtRef = useRef(0);
  const gameSpeedRef = useRef(1);
  const terminalRef = useRef<TerminalSession | null>(null);
  const sessionRef = useRef<{sessionId: string; replayId: string} | undefined>(
    undefined
  );
  const scenarioRef = useRef<ScenarioDefinition | undefined>(undefined);
  const eventEmitterRef = useRef<ReplayEventEmitter | null>(null);
  const finishingRef = useRef(false);
  const tabBeaconSentRef = useRef(false);
  const recordingStartedAtGameMsRef = useRef(0);
  const recordingClockSegmentsRef = useRef<RecordingClockSegment[]>([]);
  const liveReplayEventIdsRef = useRef(new Set<string>());

  const [screen, setScreen] = useState<Screen>(
    initialReplayId ? 'replay' : 'select'
  );
  const [deepLinkReplayId, setDeepLinkReplayId] = useState(initialReplayId);
  const [deepLinkValidated, setDeepLinkValidated] = useState(!initialReplayId);
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty>();
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [scenario, setScenario] = useState<ScenarioDefinition>();
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

  const patchGameStateRef = (
    updater: (state: GameRenderState) => GameRenderState,
    options: {render?: boolean; collectTransitions?: boolean} = {}
  ) => {
    const current = gameStateRef.current;
    if (!current) return;
    const next = updater(current);
    if (next === current) return;
    const replayId = sessionRef.current?.replayId;
    if (
      options.collectTransitions !== false &&
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
    if (options.render !== false) setGameState(next);
  };

  function currentGameTimeMs() {
    const current = gameStateRef.current;
    const baseMs = elapsedMsRef.current;
    const lastTickAt = lastTickAtRef.current;
    if (screen !== 'play' || !current || !lastTickAt || finishingRef.current) {
      return Math.round(baseMs);
    }
    const elapsedSinceTickMs =
      Math.max(0, performance.now() - lastTickAt) * current.clock.speed;
    return Math.round(
      Math.min(current.clock.timeLimitMs, baseMs + elapsedSinceTickMs)
    );
  }

  function appendRecordingClockSegment(segment: RecordingClockSegment) {
    const previous = recordingClockSegmentsRef.current.at(-1);
    if (
      previous &&
      previous.gameMs === segment.gameMs &&
      previous.videoMs === segment.videoMs
    ) {
      recordingClockSegmentsRef.current = [
        ...recordingClockSegmentsRef.current.slice(0, -1),
        segment,
      ];
      return;
    }
    if (previous && previous.speed === segment.speed) return;
    recordingClockSegmentsRef.current = [
      ...recordingClockSegmentsRef.current,
      segment,
    ];
  }

  const applyClockSnapshot = (clock: SessionClockResponse) => {
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
      clock.slackMessages
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

  useEffect(() => {
    recordingFlushRef.stop = () => {
      void recorderRef.current?.stop().catch(console.error);
    };
    api
      .listScenarios()
      .then(setScenarios)
      .catch((error: unknown) => {
        setAppError(toErrorMessage(error));
      });
    eventEmitterRef.current = new ReplayEventEmitter(api, (at, label) => {
      setTimeline((items) => [...items, {at, label}]);
    });
    return () => {
      delete recordingFlushRef.stop;
    };
  }, []);

  useEffect(() => {
    if (!deepLinkReplayId || deepLinkValidated) return;
    let cancelled = false;
    api
      .getReplay(deepLinkReplayId)
      .then(() => {
        if (cancelled) return;
        setDeepLinkValidated(true);
        setScreen('replay');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setAppError(toErrorMessage(error));
        setDeepLinkReplayId(undefined);
        setDeepLinkValidated(true);
        setScreen('select');
      });
    return () => {
      cancelled = true;
    };
  }, [deepLinkReplayId, deepLinkValidated]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    scenarioRef.current = scenario;
  }, [scenario]);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);
  useEffect(() => {
    saveRecordingRef.current = saveRecording;
  }, [saveRecording]);
  useEffect(() => {
    gameSpeedRef.current = gameSpeed;
    const previous = gameStateRef.current;
    if (previous && screen === 'play') {
      const now = performance.now();
      const lastTickAt = lastTickAtRef.current || now;
      const oldSpeed = previous.clock.speed;
      const snapped = Math.min(
        previous.clock.timeLimitMs,
        Math.round(
          previous.clock.elapsedMs + Math.max(0, now - lastTickAt) * oldSpeed
        )
      );
      elapsedMsRef.current = snapped;
      lastTickAtRef.current = now;
      const activeRecorder = recorderRef.current;
      if (
        oldSpeed !== gameSpeed &&
        activeRecorder &&
        recordingClockSegmentsRef.current.length > 0
      ) {
        appendRecordingClockSegment({
          gameMs: snapped,
          videoMs: activeRecorder.currentElapsedMs,
          speed: gameSpeed,
        });
      }
      const next = advanceGameState(
        previous,
        snapped,
        scenarioRef.current,
        gameSpeed,
        0,
        previous.monitors.left.alerts,
        previous.monitors.right.slackMessages
      );
      gameStateRef.current = next;
      setGameState(next);
    } else if (previous) {
      patchGameStateRef((current) => ({
        ...current,
        clock: {...current.clock, speed: gameSpeed},
      }));
    }
    const activeSession = sessionRef.current;
    if (screen === 'play' && activeSession) {
      void api
        .updateSessionClock(activeSession.sessionId, gameSpeed)
        .then(applyClockSnapshot)
        .catch(console.error);
    }
  }, [gameSpeed, screen]);

  useEffect(
    () => () => {
      terminalRef.current?.destroy();
    },
    []
  );

  useEffect(() => {
    const onPageHide = () => {
      if (finishingRef.current || tabBeaconSentRef.current) return;
      const activeSession = sessionRef.current;
      if (!activeSession || screen !== 'play') return;
      tabBeaconSentRef.current = true;
      api.notifySessionTimeout(activeSession.sessionId);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [screen]);

  useEffect(() => {
    if (screen !== 'play') return;
    let hiddenSince: number | undefined;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (hiddenSince === undefined) hiddenSince = Date.now();
        return;
      }
      hiddenSince = undefined;
    };
    const timer = window.setInterval(() => {
      if (
        finishingRef.current ||
        tabBeaconSentRef.current ||
        hiddenSince === undefined
      ) {
        return;
      }
      const activeSession = sessionRef.current;
      if (!activeSession) return;
      if (Date.now() - hiddenSince < 90_000) return;
      hiddenSince = undefined;
      tabBeaconSentRef.current = true;
      api.notifySessionTimeout(activeSession.sessionId);
    }, 5_000);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
  }, [screen]);

  useEffect(() => {
    if (screen !== 'play' || !canvasRef.current) return;
    const renderer = new CanvasRenderer(canvasRef.current);
    rendererRef.current = renderer;
    let frame = 0;
    let lastState: GameRenderState | undefined;
    let lastScenario: ScenarioDefinition | undefined;
    const draw = () => {
      const latest = gameStateRef.current;
      const scenario = scenarioRef.current;
      const animate = Boolean(latest?.commandInputFocused);
      if (
        latest &&
        (animate || latest !== lastState || scenario !== lastScenario)
      ) {
        renderer.draw(latest, scenario);
        if (!animate) {
          lastState = latest;
          lastScenario = scenario;
        }
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(frame);
      rendererRef.current = null;
    };
  }, [screen]);

  useEffect(() => {
    if (
      screen !== 'play' ||
      !session ||
      !canvasRef.current ||
      recorderRef.current ||
      !hasRecordingConsent ||
      !saveRecording
    ) {
      return;
    }
    const finalizer = new RecordingFinalizer();
    finalizerRef.current = finalizer;
    const recorder = new CanvasRecorder(canvasRef.current, {
      replayId: session.replayId,
      onChunk: async (chunk) => {
        await finalizer.append(chunk.blob);
        try {
          await api.uploadChunk(session.replayId, chunk);
        } catch {
          await offlineQueue.enqueueChunk({
            replayId: session.replayId,
            ...chunk,
          });
        }
      },
      onEvent: async (event) => {
        try {
          await api.uploadEvents(session.replayId, [event]);
        } catch {
          await offlineQueue.enqueueEvents(session.replayId, [event]);
        }
      },
    });
    recorderRef.current = recorder;
    setGameState((current) => updateRecordingStatus(current, 'initializing'));
    try {
      recorder.start();
      recordingStartedAtGameMsRef.current = currentGameTimeMs();
      recordingClockSegmentsRef.current = [
        {
          gameMs: recordingStartedAtGameMsRef.current,
          videoMs: 0,
          speed: gameSpeedRef.current,
        },
      ];
      setGameState((current) => updateRecordingStatus(current, 'recording'));
    } catch (error: unknown) {
      recorderRef.current = null;
      setAppError(toErrorMessage(error));
      setGameState((current) =>
        updateRecordingStatus(current, classifyRecordingError(error))
      );
    }
    return () => {
      if (recorderRef.current === recorder) {
        recorderRef.current = null;
        void recorder.stop().catch(console.error);
      }
      if (finalizerRef.current === finalizer) finalizerRef.current = null;
    };
  }, [screen, session?.replayId, hasRecordingConsent, saveRecording]);

  useEffect(() => {
    if (screen !== 'play' || !session) return;
    const source = api.subscribeSessionEvents(session.sessionId, {
      onSnapshot: applyClockSnapshot,
      onReplay: (event) => {
        if (
          liveReplayEventIdsRef.current.has(event.id) ||
          !isTimelineEventType(event.type)
        ) {
          return;
        }
        liveReplayEventIdsRef.current.add(event.id);
        setTimeline((items) => [
          ...items,
          {at: event.at / 1000, label: replayEventSummary(event)},
        ]);
      },
      onError: console.error,
    });
    return () => {
      source.close();
    };
  }, [screen, session?.sessionId]);

  useEffect(() => {
    if (screen !== 'play' || !session) return;
    const timer = window.setInterval(() => {
      if (finishingRef.current || document.visibilityState === 'hidden') return;
      const previous = gameStateRef.current;
      if (!previous) return;
      const now = performance.now();
      const lastTickAt = lastTickAtRef.current || now;
      lastTickAtRef.current = now;
      const delta = Math.max(0, (now - lastTickAt) * previous.clock.speed);
      if (delta === 0) return;
      const elapsedMs = Math.min(
        previous.clock.timeLimitMs,
        previous.clock.elapsedMs + delta
      );
      elapsedMsRef.current = elapsedMs;
      const next = advanceGameState(
        previous,
        elapsedMs,
        scenarioRef.current,
        previous.clock.speed,
        delta,
        previous.monitors.left.alerts,
        previous.monitors.right.slackMessages
      );
      gameStateRef.current = next;
      setGameState(next);
      if (elapsedMs >= next.clock.timeLimitMs) void endSession('timeout');
    }, 500);
    return () => {
      window.clearInterval(timer);
    };
  }, [screen, session?.sessionId]);

  useEffect(() => {
    if (screen !== 'play') return;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const delta = now - last;
      last = now;
      patchGameStateRef((current) => decayWorldOverlays(current, delta), {
        render: false,
        collectTransitions: false,
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [screen]);

  useEffect(() => {
    if (screen !== 'play' || !session) return;
    const pollState = {aborted: false};
    const controller = new AbortController();
    controller.signal.addEventListener('abort', () => {
      pollState.aborted = true;
    });
    let timer = 0;
    const poll = async () => {
      if (pollState.aborted || document.visibilityState === 'hidden') {
        return;
      }
      try {
        const metrics = await api.getSessionMetrics(session.sessionId);
        const previous = gameStateRef.current?.monitors.left.metrics;
        patchGameStateRef((current) => applyLiveMetrics(current, metrics));
        const replayId = sessionRef.current?.replayId;
        const emitter = eventEmitterRef.current;
        if (replayId && emitter && previous) {
          for (const crossing of detectMetricThresholdCrossings(
            previous,
            metrics
          )) {
            void emitter.emitOnce(`metric:${crossing.key}`, {
              replayId,
              type: 'monitor_update',
              at: currentGameTimeMs(),
              actor: 'system',
              payload: {
                metric: crossing.key,
                label: crossing.label,
                value: metrics[crossing.key],
              },
            });
          }
        }
      } catch {
        patchGameStateRef((current) => ({
          ...current,
          monitors: {
            ...current.monitors,
            left: {...current.monitors.left, metricsSource: 'offline'},
          },
        }));
      }
    };
    void poll();
    timer = window.setInterval(() => {
      void poll();
    }, 5000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [screen, session?.sessionId]);

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

  async function createSessionForScenario(scenarioId: string) {
    setAppError(undefined);
    setDeepLinkReplayId(undefined);
    setDeepLinkValidated(true);
    setIsStarting(true);
    try {
      terminalRef.current?.destroy();
      terminalRef.current = null;
      const created = await api.createSession({scenarioId});
      api.resetEventSequence();
      eventEmitterRef.current?.reset();
      liveReplayEventIdsRef.current.clear();
      recordingStartedAtGameMsRef.current = 0;
      recordingClockSegmentsRef.current = [];
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
          {speed: gameSpeed}
        )
      );
      setScreen('briefing');
    } catch (error) {
      setAppError(toErrorMessage(error));
    } finally {
      setIsStarting(false);
    }
  }

  async function attachTerminalSession(activeSession: {
    sessionId: string;
    replayId: string;
  }) {
    terminalRef.current?.destroy();
    const {cols, rows} = defaultTerminalDimensions();
    await api.resizeTerminal(activeSession.sessionId, cols, rows);
    const terminal = new TerminalSession({
      sessionId: activeSession.sessionId,
      cols,
      rows,
      onResize: (nextCols, nextRows) => {
        void api
          .resizeTerminal(activeSession.sessionId, nextCols, nextRows)
          .catch(console.error);
      },
      onSnapshot: (snapshot) => {
        patchGameStateRef((current) => ({
          ...current,
          monitors: {
            ...current.monitors,
            center: {...current.monitors.center, terminal: snapshot},
          },
        }));
      },
      onOutput: (summary) => {
        const replayId = sessionRef.current?.replayId;
        const emitter = eventEmitterRef.current;
        if (!replayId || !emitter || !summary.trim()) return;
        void emitter.emit({
          replayId,
          type: 'terminal_output',
          at: currentGameTimeMs(),
          actor: 'sandbox',
          payload: {data: summary},
        });
      },
      onCommand: (command) => {
        const replayId = sessionRef.current?.replayId;
        const emitter = eventEmitterRef.current;
        if (!replayId || !emitter) return;
        const at = currentGameTimeMs();
        if (
          DANGEROUS_COMMAND.test(command) &&
          scenarioRef.current?.difficulty === 'beginner'
        ) {
          patchGameStateRef((current) => ({
            ...current,
            warning: {
              message:
                '危険: rm -rf は本番では慎重に。Runbook を確認してください。',
              flashMs: 4000,
            },
          }));
        }
        void emitter.emit({
          replayId,
          type: 'terminal_input',
          at,
          payload: {data: `${command}\n`},
          visibility: 'sensitive',
        });
        void emitter.emit({
          replayId,
          type: 'command_detected',
          at,
          payload: {command},
        });
        const special = classifyCommandEvent(command);
        if (special) {
          void emitter.emit({
            replayId,
            type: special,
            at,
            payload: commandEventPayload(command, special),
          });
        }
      },
    });
    terminalRef.current = terminal;
    terminal.connect();
  }

  function syncTerminalViewport() {
    const terminal = terminalRef.current;
    if (!terminal || screen !== 'play') return;
    const expanded = gameStateRef.current?.world.expandedMonitor;
    const {cols, rows} =
      expanded === 'terminal'
        ? expandedTerminalDimensions()
        : defaultTerminalDimensions();
    terminal.resize(cols, rows);
  }

  useEffect(() => {
    if (screen !== 'play') return;
    syncTerminalViewport();
  }, [screen, gameState?.world.expandedMonitor]);

  useEffect(() => {
    if (
      screen !== 'play' ||
      gameState?.monitors.center.activeTool !== 'editor'
    ) {
      return;
    }
    window.setTimeout(() => editorTextareaRef.current?.focus(), 0);
  }, [
    screen,
    gameState?.monitors.center.activeTool,
    gameState?.monitors.center.editor.currentPath,
  ]);

  async function loadEditorFiles(preferredPath?: string) {
    const activeSession = sessionRef.current;
    if (!activeSession) return;
    patchGameStateRef((current) =>
      updateEditorPanel(current, (editor) => ({
        ...editor,
        status: 'loading',
        error: undefined,
      }))
    );
    try {
      const response = await api.listSessionFiles(activeSession.sessionId);
      const files =
        response.files.length > 0
          ? response.files
          : (gameStateRef.current?.monitors.center.editor.files ?? []);
      const targetPath =
        preferredPath ??
        gameStateRef.current?.monitors.center.editor.currentPath ??
        files[0]?.path;
      patchGameStateRef((current) =>
        updateEditorPanel(current, (editor) => ({...editor, files}))
      );
      if (targetPath) await openEditorFile(targetPath, {skipListRefresh: true});
      else {
        patchGameStateRef((current) =>
          updateEditorPanel(current, (editor) => ({...editor, status: 'ready'}))
        );
      }
    } catch (error) {
      patchGameStateRef((current) =>
        updateEditorPanel(current, (editor) => ({
          ...editor,
          status: 'error',
          error: toErrorMessage(error),
        }))
      );
    }
  }

  async function openEditorFile(
    path: string,
    options: {skipListRefresh?: boolean} = {}
  ) {
    const activeSession = sessionRef.current;
    if (!activeSession) return;
    if (
      !options.skipListRefresh &&
      gameStateRef.current?.monitors.center.editor.files.length === 0
    ) {
      await loadEditorFiles(path);
      return;
    }
    patchGameStateRef((current) =>
      updateEditorPanel(current, (editor) => ({
        ...editor,
        currentPath: path,
        status: 'loading',
        error: undefined,
      }))
    );
    try {
      const file = await api.readSessionFile(activeSession.sessionId, path);
      patchGameStateRef((current) =>
        updateEditorPanel(current, (editor) => ({
          ...editor,
          currentPath: file.path,
          content: file.content,
          savedContent: file.content,
          dirty: false,
          status: 'ready',
          error: undefined,
          cursor: {line: 1, column: 1},
        }))
      );
      const replayId = sessionRef.current?.replayId;
      const emitter = eventEmitterRef.current;
      if (replayId && emitter) {
        void emitter.emit({
          replayId,
          type: 'file_opened',
          at: currentGameTimeMs(),
          payload: {path: file.path},
        });
      }
    } catch (error) {
      patchGameStateRef((current) =>
        updateEditorPanel(current, (editor) => ({
          ...editor,
          status: 'error',
          error: toErrorMessage(error),
        }))
      );
    }
  }

  async function saveEditorFile() {
    const activeSession = sessionRef.current;
    const editor = gameStateRef.current?.monitors.center.editor;
    if (!activeSession || !editor?.currentPath || editor.status === 'saving') {
      return;
    }
    patchGameStateRef((current) =>
      updateEditorPanel(current, (value) => ({
        ...value,
        status: 'saving',
        error: undefined,
      }))
    );
    try {
      const saved = await api.writeSessionFile(
        activeSession.sessionId,
        editor.currentPath,
        editor.content
      );
      patchGameStateRef((current) =>
        updateEditorPanel(current, (value) => ({
          ...value,
          currentPath: saved.path,
          savedContent: value.content,
          dirty: false,
          status: 'ready',
          error: undefined,
        }))
      );
      const replayId = sessionRef.current?.replayId;
      const emitter = eventEmitterRef.current;
      if (replayId && emitter) {
        void emitter.emit({
          replayId,
          type: 'file_saved',
          at: currentGameTimeMs(),
          payload: {path: saved.path, byteLength: saved.byteLength},
        });
      }
    } catch (error) {
      patchGameStateRef((current) =>
        updateEditorPanel(current, (value) => ({
          ...value,
          status: 'error',
          error: toErrorMessage(error),
        }))
      );
    }
  }

  async function startPlay() {
    if (!session || !scenario || isStarting || !recordingConsent) return;
    localStorage.setItem(CONSENT_KEY, '1');
    localStorage.setItem(SAVE_RECORDING_KEY, saveRecording ? '1' : '0');
    setHasRecordingConsent(true);
    setIsStarting(true);
    try {
      await api.startSession(session.sessionId);
      await attachTerminalSession(session);
      elapsedMsRef.current = 0;
      lastTickAtRef.current = performance.now();
      recordingStartedAtGameMsRef.current = 0;
      recordingClockSegmentsRef.current = [];
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
          }
        )
      );
      setScreen('play');
    } catch (error) {
      setAppError(toErrorMessage(error));
    } finally {
      setIsStarting(false);
    }
  }

  function submitSlackMessage() {
    const state = gameStateRef.current;
    const replayId = sessionRef.current?.replayId;
    const emitter = eventEmitterRef.current;
    if (!state || !replayId || !emitter) return;
    const body = state.slackCompose.draft.trim();
    if (!body) return;
    const at = currentGameTimeMs();
    patchGameStateRef((current) => submitPlayerSlackMessage(current, body, at));
    void emitter.emit({
      replayId,
      type: 'player_note',
      at,
      payload: {body, channel: 'slack'},
    });
  }

  async function endSession(mode: FinishMode) {
    if (!session || finishingRef.current) return;
    finishingRef.current = true;
    const shouldSaveVideo = saveRecordingRef.current && hasRecordingConsent;
    const activeRecorder = recorderRef.current;
    const recordingMimeType = activeRecorder?.mimeType;
    setGameState((current) =>
      updateRecordingStatus(current, shouldSaveVideo ? 'stopping' : 'idle')
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

    terminalRef.current?.destroy();
    terminalRef.current = null;

    if (shouldSaveVideo) {
      await activeRecorder?.stop().catch((error: unknown) => {
        setAppError(toErrorMessage(error));
      });
      const videoDurationMs = activeRecorder?.durationMs;
      recorderRef.current = null;
      await offlineQueue.flush();
      setGameState((current) => updateRecordingStatus(current, 'finalizing'));
      const finalized =
        (await finalizerRef.current
          ?.finalize(session.replayId, api)
          .catch(() => false)) ?? false;
      finalizerRef.current = null;
      if (!finalized) {
        const headOk = await fetch(
          `/api/replays/${encodeURIComponent(session.replayId)}/video`,
          {method: 'HEAD'}
        )
          .then((response) => response.ok)
          .catch(() => false);
        if (!headOk) {
          await api
            .assemblePartialReplayVideo(session.replayId)
            .catch(() => undefined);
        }
      }
      await api
        .finishReplay(session.replayId, {
          browserInfo: {
            userAgent: navigator.userAgent,
            mimeType: recordingMimeType,
            recordingStartedAtGameMs: recordingStartedAtGameMsRef.current,
            recordingClockSegments: recordingClockSegmentsRef.current,
          },
          ...(videoDurationMs === undefined ? {} : {videoDurationMs}),
        })
        .catch(console.error);
    } else {
      recorderRef.current = null;
      finalizerRef.current = null;
      await offlineQueue.flush();
      await api
        .finishReplay(session.replayId, {
          browserInfo: {
            userAgent: navigator.userAgent,
            mimeType: recordingMimeType,
            recordingStartedAtGameMs: recordingStartedAtGameMsRef.current,
            recordingClockSegments: recordingClockSegmentsRef.current,
          },
        })
        .catch(console.error);
    }
    const status =
      mode === 'retire' ? 'retired' : resolved ? 'resolved' : 'failed';
    let recordingStatus: GameRenderState['recording']['status'] = 'idle';
    if (shouldSaveVideo) {
      const videoOk = await fetch(
        `/api/replays/${encodeURIComponent(session.replayId)}/video`,
        {method: 'HEAD'}
      )
        .then((response) => response.ok)
        .catch(() => false);
      recordingStatus = videoOk ? 'ready' : 'upload_degraded';
    }
    setGameState((current) =>
      current
        ? {
            ...current,
            session: {...current.session, status},
            recording: {
              ...current.recording,
              status: recordingStatus,
              saveEnabled: shouldSaveVideo,
            },
          }
        : current
    );
    setScreen('result');
  }

  function handleCanvasClick(event: MouseEvent) {
    if (!canvasRef.current) return;
    canvasRef.current.focus();
    const point = toLogicalCanvasPoint(event, canvasRef.current);
    const replayId = sessionRef.current?.replayId;
    const emitter = eventEmitterRef.current;
    if (screen === 'play' && replayId && emitter) {
      const at = currentGameTimeMs();
      void emitter.emit({
        replayId,
        type: 'ui_click',
        at,
        payload: {x: point.x, y: point.y},
      });
      if (containsPoint(inputDockRects.button, point.x, point.y)) {
        return void endSession('resolve');
      }
      if (containsPoint(inputDockRects.retire, point.x, point.y)) {
        return void endSession('retire');
      }
      if (containsPoint(inputDockRects.input, point.x, point.y)) {
        patchGameStateRef((current) =>
          focusCommandInput(deactivateSlackCompose(current))
        );
        return;
      }
      patchGameStateRef((current) => blurCommandInput(current));
      const centerTool = centerToolAt(point.x, point.y);
      if (centerTool) {
        patchGameStateRef((current) => setCenterTool(current, centerTool));
        void emitter.emit({
          replayId,
          type: 'ui_panel_open',
          at,
          payload: {panel: centerTool},
        });
        if (centerTool === 'editor') void loadEditorFiles();
        return;
      }
      const editorFilePath = editorFileAt(
        point.x,
        point.y,
        gameStateRef.current
      );
      if (editorFilePath) {
        patchGameStateRef((current) => setCenterTool(current, 'editor'));
        void openEditorFile(editorFilePath);
        return;
      }
      const activeScenario = scenarioRef.current;
      if (activeScenario) {
        const expandedMonitor =
          gameStateRef.current?.world.expandedMonitor ?? null;
        const activePanelTab =
          gameStateRef.current?.monitors.right.activePanelTab ?? 'runbook';
        const primaryTab = rightPanelPrimaryTabAt(
          point.x,
          point.y,
          expandedMonitor
        );
        if (primaryTab) {
          patchGameStateRef((current) => setRightPanelTab(current, primaryTab));
          void emitter.emit({
            replayId,
            type: 'ui_panel_open',
            at,
            payload: {panel: primaryTab === 'slack' ? 'slack' : 'runbook'},
          });
          return;
        }
        const visibleRunbookList = visibleRunbooks(
          activeScenario,
          gameStateRef.current?.clock.elapsedMs ?? 0
        );
        const tabIndex = runbookTabAt(
          point.x,
          point.y,
          visibleRunbookList.length,
          visibleRunbookList.map((item) => item.title),
          expandedMonitor,
          activePanelTab
        );
        if (tabIndex >= 0) {
          patchGameStateRef((current) =>
            setActiveRunbook(current, activeScenario, tabIndex)
          );
          const runbook = visibleRunbookList[tabIndex];
          if (runbook) {
            void emitter.emitOnce(`runbook:${runbook.id}`, {
              replayId,
              type: 'runbook_open',
              at,
              payload: {runbookId: runbook.id},
            });
          }
          return;
        }
      }
      if (containsPoint(notificationBellRegion, point.x, point.y)) {
        const unreadAlerts =
          gameStateRef.current?.monitors.left.alerts.filter(
            (alert) =>
              !gameStateRef.current?.notifications.readAlertIds.includes(
                alert.id
              )
          ) ?? [];
        const unreadSlack = gameStateRef.current
          ? mergedSlackMessages(gameStateRef.current).filter(
              (message) =>
                !gameStateRef.current?.seenSlackIds.includes(message.id)
            )
          : [];
        patchGameStateRef((current) => toggleNotificationPanel(current));
        void emitter.emit({
          replayId,
          type: 'ui_panel_open',
          at,
          payload: {panel: 'notifications'},
        });
        for (const alert of unreadAlerts) {
          void emitter.emitOnce(`slack-read:${alert.id}`, {
            replayId,
            type: 'slack_message_read',
            at,
            payload: {alertId: alert.id, message: alert.message},
          });
        }
        for (const message of unreadSlack) {
          void emitter.emitOnce(`slack-read:${message.id}`, {
            replayId,
            type: 'slack_message_read',
            at,
            payload: {
              messageId: message.id,
              from: message.from,
              body: message.body,
            },
          });
        }
        return;
      }
      if (
        containsPoint(navigationOverlayRect, point.x, point.y) &&
        gameStateRef.current?.navigation.activeStepId
      ) {
        const stepId = gameStateRef.current.navigation.activeStepId;
        patchGameStateRef((current) => dismissNavigationStep(current, stepId));
        return;
      }
      if (gameStateRef.current?.world.expandedMonitor) {
        if (!containsPoint(expandedMonitorLayout, point.x, point.y)) {
          patchGameStateRef((current) => ({
            ...current,
            world: {...current.world, expandedMonitor: null},
          }));
        }
        return;
      }
      const monitorMagnify = monitorMagnifyAt(point.x, point.y);
      if (monitorMagnify) {
        patchGameStateRef((current) =>
          toggleExpandedMonitor(current, monitorMagnify)
        );
        void emitter.emit({
          replayId,
          type: 'ui_panel_open',
          at,
          payload: {panel: `monitor.${monitorMagnify}`},
        });
        return;
      }
      const slackTarget = slackComposeAt(
        point.x,
        point.y,
        gameStateRef.current?.monitors.right.activePanelTab ?? 'slack',
        gameStateRef.current?.world.expandedMonitor ?? null
      );
      if (slackTarget === 'send') {
        submitSlackMessage();
        return;
      }
      if (slackTarget === 'compose') {
        patchGameStateRef((current) => activateSlackCompose(current));
        void emitter.emit({
          replayId,
          type: 'ui_panel_open',
          at,
          payload: {panel: 'slack_compose'},
        });
        return;
      }
      if (gameStateRef.current?.slackCompose.active) {
        patchGameStateRef((current) => deactivateSlackCompose(current));
      }
    }
  }

  function handleCanvasMove(event: MouseEvent) {
    if (!canvasRef.current || screen !== 'play') return;
    const point = toLogicalCanvasPoint(event, canvasRef.current);
    patchGameStateRef(
      (current) => {
        const cursor = current.cursor;
        if (
          Math.abs(cursor.x - point.x) < 1 &&
          Math.abs(cursor.y - point.y) < 1 &&
          cursor.visible
        ) {
          return current;
        }
        return {...current, cursor: {x: point.x, y: point.y, visible: true}};
      },
      {render: false, collectTransitions: false}
    );
  }

  function handleCanvasWheel(event: WheelEvent) {
    if (!canvasRef.current || screen !== 'play') return;
    const expandedMonitor = gameStateRef.current?.world.expandedMonitor ?? null;
    if (expandedMonitor && expandedMonitor !== 'metrics') return;
    const point = toLogicalCanvasPoint(event, canvasRef.current);
    if (
      !containsPoint(
        metricsPanelScrollRegion(expandedMonitor === 'metrics'),
        point.x,
        point.y
      )
    ) {
      return;
    }

    event.preventDefault();
    rendererRef.current?.scrollMetricsPanel(event.deltaY);
  }

  function handleTerminalKey(event: KeyboardEvent) {
    if (screen !== 'play') return;
    if (gameStateRef.current?.monitors.center.activeTool === 'editor') return;
    if (gameStateRef.current?.slackCompose.active) {
      if (event.key === 'Escape') {
        event.preventDefault();
        patchGameStateRef((current) => deactivateSlackCompose(current));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        submitSlackMessage();
        return;
      }
      if (event.key === 'Backspace') {
        event.preventDefault();
        patchGameStateRef((current) =>
          setSlackDraft(current, current.slackCompose.draft.slice(0, -1))
        );
        return;
      }
      if (
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        patchGameStateRef((current) =>
          setSlackDraft(current, `${current.slackCompose.draft}${event.key}`)
        );
      }
      return;
    }
    if (!terminalRef.current) return;
    if (!gameStateRef.current?.commandInputFocused) {
      patchGameStateRef((current) => focusCommandInput(current));
    }
    const input = keyboardEventToTerminalInput(event);
    if (!input) return;
    event.preventDefault();
    if (event.ctrlKey && event.key.toLowerCase() === 'c') {
      terminalDebug('keydown.ctrl-c', {interruptOnly: true});
      const activeSession = sessionRef.current;
      if (activeSession) {
        void api.interruptTerminal(activeSession.sessionId).catch(() => {});
      }
      return;
    }
    if (terminalRef.current.getConnectionState() !== 'connected') return;
    terminalRef.current.input(input);
  }

  function openReplay() {
    if (!canNavigateToReplay) return;
    setScreen('replay');
  }

  return (
    <main class='app-shell' id='main-content'>
      <a href='#main-content' class='skip-link'>
        メインコンテンツへスキップ
      </a>
      <header class='topbar'>
        <strong
          class='topbar-brand'
          role='link'
          tabIndex={screen === 'play' || isStarting ? -1 : 0}
          aria-label='ホーム（難易度選択）に戻る'
          aria-disabled={screen === 'play' || isStarting}
          onClick={() => {
            if (screen === 'play' || isStarting) return;
            setScreen('select');
          }}
          onKeyDown={(event) => {
            if (screen === 'play' || isStarting) return;
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setScreen('select');
            }
          }}
        >
          障害対応訓練
        </strong>
        <div class='speed-control' role='group' aria-label='ゲーム速度'>
          {speedOptions.map((speed) => (
            <button
              key={speed}
              type='button'
              class={speed === gameSpeed ? 'active' : ''}
              aria-pressed={speed === gameSpeed}
              onClick={() => {
                setGameSpeed(speed);
              }}
            >
              {speed}x
            </button>
          ))}
        </div>
        <div class='topbar-actions'>
          <button
            type='button'
            aria-label='シナリオ選択に戻る'
            onClick={() => {
              setScreen('select');
            }}
            disabled={screen === 'play' || isStarting}
          >
            Scenario
          </button>
          {canNavigateToReplay && (
            <button
              type='button'
              aria-label='リプレイ詳細を開く'
              onClick={openReplay}
            >
              Replay
            </button>
          )}
        </div>
      </header>
      {appError && (
        <p class='app-error' role='alert'>
          {appError}
        </p>
      )}

      {screen === 'select' && (
        <section class='select-screen'>
          <div class='select-header'>
            <p class='eyebrow'>Incident Drill</p>
            <h1>難易度を選ぶ</h1>
            <p>難易度ごとにシナリオを選んで訓練を開始します。</p>
          </div>
          <div class='difficulty-grid'>
            {difficultyOptions.map((option) => {
              const count = scenarios.filter(
                (item) => item.difficulty === option.difficulty
              ).length;
              const disabled = count === 0 || isStarting;
              return (
                <button
                  key={option.difficulty}
                  class={`difficulty-card ${option.tone}`}
                  type='button'
                  disabled={disabled}
                  aria-label={`${option.label}、${String(count)} シナリオ。${option.summary}${disabled ? '（シナリオなし）' : ''}`}
                  title={
                    disabled ? 'この難易度にはシナリオがありません' : undefined
                  }
                  onClick={() => {
                    setSelectedDifficulty(option.difficulty);
                    setScreen('scenario-list');
                  }}
                >
                  <span class='difficulty-label'>{option.label}</span>
                  <strong>{count} シナリオ</strong>
                  <small>{option.summary}</small>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {screen === 'scenario-list' && selectedDifficulty && (
        <section
          class='panel scenario-list-panel'
          aria-labelledby='scenario-list-heading'
        >
          <button
            type='button'
            class='panel-back-button'
            aria-label='難易度選択に戻る'
            onClick={() => {
              setScreen('select');
            }}
          >
            ← 戻る
          </button>
          <h1 id='scenario-list-heading'>
            {formatDifficulty(selectedDifficulty)}シナリオ
          </h1>
          <div class='scenario-list'>
            {filteredScenarios.map((item) => (
              <button
                key={item.id}
                type='button'
                class='scenario-card'
                disabled={isStarting}
                onClick={() => void createSessionForScenario(item.id)}
              >
                <span class='scenario-card-main'>
                  <strong>{item.title}</strong>
                  {item.id === TUTORIAL_SCENARIO_ID && (
                    <span class='tutorial-badge'>チュートリアル</span>
                  )}
                </span>
                <span>{item.timeLimitMinutes}分</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {screen === 'briefing' && scenario && (
        <section
          class='panel briefing-panel'
          aria-labelledby='briefing-heading'
        >
          <button
            type='button'
            class='panel-back-button'
            aria-label='シナリオ選択に戻る'
            disabled={isStarting}
            onClick={() => {
              setScreen('scenario-list');
            }}
          >
            ← 戻る
          </button>
          <h1 id='briefing-heading'>{scenario.title}</h1>
          <ul>
            {scenario.briefing.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <fieldset>
            <legend>録画設定</legend>
            <label class='consent-row'>
              <input
                type='checkbox'
                checked={recordingConsent}
                onChange={(event) => {
                  setRecordingConsent(event.currentTarget.checked);
                }}
              />
              ゲーム画面（canvas 内のみ）を録画し、振り返りに使うことに同意する
            </label>
            <label class='consent-row'>
              <input
                type='checkbox'
                checked={saveRecording}
                disabled={!recordingConsent}
                onChange={(event) => {
                  setSaveRecording(event.currentTarget.checked);
                }}
              />
              録画データをサーバーに保存する（オフにするとイベントログのみ残ります）
            </label>
          </fieldset>
          <p id='briefing-consent-note'>
            ブラウザ全体や別タブは録画されません。公開するかどうかは後から選べます。
          </p>
          <button
            type='button'
            onClick={() => void startPlay()}
            disabled={isStarting || !recordingConsent}
            aria-describedby='briefing-consent-note'
          >
            {isStarting ? '開始中…' : '開始'}
          </button>
        </section>
      )}

      {screen === 'play' && (
        <section class='game-layout'>
          {gameState?.monitors.center.activeTool === 'editor' && (
            <textarea
              ref={editorTextareaRef}
              class='editor-overlay'
              style={editorOverlayStyle(
                canvasRef.current,
                gameState.world.expandedMonitor === 'terminal'
              )}
              value={gameState.monitors.center.editor.content}
              aria-label={`${gameState.monitors.center.editor.currentPath ?? 'ファイル'} を編集`}
              spellcheck={false}
              disabled={
                gameState.monitors.center.editor.status === 'loading' ||
                gameState.monitors.center.editor.status === 'saving'
              }
              onInput={(event) => {
                const target = event.currentTarget;
                const cursor = editorCursorFromTextarea(target);
                patchGameStateRef((current) =>
                  updateEditorPanel(current, (editor) => ({
                    ...editor,
                    content: target.value,
                    dirty: target.value !== editor.savedContent,
                    status: editor.status === 'error' ? 'ready' : editor.status,
                    cursor,
                  }))
                );
              }}
              onSelect={(event) => {
                const target = event.currentTarget;
                const cursor = editorCursorFromTextarea(target);
                patchGameStateRef(
                  (current) =>
                    updateEditorPanel(current, (editor) => ({
                      ...editor,
                      cursor,
                    })),
                  {collectTransitions: false}
                );
              }}
              onKeyDown={(event) => {
                if (
                  (event.metaKey || event.ctrlKey) &&
                  event.key.toLowerCase() === 's'
                ) {
                  event.preventDefault();
                  void saveEditorFile();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  patchGameStateRef((current) =>
                    setCenterTool(current, 'terminal')
                  );
                }
              }}
            />
          )}
          <canvas
            ref={canvasRef}
            width='1920'
            height='1080'
            aria-label='録画対象のゲーム画面。ターミナル入力はキーボードで操作できます。'
            aria-describedby='canvas-play-hint'
            tabIndex={0}
            onClick={handleCanvasClick}
            onMouseMove={handleCanvasMove}
            onWheel={handleCanvasWheel}
            onKeyDown={handleTerminalKey}
            onPaste={(event) => {
              const clipboard = event.clipboardData;
              if (!clipboard || !terminalRef.current) return;
              const text = clipboard.getData('text/plain');
              if (text) {
                event.preventDefault();
                terminalRef.current.input(text);
              }
            }}
          />
          <p id='canvas-play-hint' class='visually-hidden'>
            ターミナルにフォーカスしてキーボードでコマンドを入力できます。画面上のボタンはマウスで操作します。
          </p>
        </section>
      )}

      {screen === 'result' && session && scenario && (
        <ResultPage
          replayId={session.replayId}
          sessionId={session.sessionId}
          scenarioTitle={scenario.title}
          canOpenReplay={canNavigateToReplay}
          onGoHome={() => {
            setScreen('select');
          }}
          onRetry={() => void createSessionForScenario(scenario.id)}
          onOpenReplay={openReplay}
          isRetrying={isStarting}
        />
      )}

      {screen === 'replay' && activeReplayId && !deepLinkValidated && (
        <section class='panel' aria-busy='true'>
          <p role='status'>リプレイを読み込み中…</p>
        </section>
      )}
      {screen === 'replay' && activeReplayId && deepLinkValidated && (
        <ReplayPage
          replayId={activeReplayId}
          timeline={session ? timeline : []}
        />
      )}
    </main>
  );
}

function updateRecordingStatus(
  state: GameRenderState | undefined,
  status: GameRenderState['recording']['status']
) {
  return state ? {...state, recording: {...state.recording, status}} : state;
}
function classifyRecordingError(
  error: unknown
): GameRenderState['recording']['status'] {
  const message = toErrorMessage(error);
  return message.includes('MediaRecorder') || message.includes('captureStream')
    ? 'unsupported_browser'
    : 'recording_error';
}
function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
function toLogicalCanvasPoint(event: MouseEvent, canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * 1920,
    y: ((event.clientY - rect.top) / rect.height) * 1080,
  };
}
function containsPoint(
  rect: {x: number; y: number; width: number; height: number},
  x: number,
  y: number
) {
  return (
    x >= rect.x &&
    x <= rect.x + rect.width &&
    y >= rect.y &&
    y <= rect.y + rect.height
  );
}
function editorOverlayStyle(
  canvas: HTMLCanvasElement | null,
  expanded: boolean
) {
  if (!canvas) return {display: 'none'};
  const rect = canvas.getBoundingClientRect();
  const region = centerEditorOverlayRegion(expanded);
  const scaleX = rect.width / 1920;
  const scaleY = rect.height / 1080;
  return {
    left: `${String(rect.left + region.x * scaleX)}px`,
    top: `${String(rect.top + region.y * scaleY)}px`,
    width: `${String(region.width * scaleX)}px`,
    height: `${String(region.height * scaleY)}px`,
  };
}
function editorCursorFromTextarea(textarea: HTMLTextAreaElement) {
  const before = textarea.value.slice(0, textarea.selectionStart);
  const lines = before.split('\n');
  return {
    line: lines.length,
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
  };
}
function editorFileAt(
  x: number,
  y: number,
  state: GameRenderState | undefined
) {
  if (!state || state.monitors.center.activeTool !== 'editor') return undefined;
  if (
    state.world.expandedMonitor &&
    state.world.expandedMonitor !== 'terminal'
  ) {
    return undefined;
  }
  const expanded = state.world.expandedMonitor === 'terminal';
  const monitor = expanded
    ? expandedMonitorLayout
    : {x: 690, y: 140, width: 540, height: 620};
  const contentX = monitor.x + 22;
  const contentY = monitor.y + 64;
  const contentWidth = monitor.width - 44;
  const contentHeight = monitor.height - 80;
  const scale = Math.min(contentWidth / 496, contentHeight / 540);
  const localX = (x - contentX) / scale;
  const localY = (y - contentY) / scale;
  const fileListTop = 66;
  if (
    localX < 0 ||
    localX > 142 ||
    localY < fileListTop ||
    localY > fileListTop + 470
  ) {
    return undefined;
  }
  const index = Math.floor((localY - fileListTop - 8) / 28);
  return state.monitors.center.editor.files[index]?.path;
}
function formatDifficulty(difficulty: Difficulty) {
  if (difficulty === 'beginner') return '初級';
  if (difficulty === 'intermediate') return '中級';
  return '上級';
}
