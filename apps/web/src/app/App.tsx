import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { replayEventSummary, type Difficulty, type GameRenderState, type ScenarioDefinition } from "@incident/shared";
import {
  advanceGameState,
  applyLiveMetrics,
  activateSlackCompose,
  createInitialGameState,
  decayWorldOverlays,
  deactivateSlackCompose,
  dismissNavigationStep,
  setActiveRunbook,
  setDevtoolsTab,
  setSlackDraft,
  submitPlayerSlackMessage,
  toggleDevtools,
  toggleNotificationPanel
} from "../game/state/gameState.js";
import {
  CanvasRenderer,
  devtoolsTabAt,
  devtoolsToggleRegion,
  inputDockRects,
  navigationOverlayRect,
  notificationBellRegion,
  runbookTabAt,
  slackComposeAt
} from "../game/render/canvasRenderer.js";
import { createEmptyTerminalMirror } from "../game/terminal/mirror.js";
import { TerminalSession } from "../game/terminal/session.js";
import { terminalDebug } from "../game/terminal/debug.js";
import { keyboardEventToTerminalInput } from "../game/terminal/input.js";
import { CanvasRecorder } from "../game/recording/recorder.js";
import { playAlertBeep } from "../game/recording/audio.js";
import { RecordingFinalizer } from "../game/recording/finalizer.js";
import { installOfflineFlush, OfflineUploadQueue } from "../game/recording/offlineQueue.js";
import { classifyCommandEvent, commandEventPayload, ReplayEventEmitter } from "../game/events/emitReplayEvent.js";
import { detectMetricThresholdCrossings } from "../game/events/monitorEvents.js";
import { collectStateTransitions } from "../game/events/sessionEvents.js";
import { ApiClient, type SessionClockResponse } from "../api/client.js";
import { isTimelineEventType } from "../replay/replayMediaUtils.js";
import { ReplayPage } from "../pages/ReplayPage.js";
import { ResultPage } from "../pages/ResultPage.js";
import "@xterm/xterm/css/xterm.css";

type Screen = "select" | "scenario-list" | "briefing" | "play" | "result" | "replay";
type ScenarioSummary = Pick<ScenarioDefinition, "id" | "title" | "difficulty" | "timeLimitMinutes">;
type FinishMode = "resolve" | "retire" | "timeout";

const CONSENT_KEY = "incident-recording-consent";
const SAVE_RECORDING_KEY = "incident-recording-save";
const TUTORIAL_SCENARIO_ID = "process-stop-001";
const DANGEROUS_COMMAND = /\brm\s+-rf\b/i;
const difficultyOptions: Array<{ difficulty: Difficulty; label: string; tone: string; summary: string }> = [
  { difficulty: "beginner", label: "初級", tone: "green", summary: "監視とログを順番に追う短い初動訓練" },
  { difficulty: "intermediate", label: "中級", tone: "amber", summary: "原因候補を絞り込みながら復旧まで進める訓練" },
  { difficulty: "advanced", label: "上級", tone: "red", summary: "少ない手掛かりから仮説を立てて完走する訓練" }
];
const speedOptions = [0.5, 1, 1.5, 2] as const;

const api = new ApiClient();
const offlineQueue = new OfflineUploadQueue(api);
const recordingFlushRef: { stop?: () => void } = {};
installOfflineFlush(offlineQueue, () => recordingFlushRef.stop?.());

function readReplayIdFromSearch() {
  if (typeof window === "undefined") return undefined;
  const replayId = new URLSearchParams(window.location.search).get("replay")?.trim();
  return replayId || undefined;
}

