import {
  ASSIST_SYSTEM_PROMPT,
  computeSnapshotSize,
  normalizeCanvasCaptureRect,
  progressEventRatio,
  type AssistAvailability,
  type CanvasCaptureRect,
} from '../pure/aiAssist.js';

interface LanguageModelMessageContent {
  type: 'text' | 'image';
  value: string | HTMLCanvasElement;
}

interface LanguageModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | LanguageModelMessageContent[];
}

interface LanguageModelExpectation {
  type: 'text' | 'image' | 'audio';
  languages?: string[];
}

interface LanguageModelCreateOptions {
  initialPrompts?: LanguageModelMessage[];
  expectedInputs?: LanguageModelExpectation[];
  expectedOutputs?: LanguageModelExpectation[];
  signal?: AbortSignal;
  monitor?(monitor: EventTarget): void;
}

export interface AssistantSession {
  promptStreaming(
    input: LanguageModelMessage[]
  ): ReadableStream<string> & AsyncIterable<string>;
  append(input: LanguageModelMessage[]): Promise<void>;
  clone(options?: {signal?: AbortSignal}): Promise<AssistantSession>;
  destroy(): void;
}

export interface AssistantSessionPool {
  prewarm(
    create: (signal: AbortSignal) => Promise<AssistantSession>
  ): Promise<void>;
  acquire(
    create: (signal: AbortSignal) => Promise<AssistantSession>
  ): Promise<AssistantSession>;
  release(session: AssistantSession): void;
  destroy(): void;
}

