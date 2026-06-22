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
  submitPlayerSlackMessage,
  toggleExpandedMonitor,
  toggleNotificationPanel,
} from '../game/state/gameState.js';
import {metricsPanelScrollRegion} from '../game/render/canvasLayout.js';
import {resolveCanvasAction} from '../game/input/canvasActions.js';
import {createEmptyTerminalMirror} from '../game/terminal/mirror.js';
import {playAlertBeep} from '../game/recording/audio.js';
import {ReplayEventEmitter} from '../game/events/emitReplayEvent.js';
import {detectMetricThresholdCrossings} from '../game/events/monitorEvents.js';
import {collectStateTransitions} from '../game/events/sessionEvents.js';
import {isTimelineEventType} from '../replay/replayMediaUtils.js';
import {
  BriefingScreen,
  PlayScreen,
  ReplayScreen,
  ResultScreen,
  ScenarioListScreen,
  SelectScreen,
  TopBar,
  type FinishMode,
  type ScenarioSummary,
  type Screen,
} from './AppScreens.js';
import {
  api,
  type SessionClockResponse,
  useCanvasRecording,
  useCanvasRenderer,
  useSessionEditor,
  useTerminalBridge,
} from './appRuntime.js';
import '@xterm/xterm/css/xterm.css';

const CONSENT_KEY = 'incident-recording-consent';
const SAVE_RECORDING_KEY = 'incident-recording-save';

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
  const rendererRef = useRef<{scrollMetricsPanel(deltaY: number): void} | null>(
    null
  );
  const gameStateRef = useRef<GameRenderState | undefined>(undefined);
  const elapsedMsRef = useRef(0);
  const lastTickAtRef = useRef(0);
  const gameSpeedRef = useRef(1);
  const sessionRef = useRef<{sessionId: string; replayId: string} | undefined>(
    undefined
  );
  const scenarioRef = useRef<ScenarioDefinition | undefined>(undefined);
  const eventEmitterRef = useRef<ReplayEventEmitter | null>(null);
  const finishingRef = useRef(false);
  const tabBeaconSentRef = useRef(false);
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
    api
      .listScenarios()
      .then(setScenarios)
      .catch((error: unknown) => {
        setAppError(toErrorMessage(error));
      });
    eventEmitterRef.current = new ReplayEventEmitter(api, (at, label) => {
      setTimeline((items) => [...items, {at, label}]);
    });
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
      if (oldSpeed !== gameSpeed) {
        recording.recordSpeedChange(snapped, gameSpeed);
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
      destroyTerminal();
      const created = await api.createSession({scenarioId});
      api.resetEventSequence();
      eventEmitterRef.current?.reset();
      liveReplayEventIdsRef.current.clear();
      recording.resetRecordingClock();
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
      recording.resetRecordingClock();
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
    const shouldSaveVideo = recording.shouldSaveVideo();
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

    destroyTerminal();

    const recordingStatus = await recording.finishRecording(
      session,
      shouldSaveVideo
    );
    const status =
      mode === 'retire' ? 'retired' : resolved ? 'resolved' : 'failed';
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
      const state = gameStateRef.current;
      if (!state) return;
      void emitter.emit({
        replayId,
        type: 'ui_click',
        at,
        payload: {x: point.x, y: point.y},
      });

      const action = resolveCanvasAction(point, state, scenarioRef.current);
      if (action.type === 'end_session') {
        return void endSession(action.mode);
      }
      if (action.type === 'focus_command_input') {
        patchGameStateRef((current) =>
          focusCommandInput(deactivateSlackCompose(current))
        );
        return;
      }
      patchGameStateRef((current) => blurCommandInput(current));

      if (action.type === 'center_tool') {
        patchGameStateRef((current) => setCenterTool(current, action.tool));
        void emitter.emit({
          replayId,
          type: 'ui_panel_open',
          at,
          payload: {panel: action.tool},
        });
        if (action.tool === 'editor') void loadEditorFiles();
        return;
      }

      if (action.type === 'open_editor_file') {
        patchGameStateRef((current) => setCenterTool(current, 'editor'));
        void openEditorFile(action.path);
        return;
      }

      if (action.type === 'right_panel_tab') {
        patchGameStateRef((current) => setRightPanelTab(current, action.tab));
        void emitter.emit({
          replayId,
          type: 'ui_panel_open',
          at,
          payload: {panel: action.tab === 'slack' ? 'slack' : 'runbook'},
        });
        return;
      }

      if (action.type === 'runbook_tab') {
        const activeScenario = scenarioRef.current;
        if (!activeScenario) return;
        patchGameStateRef((current) =>
          setActiveRunbook(current, activeScenario, action.index)
        );
        void emitter.emitOnce(`runbook:${action.runbookId}`, {
          replayId,
          type: 'runbook_open',
          at,
          payload: {runbookId: action.runbookId},
        });
        return;
      }

      if (action.type === 'notification_bell') {
        const unreadAlerts = state.monitors.left.alerts.filter(
          (alert) => !state.notifications.readAlertIds.includes(alert.id)
        );
        const unreadSlack = mergedSlackMessages(state).filter(
          (message) => !state.seenSlackIds.includes(message.id)
        );
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

      if (action.type === 'dismiss_navigation') {
        patchGameStateRef((current) =>
          dismissNavigationStep(current, action.stepId)
        );
        return;
      }

      if (action.type === 'close_expanded_monitor') {
        patchGameStateRef((current) => ({
          ...current,
          world: {...current.world, expandedMonitor: null},
        }));
        return;
      }

      if (action.type === 'toggle_expanded_monitor') {
        patchGameStateRef((current) =>
          toggleExpandedMonitor(current, action.monitor)
        );
        void emitter.emit({
          replayId,
          type: 'ui_panel_open',
          at,
          payload: {panel: `monitor.${action.monitor}`},
        });
        return;
      }

      if (action.type === 'slack_send') {
        submitSlackMessage();
        return;
      }

      if (action.type === 'slack_compose') {
        patchGameStateRef((current) => activateSlackCompose(current));
        void emitter.emit({
          replayId,
          type: 'ui_panel_open',
          at,
          payload: {panel: 'slack_compose'},
        });
        return;
      }

      if (action.type === 'deactivate_slack_compose') {
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
          onGoHome={() => {
            setScreen('select');
          }}
          onRetry={() => void createSessionForScenario(scenario.id)}
          onOpenReplay={openReplay}
          isRetrying={isStarting}
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
