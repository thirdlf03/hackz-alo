import {
  ASSIST_SYSTEM_PROMPT,
  computeSnapshotSize,
  progressEventRatio,
  type AssistAvailability,
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
  destroy(): void;
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
  source: HTMLCanvasElement
): CanvasSnapshot {
  const {width, height} = computeSnapshotSize(source.width, source.height);
  const snapshot = document.createElement('canvas');
  snapshot.width = width;
  snapshot.height = height;
  const context = snapshot.getContext('2d');
  if (!context) throw new Error('スクリーンショットの取得に失敗しました');
  context.drawImage(source, 0, 0, width, height);
  return {canvas: snapshot, previewUrl: snapshot.toDataURL('image/jpeg', 0.7)};
}

export function askAboutSnapshot(
  session: AssistantSession,
  question: string,
  snapshot: HTMLCanvasElement
): ReadableStream<string> & AsyncIterable<string> {
  return session.promptStreaming([
    {
      role: 'user',
      content: [
        {
          type: 'text',
          value: [
            'このメッセージの最後にある画像が最新の添付画像です。この画像を根拠に回答してください。',
            '画像内で見える具体的な証拠を示し、読めない箇所は推測せずその旨を伝えてください。',
            `質問: ${question}`,
          ].join('\n'),
        },
        {type: 'image', value: snapshot},
      ],
    },
  ]);
}
