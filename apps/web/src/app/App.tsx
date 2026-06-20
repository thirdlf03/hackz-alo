import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { createReplayEvent, type Difficulty, type GameRenderState, type ScenarioDefinition } from "@incident/shared";
import { createInitialGameState, advanceGameState } from "../game/state/gameState.js";
import { CanvasRenderer } from "../game/render/canvasRenderer.js";
import { inputDockRects } from "../game/render/canvasRenderer.js";
import { createEmptyTerminalMirror } from "../game/terminal/mirror.js";
import { TerminalSession } from "../game/terminal/session.js";
import { CanvasRecorder } from "../game/recording/recorder.js";
import { ApiClient } from "../api/client.js";
import { ReplayPage } from "../pages/ReplayPage.js";
import "@xterm/xterm/css/xterm.css";

type Screen = "select" | "briefing" | "play" | "result" | "replay";
type ScenarioSummary = Pick<ScenarioDefinition, "id" | "title" | "difficulty" | "timeLimitMinutes">;

const difficultyOptions: Array<{
  difficulty: Difficulty;
  label: string;
  minutes: number;
  tone: string;
  summary: string;
}> = [
  { difficulty: "beginner", label: "初級", minutes: 5, tone: "green", summary: "監視とログを順番に追う短い初動訓練" },
  { difficulty: "intermediate", label: "中級", minutes: 10, tone: "amber", summary: "原因候補を絞り込みながら復旧まで進める訓練" },
  { difficulty: "advanced", label: "上級", minutes: 15, tone: "red", summary: "少ない手掛かりから仮説を立てて完走する訓練" }
];

const speedOptions = [0.5, 1, 1.5, 2] as const;

