import {
  ASSIST_SYSTEM_PROMPT,
  computeSnapshotSize,
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
  {type: 'image'},
];
const EXPECTED_OUTPUTS: LanguageModelExpectation[] = [
  {type: 'text', languages: ['ja']},
];

function promptApiEntry(): LanguageModelEntry | undefined {
  return (globalThis as {LanguageModel?: LanguageModelEntry}).LanguageModel;
}

export async function checkAssistAvailability(): Promise<AssistAvailability> {
  const entry = promptApiEntry();
  if (!entry) return 'unsupported';
  try {
    return await entry.availability({
      expectedInputs: EXPECTED_INPUTS,
      expectedOutputs: EXPECTED_OUTPUTS,
    });
  } catch {
    return 'unavailable';
  }
}

export async function createAssistantSession(
  onDownloadProgress?: (loaded: number) => void
): Promise<AssistantSession> {
  const entry = promptApiEntry();
  if (!entry) throw new Error('Prompt API is not available');
  return entry.create({
    initialPrompts: [{role: 'system', content: ASSIST_SYSTEM_PROMPT}],
    expectedInputs: EXPECTED_INPUTS,
    expectedOutputs: EXPECTED_OUTPUTS,
    monitor(monitor) {
      monitor.addEventListener('downloadprogress', (event) => {
        onDownloadProgress?.((event as ProgressEvent).loaded);
      });
    },
  });
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
        {type: 'text', value: question},
        {type: 'image', value: snapshot},
      ],
    },
  ]);
}
