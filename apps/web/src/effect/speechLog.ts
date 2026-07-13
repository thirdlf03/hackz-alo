import type {
  SpeechLogAvailability,
  SpeechPhrase,
} from '../pure/speechPhrases.js';

// Web Speech API のコンテキストバイアス(フレーズリスト)関連は Chrome 142+ の
// 実験的機能で lib.dom.d.ts に未収載のため、必要な形だけ局所的に宣言する。
interface SpeechRecognitionPhraseCtor {
  new (phrase: string, boost?: number): object;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  phrases?: object[];
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionCtor {
  new (): SpeechRecognitionLike;
}

function recognitionCtor(): SpeechRecognitionCtor | undefined {
  const scope = globalThis as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

function phraseCtor(): SpeechRecognitionPhraseCtor | undefined {
  return (globalThis as {SpeechRecognitionPhrase?: SpeechRecognitionPhraseCtor})
    .SpeechRecognitionPhrase;
}

export function detectSpeechLogAvailability(): SpeechLogAvailability {
  const Ctor = recognitionCtor();
  if (!Ctor) return 'unsupported';
  if (!phraseCtor()) return 'no-phrase-support';
  try {
    if (!('phrases' in new Ctor())) return 'no-phrase-support';
  } catch {
    return 'no-phrase-support';
  }
  return 'ready';
}

function applyPhrases(
  recognition: SpeechRecognitionLike,
  phrases: SpeechPhrase[]
): boolean {
  const Phrase = phraseCtor();
  if (!Phrase || !('phrases' in recognition)) return false;
  try {
    recognition.phrases = phrases.map(
      ({phrase, boost}) => new Phrase(phrase, boost)
    );
    return true;
  } catch {
    return false;
  }
}

export interface SpeechCaptureHandle {
  stop(): void;
}

export interface StartSpeechCaptureOptions {
  phrases: SpeechPhrase[];
  onResult(transcript: string, isFinal: boolean): void;
  onError(error: string): void;
  /** 認識セッション終了時(stop 後の finalize 含む)に一度呼ばれる。 */
  onEnd?(): void;
}

/**
 * プッシュトゥトーク 1 回分の音声認識を開始する。フレーズリスト対応環境では
 * コンテキストバイアスを適用し、`phrases-not-supported` エラー時はフレーズ
 * なしで一度だけ自動再試行する。`stop()` は羃等。
 */
export function startSpeechCapture(
  options: StartSpeechCaptureOptions
): SpeechCaptureHandle {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    options.onError('unsupported');
    return {stop() {}};
  }

  let stopped = false;
  let retriedWithoutPhrases = false;
  let ended = false;
  let active: SpeechRecognitionLike | undefined;

  const finish = (): void => {
    if (ended) return;
    ended = true;
    options.onEnd?.();
  };

  const readTranscript = (event: SpeechRecognitionEventLike): void => {
    let transcript = '';
    let isFinal = false;
    const {results} = event;
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (!result || result.length === 0) continue;
      transcript += result[0]?.transcript ?? '';
      if (result.isFinal) isFinal = true;
    }
    options.onResult(transcript, isFinal);
  };

  const launch = (withPhrases: boolean): void => {
    const recognition = new Ctor();
    active = recognition;
    recognition.lang = 'ja-JP';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
    if (withPhrases && options.phrases.length > 0) {
      applyPhrases(recognition, options.phrases);
    }
    recognition.onresult = readTranscript;
    recognition.onerror = (event) => {
      if (
        event.error === 'phrases-not-supported' &&
        !retriedWithoutPhrases &&
        !stopped
      ) {
        retriedWithoutPhrases = true;
        launch(false);
        return;
      }
      options.onError(event.error);
    };
    recognition.onend = () => {
      if (active !== recognition) return; // 置き換えられた旧インスタンス(再試行)は無視
      active = undefined;
      finish();
    };
    try {
      recognition.start();
    } catch (error) {
      options.onError(error instanceof Error ? error.message : 'start-failed');
      if (active === recognition) {
        active = undefined;
        finish();
      }
    }
  };

  launch(true);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        active?.stop();
      } catch {
        // already stopped / not started — ignore
      }
    },
  };
}