export function createAssistantSessionPool(): AssistantSessionPool {
  let baseSession: AssistantSession | undefined;
  let pending: Promise<AssistantSession> | undefined;
  const activeSessions = new Set<AssistantSession>();
  const controller = new AbortController();
  let destroyed = false;

  const getBase = (
    create: (signal: AbortSignal) => Promise<AssistantSession>
  ) => {
    if (destroyed) {
      return Promise.reject(new Error('Assistant session pool is destroyed'));
    }
    if (baseSession) return Promise.resolve(baseSession);
    if (pending) return pending;
    pending = create(controller.signal)
      .then((created) => {
        if (destroyed) {
          created.destroy();
          throw new Error('Assistant session pool is destroyed');
        }
        baseSession = created;
        return created;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };

  return {
    async prewarm(create) {
      await getBase(create);
    },
    async acquire(create) {
      const base = await getBase(create);
      const session = await base.clone({signal: controller.signal});
      if (destroyed) {
        session.destroy();
        throw new Error('Assistant session pool is destroyed');
      }
      activeSessions.add(session);
      return session;
    },
    release(session) {
      if (!activeSessions.delete(session)) return;
      session.destroy();
    },
    destroy() {
      destroyed = true;
      controller.abort();
      for (const session of activeSessions) session.destroy();
      activeSessions.clear();
      baseSession?.destroy();
      baseSession = undefined;
    },
  };
}

interface LanguageModelEntry {
  availability(
    options?: Omit<LanguageModelCreateOptions, 'initialPrompts' | 'monitor'>
  ): Promise<Exclude<AssistAvailability, 'unsupported'>>;
  create(options?: LanguageModelCreateOptions): Promise<AssistantSession>;
}

const EXPECTED_INPUTS: LanguageModelExpectation[] = [
  {type: 'text', languages: ['ja', 'en']},
  {type: 'image', languages: ['ja', 'en']},
];
const EXPECTED_OUTPUTS: LanguageModelExpectation[] = [
  {type: 'text', languages: ['ja']},
];

const DOWNLOAD_STALL_WARNING_MS = 15_000;
const DOWNLOAD_LOG_STEP_PERCENT = 5;
const LOG_PREFIX = '[on-device-ai]';

function errorDetails(error: unknown): {name?: string; message: string} {
  if (error instanceof Error) {
    return {name: error.name, message: error.message};
  }
  return {message: String(error)};
}

function promptApiEntry(): LanguageModelEntry | undefined {
  return (globalThis as {LanguageModel?: LanguageModelEntry}).LanguageModel;
}

export async function checkAssistAvailability(): Promise<AssistAvailability> {
  const entry = promptApiEntry();
  if (!entry) {
    console.warn(LOG_PREFIX, 'availability: API is not exposed');
    return 'unsupported';
  }
  const startedAt = Date.now();
  console.info(LOG_PREFIX, 'availability: checking');
  try {
    const availability = await entry.availability({
      expectedInputs: EXPECTED_INPUTS,
      expectedOutputs: EXPECTED_OUTPUTS,
    });
    console.info(LOG_PREFIX, 'availability: resolved', {
      availability,
      elapsedMs: Date.now() - startedAt,
    });
    return availability;
  } catch (error) {
    console.warn(LOG_PREFIX, 'availability: rejected', {
      ...errorDetails(error),
      elapsedMs: Date.now() - startedAt,
    });
    return 'unavailable';
  }
}

export async function createAssistantSession(
  onDownloadProgress?: (loaded: number) => void,
  signal?: AbortSignal
): Promise<AssistantSession> {
  const entry = promptApiEntry();
  if (!entry) throw new Error('Prompt API is not available');
  const startedAt = Date.now();
  let monitorAttached = false;
  let progressEventCount = 0;
  let lastLoggedPercent = -DOWNLOAD_LOG_STEP_PERCENT;

  console.info(LOG_PREFIX, 'create: requested', {
    online: typeof navigator === 'undefined' ? undefined : navigator.onLine,
    signalAborted: signal?.aborted ?? false,
    visibilityState:
      typeof document === 'undefined' ? undefined : document.visibilityState,
  });

  const handleAbort = () => {
    console.warn(LOG_PREFIX, 'create: abort signal received', {
      elapsedMs: Date.now() - startedAt,
      monitorAttached,
      progressEventCount,
    });
  };
  signal?.addEventListener('abort', handleAbort, {once: true});

  const warnIfStalled = () => {
    console.warn(
      LOG_PREFIX,
      progressEventCount === 0
        ? 'create: no progress after 15 seconds'
        : 'create: progress stalled for 15 seconds',
      {
        elapsedMs: Date.now() - startedAt,
        monitorAttached,
        online: typeof navigator === 'undefined' ? undefined : navigator.onLine,
        progressEventCount,
        signalAborted: signal?.aborted ?? false,
        visibilityState:
          typeof document === 'undefined'
            ? undefined
            : document.visibilityState,
      }
    );
  };
  let stallWarningId = globalThis.setTimeout(
    warnIfStalled,
    DOWNLOAD_STALL_WARNING_MS
  );

  try {
    const session = await entry.create({
      initialPrompts: [{role: 'system', content: ASSIST_SYSTEM_PROMPT}],
      expectedInputs: EXPECTED_INPUTS,
      expectedOutputs: EXPECTED_OUTPUTS,
      ...(signal ? {signal} : {}),
      monitor(monitor) {
        monitorAttached = true;
        console.info(LOG_PREFIX, 'create: download monitor attached', {
          elapsedMs: Date.now() - startedAt,
        });
        monitor.addEventListener('downloadprogress', (event) => {
          globalThis.clearTimeout(stallWarningId);
          stallWarningId = globalThis.setTimeout(
            warnIfStalled,
            DOWNLOAD_STALL_WARNING_MS
          );
          progressEventCount += 1;
          const progressEvent = event as ProgressEvent;
          const ratio = progressEventRatio(progressEvent);
          if (ratio !== undefined) {
            const percent = Math.round(ratio * 100);
            if (
              progressEventCount === 1 ||
              percent === 100 ||
              percent >= lastLoggedPercent + DOWNLOAD_LOG_STEP_PERCENT
            ) {
              lastLoggedPercent = percent;
              console.info(LOG_PREFIX, 'create: download progress', {
                elapsedMs: Date.now() - startedAt,
                eventCount: progressEventCount,
                loaded: progressEvent.loaded,
                total: progressEvent.total,
                lengthComputable: progressEvent.lengthComputable,
                percent,
              });
            }
            onDownloadProgress?.(ratio);
          } else {
            console.warn(LOG_PREFIX, 'create: invalid progress event', {
              elapsedMs: Date.now() - startedAt,
              eventCount: progressEventCount,
              loaded: progressEvent.loaded,
              total: progressEvent.total,
            });
          }
        });
      },
    });
    console.info(LOG_PREFIX, 'create: resolved', {
      elapsedMs: Date.now() - startedAt,
      monitorAttached,
      progressEventCount,
    });
    return session;
  } catch (error) {
    console.error(LOG_PREFIX, 'create: rejected', {
      ...errorDetails(error),
      elapsedMs: Date.now() - startedAt,
      monitorAttached,
      progressEventCount,
      signalAborted: signal?.aborted ?? false,
    });
    throw error;
  } finally {
    globalThis.clearTimeout(stallWarningId);
    signal?.removeEventListener('abort', handleAbort);
  }
}

export interface CanvasSnapshot {
  canvas: HTMLCanvasElement;
  previewUrl: string;
}

export function captureCanvasSnapshot(
  source: HTMLCanvasElement,
  sourceRect?: CanvasCaptureRect
): CanvasSnapshot {
  const captureRect = normalizeCanvasCaptureRect(
    sourceRect
      ? {
          startX: sourceRect.x,
          startY: sourceRect.y,
          endX: sourceRect.x + sourceRect.width,
          endY: sourceRect.y + sourceRect.height,
        }
      : {startX: 0, startY: 0, endX: source.width, endY: source.height},
    {width: source.width, height: source.height},
    {width: source.width, height: source.height}
  );
  if (captureRect.width === 0 || captureRect.height === 0) {
    throw new Error('スクリーンショットの範囲が空です');
  }
  const {width, height} = computeSnapshotSize(
    captureRect.width,
    captureRect.height
  );
  const snapshot = document.createElement('canvas');
  snapshot.width = width;
  snapshot.height = height;
  const context = snapshot.getContext('2d');
  if (!context) throw new Error('スクリーンショットの取得に失敗しました');
  context.drawImage(
    source,
    captureRect.x,
    captureRect.y,
    captureRect.width,
    captureRect.height,
    0,
    0,
    width,
    height
  );
  return {canvas: snapshot, previewUrl: snapshot.toDataURL('image/jpeg', 0.7)};
}

function buildImageAskText(question: string): string {
  return [
    '最新の添付画像だけを根拠にしてください。読めない文字は推測しないでください。',
    '画像にNEXTがあれば、そのコマンド列を確認工程まで次の一手へ完全にコピーしてください(途中で切らないでください)。ただしそのコマンドが実行済みで解決していない場合は、チャットの助言など他の画面内のコマンドを次の一手にしてください。',
    '次の一手のコマンドは画像内の文字列をそのままコピーし、画像にないコマンドを作らず、Runbookの注意書きや方針の復唱はしないでください。必ず180文字以内で答えてください。',
    `質問: ${question}`,
  ].join('\n');
}

export function askAssistant(
  session: AssistantSession,
  question: string,
  snapshot?: HTMLCanvasElement
): ReadableStream<string> & AsyncIterable<string> {
  if (!snapshot) {
    return session.promptStreaming([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            value: [
              '画像はありません。質問文だけを根拠にしてください。回答に「画面」「画像」「添付」を含めず、具体的な数値、固有名詞、コマンドを作らないでください。',
              `質問: ${question}`,
            ].join('\n'),
          },
        ],
      },
    ]);
  }
  return session.promptStreaming([
    {
      role: 'user',
      content: [
        {type: 'text', value: buildImageAskText(question)},
        {type: 'image', value: snapshot},
      ],
    },
  ]);
}

/** Backwards-compatible helper for callers that always attach the canvas. */
export function askAboutSnapshot(
  session: AssistantSession,
  question: string,
  snapshot: HTMLCanvasElement
): ReadableStream<string> & AsyncIterable<string> {
  return askAssistant(session, question, snapshot);
}

/**
 * Appends a screenshot to the session ahead of time so the eventual question
 * only has to stream a text-only prompt (faster time-to-first-token).
 */
export async function appendSnapshot(
  session: AssistantSession,
  snapshot: HTMLCanvasElement
): Promise<void> {
  await session.append([
    {
      role: 'user',
      content: [{type: 'image', value: snapshot}],
    },
  ]);
}

/**
 * Asks a question against a session that already has a snapshot appended via
 * {@link appendSnapshot}. Sends the same instruction text as the image path
 * of {@link askAssistant}, without re-sending the image.
 */
export function askPreparedAssistant(
  session: AssistantSession,
  question: string
): ReadableStream<string> & AsyncIterable<string> {
  return session.promptStreaming([
    {
      role: 'user',
      content: [{type: 'text', value: buildImageAskText(question)}],
    },
  ]);
}
