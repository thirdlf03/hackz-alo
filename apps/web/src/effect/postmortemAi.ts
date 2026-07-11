import {
  progressEventRatio,
  type AssistAvailability,
} from '../pure/aiAssist.js';
import {POSTMORTEM_SHARED_CONTEXT} from '../pure/postmortem.js';

type StreamingResult = ReadableStream<string> & AsyncIterable<string>;

interface AiSessionCallbacks {
  onChunk?: (chunk: string) => void;
  onDownloadProgress?: (loaded: number) => void;
}

interface SummarizerCreateOptions {
  sharedContext?: string;
  type?: 'key-points' | 'tldr' | 'teaser' | 'headline';
  format?: 'markdown' | 'plain-text';
  length?: 'short' | 'medium' | 'long';
  expectedInputLanguages?: string[];
  outputLanguage?: string;
  monitor?(monitor: EventTarget): void;
}

interface SummarizerSession {
  summarize(input: string, options?: {context?: string}): Promise<string>;
  summarizeStreaming(
    input: string,
    options?: {context?: string}
  ): StreamingResult;
  destroy(): void;
}

interface SummarizerEntry {
  availability(
    options?: Omit<SummarizerCreateOptions, 'monitor'>
  ): Promise<Exclude<AssistAvailability, 'unsupported'>>;
  create(options?: SummarizerCreateOptions): Promise<SummarizerSession>;
}

interface WriterCreateOptions {
  sharedContext?: string;
  tone?: 'formal' | 'neutral' | 'casual';
  format?: 'markdown' | 'plain-text';
  length?: 'short' | 'medium' | 'long';
  expectedInputLanguages?: string[];
  outputLanguage?: string;
  monitor?(monitor: EventTarget): void;
}

interface WriterSession {
  write(task: string, options?: {context?: string}): Promise<string>;
  writeStreaming(task: string, options?: {context?: string}): StreamingResult;
  destroy(): void;
}

interface WriterEntry {
  availability(
    options?: Omit<WriterCreateOptions, 'monitor'>
  ): Promise<Exclude<AssistAvailability, 'unsupported'>>;
  create(options?: WriterCreateOptions): Promise<WriterSession>;
}

function summarizerEntry(): SummarizerEntry | undefined {
  return (globalThis as {Summarizer?: SummarizerEntry}).Summarizer;
}

function writerEntry(): WriterEntry | undefined {
  return (globalThis as {Writer?: WriterEntry}).Writer;
}

const SUMMARIZER_OPTIONS: Omit<SummarizerCreateOptions, 'monitor'> = {
  sharedContext: POSTMORTEM_SHARED_CONTEXT,
  type: 'key-points',
  format: 'markdown',
  length: 'medium',
};

const WRITER_OPTIONS: Omit<WriterCreateOptions, 'monitor'> = {
  sharedContext: POSTMORTEM_SHARED_CONTEXT,
  tone: 'formal',
  format: 'markdown',
  length: 'medium',
};

const LANGUAGE_OPTIONS = {
  expectedInputLanguages: ['ja'],
  outputLanguage: 'ja',
};

export async function checkSummarizerAvailability(): Promise<AssistAvailability> {
  const entry = summarizerEntry();
  if (!entry) return 'unsupported';
  try {
    return await entry.availability({
      ...SUMMARIZER_OPTIONS,
      ...LANGUAGE_OPTIONS,
    });
  } catch {
    return 'unavailable';
  }
}

export async function checkWriterAvailability(): Promise<AssistAvailability> {
  const entry = writerEntry();
  if (!entry) return 'unsupported';
  try {
    return await entry.availability({...WRITER_OPTIONS, ...LANGUAGE_OPTIONS});
  } catch {
    return 'unavailable';
  }
}

function monitorOption(onDownloadProgress?: (loaded: number) => void): {
  monitor(monitor: EventTarget): void;
} {
  return {
    monitor(monitor: EventTarget) {
      monitor.addEventListener('downloadprogress', (event) => {
        const ratio = progressEventRatio(event as ProgressEvent);
        if (ratio !== undefined) onDownloadProgress?.(ratio);
      });
    },
  };
}

async function collectStream(
  stream: StreamingResult,
  onChunk?: (chunk: string) => void
): Promise<string> {
  let text = '';
  for await (const chunk of stream) {
    text += chunk;
    onChunk?.(chunk);
  }
  return text;
}

/**
 * Summarizes the postmortem source with the on-device Summarizer API.
 * `outputLanguage: 'ja'` is attempted first; implementations that reject the
 * language options fall back to a default-language session.
 */
export async function summarizeTimeline(
  source: string,
  callbacks: AiSessionCallbacks = {}
): Promise<string> {
  const entry = summarizerEntry();
  if (!entry) throw new Error('Summarizer API is not available');
  let session: SummarizerSession;
  try {
    session = await entry.create({
      ...SUMMARIZER_OPTIONS,
      ...LANGUAGE_OPTIONS,
      ...monitorOption(callbacks.onDownloadProgress),
    });
  } catch {
    session = await entry.create({
      ...SUMMARIZER_OPTIONS,
      ...monitorOption(callbacks.onDownloadProgress),
    });
  }
  try {
    return await collectStream(
      session.summarizeStreaming(source),
      callbacks.onChunk
    );
  } finally {
    session.destroy();
  }
}

/**
 * Writes a postmortem section (root cause / actions) with the Writer API.
 * Same `outputLanguage: 'ja'` fallback strategy as the Summarizer wrapper.
 */
export async function writeSection(
  task: string,
  context: string,
  callbacks: AiSessionCallbacks = {}
): Promise<string> {
  const entry = writerEntry();
  if (!entry) throw new Error('Writer API is not available');
  let session: WriterSession;
  try {
    session = await entry.create({
      ...WRITER_OPTIONS,
      ...LANGUAGE_OPTIONS,
      ...monitorOption(callbacks.onDownloadProgress),
    });
  } catch {
    session = await entry.create({
      ...WRITER_OPTIONS,
      ...monitorOption(callbacks.onDownloadProgress),
    });
  }
  try {
    return await collectStream(
      session.writeStreaming(task, {context}),
      callbacks.onChunk
    );
  } finally {
    session.destroy();
  }
}
