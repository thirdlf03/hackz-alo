import {createPortal} from 'preact/compat';
import {useEffect, useRef, useState} from 'preact/hooks';
import type {GameRenderState, ScenarioDefinition} from '@incident/shared';
import {
  buildAssistPrompt,
  describeAssistAvailability,
  formatDownloadProgress,
  normalizeCanvasCaptureRect,
  type AssistAvailability,
  type CanvasCaptureRect,
} from '../pure/aiAssist.js';
import {
  appendSnapshot,
  askAssistant,
  askPreparedAssistant,
  captureCanvasSnapshot,
  checkAssistAvailability,
  createAssistantSession,
  createAssistantSessionPool,
  type AssistantSession,
} from '../effect/promptAssistant.js';
import {groundAssistNextStep} from '../pure/assistGrounding.js';
import {
  describeGroundingBadge,
  type GroundingBadgeInfo,
} from '../pure/assistGroundingBadge.js';
import {buildCanvasViewModel} from '../pure/canvasViewModel.js';
import {serializeScreenLines} from '../pure/serializeScreenLines.js';
import {ModelDownloadProgress} from './ModelDownloadProgress.js';

interface SelectionBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SelectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PreparedAssistSession {
  session: AssistantSession;
  snapshotCanvas: HTMLCanvasElement;
  previewUrl: string;
  appendPromise: Promise<void>;
  capturedAt: number;
  screenLines: string[] | undefined;
}

/** Prepared sessions older than this are discarded and re-captured on ask(). */
const PREPARED_SESSION_MAX_AGE_MS = 30_000;