const api = new ApiClient();

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const recorderRef = useRef<CanvasRecorder | null>(null);
  const gameStateRef = useRef<GameRenderState | undefined>(undefined);
  const elapsedMsRef = useRef(0);
  const lastTickAtRef = useRef(0);
  const gameSpeedRef = useRef(1);
  const terminalRef = useRef<TerminalSession | null>(null);
  const sessionRef = useRef<{ sessionId: string; replayId: string } | undefined>(undefined);
  const [screen, setScreen] = useState<Screen>("select");
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [scenario, setScenario] = useState<ScenarioDefinition>();
  const [session, setSession] = useState<{ sessionId: string; replayId: string }>();
  const [gameState, setGameState] = useState<GameRenderState>();
  const [timeline, setTimeline] = useState<Array<{ at: number; label: string }>>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [gameSpeed, setGameSpeed] = useState(1);
  const [appError, setAppError] = useState<string>();

  useEffect(() => {
    api.listScenarios().then(setScenarios).catch((error) => {
      console.error(error);
      setAppError(toErrorMessage(error));
    });
  }, []);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    return () => {
      terminalRef.current?.destroy();
      terminalRef.current = null;
    };
  }, []);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    gameSpeedRef.current = gameSpeed;
    setGameState((current) => current ? { ...current, clock: { ...current.clock, speed: gameSpeed } } : current);
  }, [gameSpeed]);

  useEffect(() => {
    if ((screen !== "play" && screen !== "result") || !canvasRef.current) return;
    const renderer = new CanvasRenderer(canvasRef.current);
    rendererRef.current = renderer;
    let frame = 0;
    const draw = () => {
      const latestState = gameStateRef.current;
      if (latestState) renderer.draw(latestState);
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(frame);
      if (rendererRef.current === renderer) rendererRef.current = null;
    };
  }, [screen]);

  useEffect(() => {
    if (screen !== "play" || !session || !canvasRef.current || recorderRef.current) return;

    let cancelled = false;
    const recorder = new CanvasRecorder(canvasRef.current, {
      replayId: session.replayId,
      onChunk: (chunk) => api.uploadChunk(session.replayId, chunk),
      onEvent: (event) => api.uploadEvents(session.replayId, [event])
    });
    recorderRef.current = recorder;
    setGameState((current) => updateRecordingStatus(current, "initializing"));

    recorder.start().then(
      () => {
        if (!cancelled) setGameState((current) => updateRecordingStatus(current, "recording"));
      },
      (error) => {
        console.error(error);
        if (!cancelled) {
          recorderRef.current = null;
          setAppError(toErrorMessage(error));
          setGameState((current) => updateRecordingStatus(current, classifyRecordingError(error)));
        }
      }
    );

    return () => {
      cancelled = true;
      if (recorderRef.current === recorder) {
        recorderRef.current = null;
        void recorder.stop().catch(console.error);
      }
    };
  }, [screen, session?.replayId]);

  useEffect(() => {
    if (screen !== "play" || !scenario) return;
    if (lastTickAtRef.current === 0) lastTickAtRef.current = performance.now();
    const tick = () => {
      const now = performance.now();
      const deltaMs = now - lastTickAtRef.current;
      lastTickAtRef.current = now;
      elapsedMsRef.current += deltaMs * gameSpeedRef.current;
      setGameState((current) => current ? advanceGameState(current, elapsedMsRef.current, scenario, gameSpeedRef.current) : current);
    };
    tick();
    const timer = window.setInterval(() => {
      tick();
    }, 500);
    return () => window.clearInterval(timer);
  }, [screen, scenario?.id]);

  const selectedScenarioTitle = useMemo(() => scenario?.title ?? "未選択", [scenario]);
  const canOpenReplay = Boolean(session && gameState?.recording.status === "ready");
  const availableDifficulties = useMemo(() => {
    const values = new Set<Difficulty>();
    scenarios.forEach((item) => values.add(item.difficulty));
    return values;
  }, [scenarios]);

  async function assignRandomScenario(difficulty: Difficulty) {
    setAppError(undefined);
    setIsStarting(true);
    try {
      terminalRef.current?.destroy();
      terminalRef.current = null;
      const created = await api.createSession(difficulty);
      api.resetEventSequence();
      elapsedMsRef.current = 0;
      lastTickAtRef.current = 0;
      setScenario(created.scenario);
      setSession(created);
      setTimeline([]);
      setGameState(
        createInitialGameState(created.scenario, created.sessionId, created.replayId, createEmptyTerminalMirror(), {
          speed: gameSpeed
        })
      );
      setScreen("briefing");
    } catch (error) {
      console.error(error);
      setAppError(toErrorMessage(error));
    } finally {
      setIsStarting(false);
    }
  }

  function attachTerminalSession(activeSession: { sessionId: string; replayId: string }) {
    terminalRef.current?.destroy();
    const terminal = new TerminalSession({
      sessionId: activeSession.sessionId,
      onSnapshot: (snapshot) => {
        setGameState((current) =>
          current
            ? {
                ...current,
                monitors: {
                  ...current.monitors,
                  center: { terminal: snapshot }
                }
              }
            : current
        );
      },
      onCommand: (command) => {
        const replayId = sessionRef.current?.replayId;
        if (!replayId) return;
        const at = Math.round(elapsedMsRef.current);
        const inputEvent = createReplayEvent({
          replayId,
          type: "terminal_input",
          at,
          actor: "player",
          payload: { data: `${command}\n` }
        });
        const commandEvent = createReplayEvent({
          replayId,
          type: "command_detected",
          at,
          actor: "player",
          payload: { command }
        });
        void api.uploadEvents(replayId, [inputEvent, commandEvent]).catch(console.error);
        setTimeline((items) => [...items, { at: at / 1000, label: `command: ${command}` }]);
      },
      onConnectionChange: (state, error) => {
        if (state === "connected") return;
        if (state === "connecting") return;
        if (error) setAppError(`Sandbox ターミナル接続エラー: ${error.message}`);
      }
    });
    terminalRef.current = terminal;
    terminal.connect();
  }

  async function startPlay() {
    if (!session || !scenario || isStarting) return;
    setIsStarting(true);
    setAppError(undefined);
    try {
      await api.startSession(session.sessionId);
      attachTerminalSession(session);
      elapsedMsRef.current = 0;
      lastTickAtRef.current = performance.now();
      setTimeline([{ at: 0, label: "シナリオ開始" }]);
      setGameState(
        createInitialGameState(scenario, session.sessionId, session.replayId, createEmptyTerminalMirror(), {
          sessionStatus: "running",
          recordingStatus: "initializing",
          speed: gameSpeed
        })
      );
      setScreen("play");
    } catch (error) {
      console.error(error);
      setAppError(toErrorMessage(error));
    } finally {
      setIsStarting(false);
    }
  }

  async function finishPlay() {
    if (!session) return;
    terminalRef.current?.destroy();
    terminalRef.current = null;
    setGameState((current) => updateRecordingStatus(current, "stopping"));
    await recorderRef.current?.stop().catch((error) => {
      console.error(error);
      setAppError(toErrorMessage(error));
    });
    recorderRef.current = null;
    setGameState((current) => updateRecordingStatus(current, "finalizing"));
    const finalizationOk = await api.finishReplay(session.replayId).then(() => true, (error) => {
      console.error(error);
      setAppError(toErrorMessage(error));
      return false;
    });
    const result = await api.resolveSession(session.sessionId).catch((error) => {
      console.error(error);
      setAppError(toErrorMessage(error));
      return undefined;
    });
    const resolved = Boolean(result?.ok);
    setGameState((current) =>
      current
        ? {
            ...current,
            session: { ...current.session, status: resolved ? "resolved" : "failed" },
            recording: { ...current.recording, status: finalizationOk ? "ready" : "finalization_failed" }
          }
        : current
    );
    const elapsedSeconds = Math.round((gameStateRef.current?.clock.elapsedMs ?? 0) / 1000);
    setTimeline((items) => [...items, { at: elapsedSeconds, label: resolved ? "復旧宣言" : "復旧確認失敗" }]);
    setScreen("result");
  }

  function handleTerminalKey(event: KeyboardEvent) {
    if (screen !== "play" || !terminalRef.current) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const input = keyboardEventToTerminalInput(event);
    if (!input) return;
    event.preventDefault();
    terminalRef.current.input(input);
  }

  function handleTerminalPaste(event: ClipboardEvent) {
    if (screen !== "play" || !terminalRef.current) return;
    const text = event.clipboardData?.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    terminalRef.current.input(text);
  }

  function handleCanvasClick(event: MouseEvent) {
    if (!canvasRef.current) return;
    canvasRef.current.focus();
    if (screen !== "play") return;
    const point = toLogicalCanvasPoint(event, canvasRef.current);
    if (containsPoint(inputDockRects.button, point.x, point.y)) {
      void finishPlay();
    }
  }

  return (
    <main class="app-shell">
      <header class="topbar">
        <strong>障害対応訓練</strong>
        <span>{selectedScenarioTitle}</span>
        <div class="speed-control compact" aria-label="ゲーム速度">
          {speedOptions.map((speed) => (
            <button
              type="button"
              class={speed === gameSpeed ? "active" : ""}
              aria-pressed={speed === gameSpeed}
              onClick={() => setGameSpeed(speed)}
              key={speed}
            >
              {speed}x
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setScreen("select")} disabled={screen === "play" || isStarting}>Scenario</button>
        {canOpenReplay && <button type="button" onClick={() => setScreen("replay")}>Replay</button>}
      </header>

      {appError && <p class="app-error" role="alert">{appError}</p>}

      {screen === "select" && (
        <section class="select-screen">
          <div class="select-header">
            <p class="eyebrow">Incident Drill</p>
            <h1>難易度だけを選ぶ</h1>
            <p>具体的な障害シナリオは開始準備時にランダムで割り当てます。</p>
          </div>

          <div class="difficulty-grid">
            {difficultyOptions.map((option) => {
              const enabled = availableDifficulties.has(option.difficulty);
              return (
                <button
                  class={`difficulty-card ${option.tone}`}
                  type="button"
                  onClick={() => assignRandomScenario(option.difficulty)}
                  disabled={!enabled || isStarting}
                  key={option.difficulty}
                >
                  <span class="difficulty-label">{option.label}</span>
                  <strong>{option.minutes}分</strong>
                  <small>{option.summary}</small>
                  <span class="difficulty-status">{enabled ? "ランダム割り当て" : "準備中"}</span>
                </button>
              );
            })}
          </div>

          <div class="settings-row">
            <div>
              <p class="eyebrow">Speed</p>
              <h2>ゲーム速度</h2>
            </div>
            <div class="speed-control" aria-label="ゲーム速度">
              {speedOptions.map((speed) => (
                <button
                  type="button"
                  class={speed === gameSpeed ? "active" : ""}
                  aria-pressed={speed === gameSpeed}
                  onClick={() => setGameSpeed(speed)}
                  key={speed}
                >
                  {speed}x
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {screen === "briefing" && scenario && (
        <section class="panel briefing-panel">
          <p class="eyebrow">Assigned Scenario</p>
          <h1>{scenario.title}</h1>
          <div class="briefing-meta">
            <span>{formatDifficulty(scenario.difficulty)}</span>
            <span>{scenario.timeLimitMinutes}分</span>
            <span>{gameSpeed}x</span>
          </div>
          <ul>
            {scenario.briefing.map((line) => <li key={line}>{line}</li>)}
          </ul>
          <p>開始後、canvas 内のゲーム画面だけを自動録画します。ブラウザ全体や別タブは録画されません。</p>
          <button type="button" onClick={startPlay} disabled={isStarting}>{isStarting ? "開始中" : "開始"}</button>
        </section>
      )}

      {(screen === "play" || screen === "result") && (
        <section class="game-layout">
          <canvas
            ref={canvasRef}
            width="1920"
            height="1080"
            aria-label="録画対象のゲーム画面"
            tabIndex={0}
            onClick={handleCanvasClick}
            onKeyDown={handleTerminalKey}
            onPaste={handleTerminalPaste}
          />
        </section>
      )}

      {screen === "result" && session && (
        <section class="panel">
          <h1>結果</h1>
          <p>録画とイベントログを保存しました。Replay で動画とタイムラインを確認できます。</p>
          <button type="button" onClick={() => setScreen("replay")} disabled={!canOpenReplay}>Replay を見る</button>
        </section>
      )}

      {screen === "replay" && session && <ReplayPage replayId={session.replayId} timeline={timeline} />}
    </main>
  );
}

function updateRecordingStatus(
  state: GameRenderState | undefined,
  status: GameRenderState["recording"]["status"]
): GameRenderState | undefined {
  return state ? { ...state, recording: { ...state.recording, status } } : state;
}

function classifyRecordingError(error: unknown): GameRenderState["recording"]["status"] {
  const message = toErrorMessage(error);
  if (message.includes("MediaRecorder") || message.includes("captureStream")) return "unsupported_browser";
  return "recording_error";
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function toLogicalCanvasPoint(event: MouseEvent, canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * 1920,
    y: ((event.clientY - rect.top) / rect.height) * 1080
  };
}

function containsPoint(rect: { x: number; y: number; width: number; height: number }, x: number, y: number) {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function formatDifficulty(difficulty: Difficulty) {
  if (difficulty === "beginner") return "初級";
  if (difficulty === "intermediate") return "中級";
  return "上級";
}

function keyboardEventToTerminalInput(event: KeyboardEvent) {
  if (event.key === "Enter") return "\r";
  if (event.key === "Backspace") return "\u007f";
  if (event.key === "Tab") return "\t";
  if (event.key === "ArrowUp") return "\u001b[A";
  if (event.key === "ArrowDown") return "\u001b[B";
  if (event.key === "ArrowRight") return "\u001b[C";
  if (event.key === "ArrowLeft") return "\u001b[D";
  if (event.key.length === 1) return event.key;
  return null;
}