export function App() {
  const initialReplayId = readReplayIdFromSearch();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const recorderRef = useRef<CanvasRecorder | null>(null);
  const finalizerRef = useRef<RecordingFinalizer | null>(null);
  const refreshDevtoolsRef = useRef<(() => void) | null>(null);
  const saveRecordingRef = useRef(true);
  const gameStateRef = useRef<GameRenderState | undefined>(undefined);
  const elapsedMsRef = useRef(0);
  const lastTickAtRef = useRef(0);
  const gameSpeedRef = useRef(1);
  const terminalRef = useRef<TerminalSession | null>(null);
  const sessionRef = useRef<{ sessionId: string; replayId: string } | undefined>(undefined);
  const scenarioRef = useRef<ScenarioDefinition | undefined>(undefined);
  const eventEmitterRef = useRef<ReplayEventEmitter | null>(null);
  const finishingRef = useRef(false);
  const recordingStartedAtGameMsRef = useRef(0);
  const liveReplayEventIdsRef = useRef(new Set<string>());

  const [screen, setScreen] = useState<Screen>(initialReplayId ? "replay" : "select");
  const [deepLinkReplayId, setDeepLinkReplayId] = useState(initialReplayId);
  const [deepLinkValidated, setDeepLinkValidated] = useState(!initialReplayId);
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty>();
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [scenario, setScenario] = useState<ScenarioDefinition>();
  const [session, setSession] = useState<{ sessionId: string; replayId: string }>();
  const [gameState, setGameState] = useState<GameRenderState>();
  const [timeline, setTimeline] = useState<Array<{ at: number; label: string }>>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [gameSpeed, setGameSpeed] = useState(1);
  const [appError, setAppError] = useState<string>();
  const [recordingConsent, setRecordingConsent] = useState(() => localStorage.getItem(CONSENT_KEY) === "1");
  const [hasRecordingConsent, setHasRecordingConsent] = useState(() => localStorage.getItem(CONSENT_KEY) === "1");
  const [saveRecording, setSaveRecording] = useState(() => localStorage.getItem(SAVE_RECORDING_KEY) !== "0");

  const patchGameStateRef = (
    updater: (state: GameRenderState) => GameRenderState,
    options: { render?: boolean; collectTransitions?: boolean } = {}
  ) => {
    const current = gameStateRef.current;
    if (!current) return;
    const next = updater(current);
    if (next === current) return;
    const replayId = sessionRef.current?.replayId;
    if (options.collectTransitions !== false && replayId && eventEmitterRef.current) {
      collectStateTransitions(current, next, scenarioRef.current, currentGameTimeMs(), eventEmitterRef.current, replayId);
    }
    gameStateRef.current = next;
    if (options.render !== false) setGameState(next);
  };

  function currentGameTimeMs() {
    const current = gameStateRef.current;
    const baseMs = elapsedMsRef.current;
    const lastTickAt = lastTickAtRef.current;
    if (screen !== "play" || !current || !lastTickAt || finishingRef.current) return Math.round(baseMs);
    const elapsedSinceTickMs = Math.max(0, performance.now() - lastTickAt) * current.clock.speed;
    return Math.round(Math.min(current.clock.timeLimitMs, baseMs + elapsedSinceTickMs));
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
      collectStateTransitions(previous, next, scenarioRef.current, Math.round(clock.gameTimeMs), eventEmitterRef.current, replayId);
    }
    gameStateRef.current = next;
    setGameState(next);
    if (clock.gameTimeMs >= clock.timeLimitMs) void endSession("timeout");
  };

  useEffect(() => {
    recordingFlushRef.stop = () => {
      void recorderRef.current?.stop().catch(console.error);
    };
    api.listScenarios().then(setScenarios).catch((error) => setAppError(toErrorMessage(error)));
    eventEmitterRef.current = new ReplayEventEmitter(api, (at, label) => {
      setTimeline((items) => [...items, { at, label }]);
    });
    return () => { delete recordingFlushRef.stop; };
  }, []);

  useEffect(() => {
    if (!deepLinkReplayId || deepLinkValidated) return;
    let cancelled = false;
    api.getReplay(deepLinkReplayId)
      .then(() => {
        if (cancelled) return;
        setDeepLinkValidated(true);
        setScreen("replay");
      })
      .catch((error) => {
        if (cancelled) return;
        setAppError(toErrorMessage(error));
        setDeepLinkReplayId(undefined);
        setDeepLinkValidated(true);
        setScreen("select");
      });
    return () => { cancelled = true; };
  }, [deepLinkReplayId, deepLinkValidated]);

  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { scenarioRef.current = scenario; }, [scenario]);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
  useEffect(() => { saveRecordingRef.current = saveRecording; }, [saveRecording]);
  useEffect(() => {
    gameSpeedRef.current = gameSpeed;
    patchGameStateRef((current) => ({ ...current, clock: { ...current.clock, speed: gameSpeed } }));
    const activeSession = sessionRef.current;
    if (screen === "play" && activeSession) {
      void api.updateSessionClock(activeSession.sessionId, gameSpeed).then(applyClockSnapshot).catch(console.error);
    }
  }, [gameSpeed, screen]);

  useEffect(() => () => { terminalRef.current?.destroy(); }, []);

  useEffect(() => {
    if ((screen !== "play" && screen !== "result") || !canvasRef.current) return;
    const renderer = new CanvasRenderer(canvasRef.current);
    rendererRef.current = renderer;
    let frame = 0;
    let lastState: GameRenderState | undefined;
    let lastScenario: ScenarioDefinition | undefined;
    const draw = () => {
      const latest = gameStateRef.current;
      const scenario = scenarioRef.current;
      if (latest && (latest !== lastState || scenario !== lastScenario)) {
        renderer.draw(latest, scenario);
        lastState = latest;
        lastScenario = scenario;
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(frame); rendererRef.current = null; };
  }, [screen]);

  useEffect(() => {
    if (screen !== "play" || !session || !canvasRef.current || recorderRef.current || !hasRecordingConsent || !saveRecording) return;
    let cancelled = false;
    const finalizer = new RecordingFinalizer();
    finalizerRef.current = finalizer;
    const recorder = new CanvasRecorder(canvasRef.current, {
      replayId: session.replayId,
      onChunk: async (chunk) => {
        await finalizer.append(chunk.blob);
        try { await api.uploadChunk(session.replayId, chunk); }
        catch { await offlineQueue.enqueueChunk({ replayId: session.replayId, ...chunk }); }
      },
      onEvent: async (event) => {
        try { await api.uploadEvents(session.replayId, [event]); }
        catch { await offlineQueue.enqueueEvents(session.replayId, [event]); }
      }
    });
    recorderRef.current = recorder;
    setGameState((current) => updateRecordingStatus(current, "initializing"));
    recorder.start().then(
      () => {
        if (cancelled) return;
        recordingStartedAtGameMsRef.current = currentGameTimeMs();
        setGameState((current) => updateRecordingStatus(current, "recording"));
      },
      (error) => {
        if (cancelled) return;
        recorderRef.current = null;
        setAppError(toErrorMessage(error));
        setGameState((current) => updateRecordingStatus(current, classifyRecordingError(error)));
      }
    );
    return () => {
      cancelled = true;
      if (recorderRef.current === recorder) {
        recorderRef.current = null;
        void recorder.stop().catch(console.error);
      }
      if (finalizerRef.current === finalizer) finalizerRef.current = null;
    };
  }, [screen, session?.replayId, hasRecordingConsent, saveRecording]);

  useEffect(() => {
    if (screen !== "play" || !session) return;
    const source = api.subscribeSessionEvents(session.sessionId, {
      onSnapshot: applyClockSnapshot,
      onReplay: (event) => {
        if (liveReplayEventIdsRef.current.has(event.id) || !isTimelineEventType(event.type)) return;
        liveReplayEventIdsRef.current.add(event.id);
        setTimeline((items) => [...items, { at: event.at / 1000, label: replayEventSummary(event) }]);
      },
      onError: console.error
    });
    return () => source.close();
  }, [screen, session?.sessionId]);

  useEffect(() => {
    if (screen !== "play" || !session) return;
    const timer = window.setInterval(() => {
      if (finishingRef.current || document.visibilityState === "hidden") return;
      const previous = gameStateRef.current;
      if (!previous) return;
      const now = performance.now();
      const lastTickAt = lastTickAtRef.current || now;
      lastTickAtRef.current = now;
      const delta = Math.max(0, (now - lastTickAt) * previous.clock.speed);
      if (delta === 0) return;
      const elapsedMs = Math.min(previous.clock.timeLimitMs, previous.clock.elapsedMs + delta);
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
      if (elapsedMs >= next.clock.timeLimitMs) void endSession("timeout");
    }, 500);
    return () => window.clearInterval(timer);
  }, [screen, session?.sessionId]);

  useEffect(() => {
    if (screen !== "play") return;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const delta = now - last;
      last = now;
      patchGameStateRef((current) => decayWorldOverlays(current, delta), { render: false, collectTransitions: false });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [screen]);

  useEffect(() => {
    if (screen !== "play" || !session) return;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      if (cancelled || document.visibilityState === "hidden") return;
      try {
        const metrics = await api.getSessionMetrics(session.sessionId);
        if (cancelled) return;
        const previous = gameStateRef.current?.monitors.left.metrics;
        patchGameStateRef((current) => applyLiveMetrics(current, metrics));
        const replayId = sessionRef.current?.replayId;
        const emitter = eventEmitterRef.current;
        if (replayId && emitter && previous) {
          for (const crossing of detectMetricThresholdCrossings(previous, metrics)) {
            void emitter.emitOnce(`metric:${crossing.key}`, {
              replayId,
              type: "monitor_update",
              at: currentGameTimeMs(),
              actor: "system",
              payload: { metric: crossing.key, label: crossing.label, value: metrics[crossing.key] }
            });
          }
        }
      } catch {
        if (!cancelled) patchGameStateRef((current) => ({ ...current, monitors: { ...current.monitors, left: { ...current.monitors.left, metricsSource: "offline" } } }));
      }
    };
    const pollDevtools = async () => {
      if (cancelled || document.visibilityState === "hidden") return;
      if (gameStateRef.current?.monitors.center.devtools?.visible !== true) return;
      try {
        const [access, app, batch, storage] = await Promise.all([
          api.getSessionLogs(session.sessionId, "access"),
          api.getSessionLogs(session.sessionId, "app"),
          api.getSessionLogs(session.sessionId, "batch"),
          api.getSessionStorage(session.sessionId)
        ]);
        if (cancelled) return;
        patchGameStateRef((current) => ({
          ...current,
          monitors: {
            ...current.monitors,
            center: {
              ...current.monitors.center,
              devtools: {
                visible: current.monitors.center.devtools?.visible ?? false,
                tab: current.monitors.center.devtools?.tab ?? "network",
                networkLines: parseAccessLog(access.lines),
                consoleLines: [...app.lines, ...batch.lines].slice(-20),
                storageEntries: storage.entries
              }
            }
          }
        }));
      } catch (error) {
        console.error(error);
      }
    };
    refreshDevtoolsRef.current = () => { void pollDevtools(); };
    void poll();
    timer = window.setInterval(() => { void poll(); void pollDevtools(); }, 5000);
    return () => {
      cancelled = true;
      refreshDevtoolsRef.current = null;
      window.clearInterval(timer);
    };
  }, [screen, session?.sessionId]);

  const filteredScenarios = useMemo(
    () => (selectedDifficulty ? scenarios.filter((item) => item.difficulty === selectedDifficulty) : []),
    [scenarios, selectedDifficulty]
  );
  const canPlayVideo = Boolean(
    saveRecording &&
    session &&
    (gameState?.recording.status === "ready" || gameState?.recording.status === "upload_degraded")
  );
  const hasReplayContent = Boolean(session && (canPlayVideo || timeline.length > 0));
  const canNavigateToReplay = hasReplayContent && screen === "result";
  const activeReplayId = session?.replayId ?? deepLinkReplayId;

  async function createSessionForScenario(scenarioId: string) {
    setAppError(undefined);
    setDeepLinkReplayId(undefined);
    setDeepLinkValidated(true);
    setIsStarting(true);
    try {
      terminalRef.current?.destroy();
      terminalRef.current = null;
      const created = await api.createSession({ scenarioId });
      api.resetEventSequence();
      eventEmitterRef.current?.reset();
      liveReplayEventIdsRef.current.clear();
      recordingStartedAtGameMsRef.current = 0;
      elapsedMsRef.current = 0;
      lastTickAtRef.current = 0;
      finishingRef.current = false;
      setScenario(created.scenario);
      setSession(created);
      setTimeline([]);
      setGameState(createInitialGameState(created.scenario, created.sessionId, created.replayId, createEmptyTerminalMirror(), { speed: gameSpeed }));
      setScreen("briefing");
    } catch (error) {
      setAppError(toErrorMessage(error));
    } finally {
      setIsStarting(false);
    }
  }

  function attachTerminalSession(activeSession: { sessionId: string; replayId: string }) {
    terminalRef.current?.destroy();
    const terminal = new TerminalSession({
      sessionId: activeSession.sessionId,
      onSnapshot: (snapshot) => patchGameStateRef((current) => ({ ...current, monitors: { ...current.monitors, center: { ...current.monitors.center, terminal: snapshot } } })),
      onOutput: (summary) => {
        const replayId = sessionRef.current?.replayId;
        const emitter = eventEmitterRef.current;
        if (!replayId || !emitter || !summary.trim()) return;
        void emitter.emit({
          replayId,
          type: "terminal_output",
          at: currentGameTimeMs(),
          actor: "sandbox",
          payload: { data: summary }
        });
      },
      onCommand: (command) => {
        const replayId = sessionRef.current?.replayId;
        const emitter = eventEmitterRef.current;
        if (!replayId || !emitter) return;
        const at = currentGameTimeMs();
        if (DANGEROUS_COMMAND.test(command) && scenarioRef.current?.difficulty === "beginner") {
          patchGameStateRef((current) => ({
            ...current,
            warning: { message: "危険: rm -rf は本番では慎重に。Runbook を確認してください。", flashMs: 4000 }
          }));
        }
        void emitter.emit({ replayId, type: "terminal_input", at, payload: { data: `${command}\n` }, visibility: "sensitive" });
        void emitter.emit({ replayId, type: "command_detected", at, payload: { command } });
        const special = classifyCommandEvent(command);
        if (special) void emitter.emit({ replayId, type: special, at, payload: commandEventPayload(command, special) });
      }
    });
    terminalRef.current = terminal;
    terminal.connect();
  }

  async function startPlay() {
    if (!session || !scenario || isStarting || !recordingConsent) return;
    localStorage.setItem(CONSENT_KEY, "1");
    localStorage.setItem(SAVE_RECORDING_KEY, saveRecording ? "1" : "0");
    setHasRecordingConsent(true);
    setIsStarting(true);
    try {
      await api.startSession(session.sessionId);
      attachTerminalSession(session);
      elapsedMsRef.current = 0;
      lastTickAtRef.current = performance.now();
      setTimeline([]);
      setGameState(createInitialGameState(scenario, session.sessionId, session.replayId, createEmptyTerminalMirror(), {
        sessionStatus: "running",
        recordingStatus: saveRecording ? "initializing" : "idle",
        recordingSaveEnabled: saveRecording,
        speed: gameSpeed
      }));
      setScreen("play");
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
    void emitter.emit({ replayId, type: "player_note", at, payload: { body, channel: "slack" } });
  }

  async function endSession(mode: FinishMode) {
    if (!session || finishingRef.current) return;
    finishingRef.current = true;
    terminalRef.current?.destroy();
    terminalRef.current = null;
    const shouldSaveVideo = saveRecordingRef.current && hasRecordingConsent;
    const activeRecorder = recorderRef.current;
    const recordingMimeType = activeRecorder?.mimeType;
    setGameState((current) => updateRecordingStatus(current, shouldSaveVideo ? "stopping" : "idle"));
    if (shouldSaveVideo) {
      await activeRecorder?.stop().catch((error) => setAppError(toErrorMessage(error)));
      const videoDurationMs = activeRecorder?.durationMs;
      recorderRef.current = null;
      await offlineQueue.flush();
      setGameState((current) => updateRecordingStatus(current, "finalizing"));
      const finalized = await finalizerRef.current?.finalize(session.replayId, api).catch(() => false) ?? false;
      finalizerRef.current = null;
      if (!finalized) {
        const headOk = await fetch(`/api/replays/${encodeURIComponent(session.replayId)}/video`, { method: "HEAD" })
          .then((response) => response.ok)
          .catch(() => false);
        if (!headOk) await api.assemblePartialReplayVideo(session.replayId).catch(() => undefined);
      }
      await api.finishReplay(session.replayId, {
        browserInfo: {
          userAgent: navigator.userAgent,
          mimeType: recordingMimeType,
          recordingStartedAtGameMs: recordingStartedAtGameMsRef.current
        },
        ...(videoDurationMs === undefined ? {} : { videoDurationMs })
      }).catch(console.error);
    } else {
      recorderRef.current = null;
      finalizerRef.current = null;
      await offlineQueue.flush();
      await api.finishReplay(session.replayId, {
        browserInfo: {
          userAgent: navigator.userAgent,
          mimeType: recordingMimeType,
          recordingStartedAtGameMs: recordingStartedAtGameMsRef.current
        }
      }).catch(console.error);
    }
    let resolved = false;
    if (mode === "resolve") {
      const result = await api.resolveSession(session.sessionId).catch(() => undefined);
      resolved = Boolean(result?.ok);
    } else if (mode === "retire") {
      await api.retireSession(session.sessionId).catch(console.error);
    } else if (mode === "timeout") {
      const at = Math.round(gameStateRef.current?.clock.elapsedMs ?? 0);
      void eventEmitterRef.current?.emit({
        replayId: session.replayId,
        type: "session_end",
        at,
        actor: "system",
        payload: { result: "timeout" }
      });
    }
    const status = mode === "retire" ? "retired" : resolved ? "resolved" : "failed";
    let recordingStatus: GameRenderState["recording"]["status"] = "idle";
    if (shouldSaveVideo) {
      const videoOk = await fetch(`/api/replays/${encodeURIComponent(session.replayId)}/video`, { method: "HEAD" })
        .then((response) => response.ok)
        .catch(() => false);
      recordingStatus = videoOk ? "ready" : "upload_degraded";
    }
    setGameState((current) => current ? {
      ...current,
      session: { ...current.session, status },
      recording: { ...current.recording, status: recordingStatus, saveEnabled: shouldSaveVideo }
    } : current);
    setScreen("result");
  }

  function handleCanvasClick(event: MouseEvent) {
    if (!canvasRef.current) return;
    canvasRef.current.focus();
    const point = toLogicalCanvasPoint(event, canvasRef.current);
    const replayId = sessionRef.current?.replayId;
    const emitter = eventEmitterRef.current;
    if (screen === "play" && replayId && emitter) {
      const at = currentGameTimeMs();
      void emitter.emit({ replayId, type: "ui_click", at, payload: { x: point.x, y: point.y } });
      if (containsPoint(inputDockRects.button, point.x, point.y)) return void endSession("resolve");
      if (containsPoint(inputDockRects.retire, point.x, point.y)) return void endSession("retire");
      const activeScenario = scenarioRef.current;
      if (activeScenario) {
        const tabIndex = runbookTabAt(point.x, point.y, activeScenario.runbooks.length, activeScenario.runbooks.map((item) => item.title));
        if (tabIndex >= 0) {
          patchGameStateRef((current) => setActiveRunbook(current, activeScenario, tabIndex));
          const runbook = activeScenario.runbooks[tabIndex];
          if (runbook) void emitter.emitOnce(`runbook:${runbook.id}`, { replayId, type: "runbook_open", at, payload: { runbookId: runbook.id } });
          return;
        }
      }
      if (containsPoint(notificationBellRegion, point.x, point.y)) {
        const unread = gameStateRef.current?.monitors.left.alerts.filter(
          (alert) => !gameStateRef.current?.notifications.readAlertIds.includes(alert.id)
        ) ?? [];
        patchGameStateRef((current) => toggleNotificationPanel(current));
        void emitter.emit({
          replayId,
          type: "ui_panel_open",
          at,
          payload: { panel: "notifications" }
        });
        for (const alert of unread) {
          void emitter.emitOnce(`slack-read:${alert.id}`, {
            replayId,
            type: "slack_message_read",
            at,
            payload: { alertId: alert.id, message: alert.message }
          });
        }
        return;
      }
      if (containsPoint(devtoolsToggleRegion, point.x, point.y)) {
        patchGameStateRef((current) => toggleDevtools(current));
        window.setTimeout(() => refreshDevtoolsRef.current?.(), 0);
        void emitter.emit({ replayId, type: "ui_panel_open", at, payload: { panel: "devtools" } });
        return;
      }
      const devtoolsTab = devtoolsTabAt(point.x, point.y);
      if (devtoolsTab) {
        patchGameStateRef((current) => setDevtoolsTab(current, devtoolsTab));
        window.setTimeout(() => refreshDevtoolsRef.current?.(), 0);
        void emitter.emit({ replayId, type: "ui_panel_open", at, payload: { panel: `devtools.${devtoolsTab}` } });
        return;
      }
      if (containsPoint(navigationOverlayRect, point.x, point.y) && gameStateRef.current?.navigation.activeStepId) {
        patchGameStateRef((current) => dismissNavigationStep(current, current.navigation.activeStepId!));
        return;
      }
      const slackTarget = slackComposeAt(point.x, point.y);
      if (slackTarget === "send") {
        submitSlackMessage();
        return;
      }
      if (slackTarget === "compose") {
        patchGameStateRef((current) => activateSlackCompose(current));
        void emitter.emit({ replayId, type: "ui_panel_open", at, payload: { panel: "slack_compose" } });
        return;
      }
      if (gameStateRef.current?.slackCompose.active) {
        patchGameStateRef((current) => deactivateSlackCompose(current));
      }
    }
  }

  function handleCanvasMove(event: MouseEvent) {
    if (!canvasRef.current || screen !== "play") return;
    const point = toLogicalCanvasPoint(event, canvasRef.current);
    patchGameStateRef((current) => {
      const cursor = current.cursor;
      if (Math.abs(cursor.x - point.x) < 1 && Math.abs(cursor.y - point.y) < 1 && cursor.visible) return current;
      return { ...current, cursor: { x: point.x, y: point.y, visible: true } };
    }, { render: false, collectTransitions: false });
  }

  function handleTerminalKey(event: KeyboardEvent) {
    if (screen !== "play") return;
    if (gameStateRef.current?.slackCompose.active) {
      if (event.key === "Escape") {
        event.preventDefault();
        patchGameStateRef((current) => deactivateSlackCompose(current));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        submitSlackMessage();
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        patchGameStateRef((current) => setSlackDraft(current, current.slackCompose.draft.slice(0, -1)));
        return;
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        patchGameStateRef((current) => setSlackDraft(current, `${current.slackCompose.draft}${event.key}`));
      }
      return;
    }
    if (!terminalRef.current) return;
    const input = keyboardEventToTerminalInput(event);
    if (!input) return;
    if (event.ctrlKey && event.key.toLowerCase() === "c") {
      terminalDebug("keydown.ctrl-c", { inputBytes: [...input].map((char) => char.charCodeAt(0)) });
      const activeSession = sessionRef.current;
      if (activeSession) void api.interruptTerminal(activeSession.sessionId).catch(() => {});
    }
    event.preventDefault();
    terminalRef.current.input(input);
  }

  function openReplay() {
    if (!canNavigateToReplay) return;
    setScreen("replay");
  }

  return (
    <main class="app-shell">
      <header class="topbar">
        <strong>障害対応訓練</strong>
        <span>{scenario?.title ?? "未選択"}</span>
        <div class="speed-control compact" aria-label="ゲーム速度">
          {speedOptions.map((speed) => (
            <button key={speed} type="button" class={speed === gameSpeed ? "active" : ""} onClick={() => setGameSpeed(speed)}>{speed}x</button>
          ))}
        </div>
        <button type="button" onClick={() => setScreen("select")} disabled={screen === "play" || isStarting}>Scenario</button>
        {canNavigateToReplay && <button type="button" onClick={openReplay}>Replay</button>}
      </header>
      {appError && <p class="app-error" role="alert">{appError}</p>}

      {screen === "select" && (
        <section class="select-screen">
          <div class="select-header">
            <p class="eyebrow">Incident Drill</p>
            <h1>難易度を選ぶ</h1>
            <p>難易度ごとにシナリオを選んで訓練を開始します。</p>
          </div>
          <div class="difficulty-grid">
            {difficultyOptions.map((option) => {
              const count = scenarios.filter((item) => item.difficulty === option.difficulty).length;
              return (
                <button key={option.difficulty} class={`difficulty-card ${option.tone}`} type="button" disabled={count === 0 || isStarting}
                  onClick={() => { setSelectedDifficulty(option.difficulty); setScreen("scenario-list"); }}>
                  <span class="difficulty-label">{option.label}</span>
                  <strong>{count} シナリオ</strong>
                  <small>{option.summary}</small>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {screen === "scenario-list" && selectedDifficulty && (
        <section class="panel scenario-list-panel">
          <button type="button" onClick={() => setScreen("select")}>戻る</button>
          <h1>{formatDifficulty(selectedDifficulty)}シナリオ</h1>
          <div class="scenario-list">
            {filteredScenarios.map((item) => (
              <button key={item.id} type="button" class="scenario-card" disabled={isStarting} onClick={() => createSessionForScenario(item.id)}>
                <span class="scenario-card-main">
                  <strong>{item.title}</strong>
                  {item.id === TUTORIAL_SCENARIO_ID && <span class="tutorial-badge">チュートリアル</span>}
                </span>
                <span>{item.timeLimitMinutes}分</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {screen === "briefing" && scenario && (
        <section class="panel briefing-panel">
          <h1>{scenario.title}</h1>
          <ul>{scenario.briefing.map((line) => <li key={line}>{line}</li>)}</ul>
          <label class="consent-row">
            <input type="checkbox" checked={recordingConsent} onChange={(event) => setRecordingConsent((event.currentTarget as HTMLInputElement).checked)} />
            ゲーム画面（canvas 内のみ）を録画し、振り返りに使うことに同意する
          </label>
          <label class="consent-row">
            <input
              type="checkbox"
              checked={saveRecording}
              disabled={!recordingConsent}
              onChange={(event) => setSaveRecording((event.currentTarget as HTMLInputElement).checked)}
            />
            録画データをサーバーに保存する（オフにするとイベントログのみ残ります）
          </label>
          <p>ブラウザ全体や別タブは録画されません。公開するかどうかは後から選べます。</p>
          <button type="button" onClick={startPlay} disabled={isStarting || !recordingConsent}>{isStarting ? "開始中" : "開始"}</button>
        </section>
      )}

      {(screen === "play" || screen === "result") && (
        <section class="game-layout">
          <canvas ref={canvasRef} width="1920" height="1080" aria-label="録画対象のゲーム画面" tabIndex={0}
            onClick={handleCanvasClick} onMouseMove={handleCanvasMove} onKeyDown={handleTerminalKey}
            onPaste={(event) => { if (screen === "play" && terminalRef.current) { const text = event.clipboardData?.getData("text/plain"); if (text) { event.preventDefault(); terminalRef.current.input(text); } } }} />
        </section>
      )}

      {screen === "result" && session && scenario && (
        <ResultPage replayId={session.replayId} sessionId={session.sessionId} scenarioTitle={scenario.title}
          timeline={timeline} canPlayVideo={canPlayVideo} canOpenReplay={canNavigateToReplay}
          onRetry={() => setScreen("select")} onOpenReplay={openReplay} />
      )}

      {screen === "replay" && activeReplayId && !deepLinkValidated && (
        <section class="panel"><p>リプレイを読み込み中…</p></section>
      )}
      {screen === "replay" && activeReplayId && deepLinkValidated && (
        <ReplayPage replayId={activeReplayId} timeline={session ? timeline : []} />
      )}
    </main>
  );
}

function updateRecordingStatus(state: GameRenderState | undefined, status: GameRenderState["recording"]["status"]) {
  return state ? { ...state, recording: { ...state.recording, status } } : state;
}
function classifyRecordingError(error: unknown): GameRenderState["recording"]["status"] {
  const message = toErrorMessage(error);
  return message.includes("MediaRecorder") || message.includes("captureStream") ? "unsupported_browser" : "recording_error";
}
function toErrorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function toLogicalCanvasPoint(event: MouseEvent, canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  return { x: ((event.clientX - rect.left) / rect.width) * 1920, y: ((event.clientY - rect.top) / rect.height) * 1080 };
}
function containsPoint(rect: { x: number; y: number; width: number; height: number }, x: number, y: number) {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}
function formatDifficulty(difficulty: Difficulty) {
  if (difficulty === "beginner") return "初級";
  if (difficulty === "intermediate") return "中級";
  return "上級";
}
function parseAccessLog(lines: string[]) {
  return lines.slice(-20).map((line) => {
    const match = line.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\d{3})$/);
    if (!match) return { at: "", method: "?", path: line.slice(0, 24), status: 0 };
    return { at: match[1] ?? "", method: match[2] ?? "", path: match[3] ?? "", status: Number(match[4] ?? 0) };
  });
}