export function AiAssistPanel(props: {
  canvasRef: {current: HTMLCanvasElement | null};
  gameStateRef: {current: GameRenderState | undefined};
  scenarioRef: {current: ScenarioDefinition | undefined};
}) {
  const sessionPoolRef = useRef(createAssistantSessionPool());
  const [availability, setAvailability] = useState<AssistAvailability>();
  const [downloadProgress, setDownloadProgress] = useState<number>();
  const [question, setQuestion] = useState('');
  const [attachScreenshot, setAttachScreenshot] = useState(true);
  const [captureRect, setCaptureRect] = useState<CanvasCaptureRect>();
  const [selectionBounds, setSelectionBounds] = useState<SelectionBounds>();
  const [selectionBox, setSelectionBox] = useState<SelectionBox>();
  const [answer, setAnswer] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [assistError, setAssistError] = useState<string>();
  const [grounding, setGrounding] = useState<GroundingBadgeInfo>();
  const selectionStartRef = useRef<{x: number; y: number} | null>(null);
  const preparedSessionRef = useRef<PreparedAssistSession | undefined>(
    undefined
  );
  const preparingRef = useRef(false);

  const discardPreparedSession = () => {
    const prepared = preparedSessionRef.current;
    if (!prepared) return;
    preparedSessionRef.current = undefined;
    sessionPoolRef.current.release(prepared.session);
  };

  // Serializes the literal on-screen text at the current moment (same data
  // the canvas renders from) so the eventual answer can be cross-checked
  // against it via groundAssistNextStep(). Returns undefined when the game
  // state isn't available yet (e.g. before the first render).
  const captureScreenLines = (): string[] | undefined => {
    const state = props.gameStateRef.current;
    if (!state) return undefined;
    const viewModel = buildCanvasViewModel(state, props.scenarioRef.current);
    return serializeScreenLines(state, viewModel);
  };

  useEffect(() => {
    let cancelled = false;
    void checkAssistAvailability().then((state) => {
      if (!cancelled) setAvailability(state);
    });
    return () => {
      cancelled = true;
      sessionPoolRef.current.destroy();
    };
  }, []);

  useEffect(() => {
    if (availability !== 'available') return;
    void sessionPoolRef.current
      .prewarm((signal) => createAssistantSession(undefined, signal))
      .catch((error: unknown) => {
        console.warn('[on-device-ai] prewarm failed', error);
      });
  }, [availability]);

  useEffect(() => {
    if (!selectionBounds) return;
    const cancelSelection = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSelectionBounds(undefined);
      setSelectionBox(undefined);
      selectionStartRef.current = null;
    };
    window.addEventListener('keydown', cancelSelection);
    return () => {
      window.removeEventListener('keydown', cancelSelection);
    };
  }, [selectionBounds]);

  const ensureSession = async (): Promise<AssistantSession> => {
    return sessionPoolRef.current.acquire(async (signal) => {
      if (availability !== 'available') {
        setAvailability('downloading');
        setDownloadProgress(0);
      }
      const session = await createAssistantSession(setDownloadProgress, signal);
      setAvailability('available');
      setDownloadProgress(undefined);
      return session;
    });
  };

  // Prepares a session (screenshot already appended) ahead of Ask so the
  // question only has to stream a text-only prompt, cutting TTFT.
  useEffect(() => {
    if (availability !== 'available') return;
    if (!attachScreenshot) return;
    if (busy) return;
    if (preparedSessionRef.current || preparingRef.current) return;
    const canvas = props.canvasRef.current;
    if (!canvas) return;
    if (!question.trim() && !captureRect) return;

    preparingRef.current = true;
    const guard = {cancelled: false};

    void (async () => {
      try {
        const snapshot = captureCanvasSnapshot(canvas, captureRect);
        setPreviewUrl(snapshot.previewUrl);
        const screenLines = captureScreenLines();
        const session = await ensureSession();
        if (guard.cancelled) {
          sessionPoolRef.current.release(session);
          return;
        }
        const capturedAt = Date.now();
        const preparedAppendPromise = appendSnapshot(session, snapshot.canvas);
        preparedAppendPromise.catch((error: unknown) => {
          console.warn('[on-device-ai] append snapshot failed', error);
          if (preparedSessionRef.current?.session === session) {
            preparedSessionRef.current = undefined;
          }
          sessionPoolRef.current.release(session);
        });
        preparedSessionRef.current = {
          session,
          snapshotCanvas: snapshot.canvas,
          previewUrl: snapshot.previewUrl,
          appendPromise: preparedAppendPromise,
          capturedAt,
          screenLines,
        };
      } catch (error) {
        console.warn('[on-device-ai] prepare session failed', error);
      } finally {
        preparingRef.current = false;
      }
    })();

    return () => {
      guard.cancelled = true;
    };
  }, [availability, attachScreenshot, busy, question, captureRect]);

  if (
    availability === undefined ||
    availability === 'unsupported' ||
    availability === 'unavailable'
  ) {
    return null;
  }

  const ask = async () => {
    const prompt = buildAssistPrompt(question);
    const canvas = props.canvasRef.current;
    if (!prompt || (attachScreenshot && !canvas) || busy) return;
    setBusy(true);
    setAssistError(undefined);
    setAnswer('');
    setGrounding(undefined);
    let session: AssistantSession | undefined;
    let accumulatedAnswer = '';
    let screenLines: string[] | undefined;
    try {
      let usedPrepared = false;
      if (attachScreenshot && preparedSessionRef.current) {
        const prepared = preparedSessionRef.current;
        preparedSessionRef.current = undefined;
        const fresh =
          Date.now() - prepared.capturedAt <= PREPARED_SESSION_MAX_AGE_MS;
        if (!fresh) {
          sessionPoolRef.current.release(prepared.session);
        } else {
          try {
            await prepared.appendPromise;
            session = prepared.session;
            setPreviewUrl(prepared.previewUrl);
            screenLines = prepared.screenLines;
            usedPrepared = true;
          } catch (error) {
            console.warn(
              '[on-device-ai] prepared session append failed, falling back',
              error
            );
            sessionPoolRef.current.release(prepared.session);
          }
        }
      }

      if (usedPrepared && session) {
        const stream = askPreparedAssistant(session, prompt);
        for await (const chunk of stream) {
          accumulatedAnswer += chunk;
          setAnswer(accumulatedAnswer);
        }
      } else {
        const snapshot =
          attachScreenshot && canvas
            ? captureCanvasSnapshot(canvas, captureRect)
            : undefined;
        setPreviewUrl(snapshot?.previewUrl);
        if (attachScreenshot) {
          screenLines = captureScreenLines();
        }
        session = await ensureSession();
        const stream = askAssistant(session, prompt, snapshot?.canvas);
        for await (const chunk of stream) {
          accumulatedAnswer += chunk;
          setAnswer(accumulatedAnswer);
        }
      }

      if (attachScreenshot && screenLines) {
        const result = groundAssistNextStep(accumulatedAnswer, screenLines);
        setGrounding(describeGroundingBadge(result));
      }
    } catch (error) {
      console.error(error);
      setAssistError(
        availability === 'available'
          ? 'AIへの質問に失敗しました。もう一度お試しください。'
          : 'AIモデルの準備に失敗しました。'
      );
      setAvailability((current) =>
        current === 'downloading' ? 'downloadable' : current
      );
      setDownloadProgress(undefined);
      setGrounding(undefined);
    } finally {
      if (session) sessionPoolRef.current.release(session);
      setBusy(false);
    }
  };

  const beginRegionSelection = () => {
    const canvas = props.canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    setAssistError(undefined);
    setSelectionBox(undefined);
    selectionStartRef.current = null;
    setSelectionBounds({
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
    });
  };

  const selectionPoint = (event: PointerEvent) => {
    if (!selectionBounds) return {x: 0, y: 0};
    return {
      x: Math.min(
        selectionBounds.width,
        Math.max(0, event.clientX - selectionBounds.left)
      ),
      y: Math.min(
        selectionBounds.height,
        Math.max(0, event.clientY - selectionBounds.top)
      ),
    };
  };

  const updateSelectionBox = (end: {x: number; y: number}) => {
    const start = selectionStartRef.current;
    if (!start) return;
    setSelectionBox({
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    });
  };

  const finishRegionSelection = (event: PointerEvent) => {
    const start = selectionStartRef.current;
    const bounds = selectionBounds;
    const canvas = props.canvasRef.current;
    if (!start || !bounds || !canvas) return;
    const end = selectionPoint(event);
    const selectedBox = {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    };
    if (selectedBox.width < 8 || selectedBox.height < 8) {
      setAssistError('添付したい範囲をドラッグしてください。');
      setSelectionBox(undefined);
      selectionStartRef.current = null;
      return;
    }
    const nextCaptureRect = normalizeCanvasCaptureRect(
      {
        startX: start.x,
        startY: start.y,
        endX: end.x,
        endY: end.y,
      },
      {width: bounds.width, height: bounds.height},
      {width: canvas.width, height: canvas.height}
    );
    discardPreparedSession();
    setCaptureRect(nextCaptureRect);
    setPreviewUrl(captureCanvasSnapshot(canvas, nextCaptureRect).previewUrl);
    setSelectionBounds(undefined);
    setSelectionBox(undefined);
    selectionStartRef.current = null;
  };

  return (
    <>
      <section class='ai-assist' aria-label='オンデバイスAIアシスタント'>
        <label class='ai-assist-attachment-toggle'>
          <input
            type='checkbox'
            checked={attachScreenshot}
            disabled={busy}
            onChange={(event) => {
              setAttachScreenshot(event.currentTarget.checked);
              if (!event.currentTarget.checked) {
                discardPreparedSession();
                setPreviewUrl(undefined);
              }
            }}
          />
          スクショを添付する
        </label>
        {attachScreenshot && (
          <div class='ai-assist-capture-controls'>
            <button
              type='button'
              disabled={busy}
              onClick={beginRegionSelection}
            >
              {captureRect ? '範囲を選び直す' : '範囲を選択'}
            </button>
            {captureRect && (
              <button
                type='button'
                class='ghost'
                disabled={busy}
                onClick={() => {
                  discardPreparedSession();
                  setCaptureRect(undefined);
                  setPreviewUrl(undefined);
                }}
              >
                全画面に戻す
              </button>
            )}
            <span>
              {captureRect
                ? `${String(captureRect.width)}×${String(captureRect.height)} を添付`
                : '未選択の場合はゲーム画面全体'}
            </span>
          </div>
        )}
        <p class='ai-assist-status' role='status'>
          {availability === 'downloading' && downloadProgress !== undefined
            ? `${describeAssistAvailability(availability)} ${formatDownloadProgress(downloadProgress)}`
            : describeAssistAvailability(availability)}
        </p>
        {availability === 'downloading' && (
          <ModelDownloadProgress progress={downloadProgress} />
        )}
        <form
          class='team-composer'
          onSubmit={(event) => {
            event.preventDefault();
            void ask();
          }}
        >
          <input
            value={question}
            placeholder='例: 今どのサービスが怪しい?'
            aria-label='ゲーム画面についてAIに質問'
            disabled={busy}
            onInput={(event) => {
              setQuestion(event.currentTarget.value);
            }}
          />
          <button
            type='submit'
            disabled={busy || buildAssistPrompt(question) === undefined}
          >
            {busy ? '解析中…' : attachScreenshot ? '📸 質問' : '質問'}
          </button>
        </form>
        {assistError && (
          <p class='ai-assist-error' role='alert'>
            {assistError}
          </p>
        )}
        {previewUrl && (
          <img
            class='ai-assist-preview'
            src={previewUrl}
            alt='AIに送信したゲーム画面のスクリーンショット'
          />
        )}
        {answer && <p class='ai-assist-answer'>{answer}</p>}
        {answer && grounding && (
          <div
            class={`ai-assist-grounding ai-assist-grounding-${grounding.tone}`}
            role={
              grounding.tone === 'rejected' || grounding.tone === 'unverified'
                ? 'alert'
                : 'status'
            }
          >
            <p class='ai-assist-grounding-badge'>{grounding.label}</p>
            {grounding.detail && (
              <p class='ai-assist-grounding-detail'>{grounding.detail}</p>
            )}
          </div>
        )}
      </section>
      {selectionBounds &&
        createPortal(
          <div
            class='ai-assist-selection-overlay'
            style={{
              left: `${String(selectionBounds.left)}px`,
              top: `${String(selectionBounds.top)}px`,
              width: `${String(selectionBounds.width)}px`,
              height: `${String(selectionBounds.height)}px`,
            }}
            role='application'
            aria-label='スクリーンショットの添付範囲を選択'
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              selectionStartRef.current = selectionPoint(event);
              setSelectionBox(undefined);
            }}
            onPointerMove={(event) => {
              if (!selectionStartRef.current) return;
              updateSelectionBox(selectionPoint(event));
            }}
            onPointerUp={(event) => {
              finishRegionSelection(event);
            }}
          >
            <p class='ai-assist-selection-hint'>
              添付する範囲をドラッグ · Escでキャンセル
            </p>
            {selectionBox && (
              <span
                class='ai-assist-selection-box'
                style={{
                  left: `${String(selectionBox.x)}px`,
                  top: `${String(selectionBox.y)}px`,
                  width: `${String(selectionBox.width)}px`,
                  height: `${String(selectionBox.height)}px`,
                }}
              />
            )}
          </div>,
          document.body
        )}
    </>
  );
}
