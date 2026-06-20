import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { GameRenderState, ScenarioDefinition } from "@incident/shared";
import { createInitialGameState, advanceGameState } from "../game/state/gameState.js";
import { CanvasRenderer } from "../game/render/canvasRenderer.js";
import { inputDockRects } from "../game/render/canvasRenderer.js";
import { TerminalMirror } from "../game/terminal/mirror.js";
import { CanvasRecorder } from "../game/recording/recorder.js";
import { ApiClient } from "../api/client.js";
import { ReplayPage } from "../pages/ReplayPage.js";

type Screen = "select" | "briefing" | "play" | "result" | "replay";

const api = new ApiClient();

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const recorderRef = useRef<CanvasRecorder | null>(null);
  const gameStateRef = useRef<GameRenderState | undefined>(undefined);
  const playStartedAtRef = useRef(0);
  const terminalRef = useRef(new TerminalMirror(100, 30));
  const [screen, setScreen] = useState<Screen>("select");
  const [scenarios, setScenarios] = useState<Array<Pick<ScenarioDefinition, "id" | "title" | "difficulty" | "timeLimitMinutes">>>([]);
  const [scenario, setScenario] = useState<ScenarioDefinition>();
  const [session, setSession] = useState<{ sessionId: string; replayId: string }>();
  const [gameState, setGameState] = useState<GameRenderState>();
  const [timeline, setTimeline] = useState<Array<{ at: number; label: string }>>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [appError, setAppError] = useState<string>();

  useEffect(() => {
    api.listScenarios().then(setScenarios).catch((error) => {
      console.error(error);
      setAppError(toErrorMessage(error));
    });
  }, []);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

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
    if (playStartedAtRef.current === 0) playStartedAtRef.current = performance.now();
    const tick = () => {
      const elapsedMs = performance.now() - playStartedAtRef.current;
      setGameState((current) => current ? advanceGameState(current, elapsedMs, scenario) : current);
    };
    tick();
    const timer = window.setInterval(() => {
      tick();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [screen, scenario?.id]);

  const selectedScenarioTitle = useMemo(() => scenario?.title ?? "未選択", [scenario]);
  const canOpenReplay = Boolean(session && gameState?.recording.status === "ready");

  async function selectScenario(id: string) {
    setAppError(undefined);
    try {
      const fullScenario = await api.getScenario(id);
      const created = await api.createSession(id);
      terminalRef.current = new TerminalMirror(100, 30);
      playStartedAtRef.current = 0;
      setScenario(fullScenario);
      setSession(created);
      setTimeline([]);
      setGameState(createInitialGameState(fullScenario, created.sessionId, created.replayId, terminalRef.current.snapshot()));
      setScreen("briefing");
    } catch (error) {
      console.error(error);
      setAppError(toErrorMessage(error));
    }
  }

  async function startPlay() {
    if (!session || !scenario || isStarting) return;
    setIsStarting(true);
    setAppError(undefined);
    try {
      await api.startSession(session.sessionId);
      playStartedAtRef.current = performance.now();
      setTimeline([{ at: 0, label: "シナリオ開始" }]);
      setGameState(
        createInitialGameState(scenario, session.sessionId, session.replayId, terminalRef.current.snapshot(), {
          sessionStatus: "running",
          recordingStatus: "initializing"
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

  function handleTerminalInput(input: string) {
    terminalRef.current.input(input);
    syncTerminalSnapshot();
  }

  function handleTerminalKey(event: KeyboardEvent) {
    if (screen !== "play") return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Enter") {
      event.preventDefault();
      terminalRef.current.submitDraft();
      syncTerminalSnapshot();
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      terminalRef.current.backspaceDraft();
      syncTerminalSnapshot();
      return;
    }
    if (event.key.length === 1) {
      event.preventDefault();
      terminalRef.current.appendDraft(event.key);
      syncTerminalSnapshot();
    }
  }

  function handleTerminalPaste(event: ClipboardEvent) {
    if (screen !== "play") return;
    const text = event.clipboardData?.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    terminalRef.current.appendDraft(text);
    syncTerminalSnapshot();
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

  function syncTerminalSnapshot() {
    setGameState((current) =>
      current
        ? {
            ...current,
            monitors: {
              ...current.monitors,
              center: { terminal: terminalRef.current.snapshot() }
            }
          }
        : current
    );
  }

  return (
    <main class="app-shell">
      <header class="topbar">
        <strong>障害対応訓練</strong>
        <span>{selectedScenarioTitle}</span>
        <button type="button" onClick={() => setScreen("select")} disabled={screen === "play" || isStarting}>Scenario</button>
        {canOpenReplay && <button type="button" onClick={() => setScreen("replay")}>Replay</button>}
      </header>

      {appError && <p class="app-error" role="alert">{appError}</p>}

      {screen === "select" && (
        <section class="panel">
          <h1>初級シナリオ</h1>
          <div class="scenario-list">
            {scenarios.map((item) => (
              <button class="scenario-button" type="button" onClick={() => selectScenario(item.id)} key={item.id}>
                <span>{item.title}</span>
                <small>{item.difficulty} / {item.timeLimitMinutes} min</small>
              </button>
            ))}
          </div>
        </section>
      )}

      {screen === "briefing" && scenario && (
        <section class="panel">
          <h1>{scenario.title}</h1>
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
