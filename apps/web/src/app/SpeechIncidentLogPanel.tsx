import {useEffect, useMemo, useRef, useState} from 'preact/hooks';
import type {IncidentLogEntryKind, ScenarioDefinition} from '@incident/shared';
import {
  buildSpeechPhrases,
  classifySpokenLog,
  describeSpeechLogAvailability,
  INCIDENT_LOG_KIND_LABELS,
  type SpeechLogAvailability,
} from '../pure/speechPhrases.js';
import {
  detectSpeechLogAvailability,
  startSpeechCapture,
  type SpeechCaptureHandle,
} from '../effect/speechLog.js';

const MIC_DENIED_ERRORS = new Set(['not-allowed', 'service-not-allowed']);

interface PendingLog {
  kind: IncidentLogEntryKind;
  body: string;
}

export function SpeechIncidentLogPanel(props: {
  scenario: ScenarioDefinition | undefined;
  canContribute: boolean;
  commandInputFocused: boolean;
  onAppendIncidentLog: (body: string, kind: IncidentLogEntryKind) => void;
}) {
  const [availability, setAvailability] = useState<SpeechLogAvailability>();
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState('');
  const [pending, setPending] = useState<PendingLog>();
  const [micDenied, setMicDenied] = useState(false);
  const [error, setError] = useState<string>();

  const captureRef = useRef<SpeechCaptureHandle | null>(null);
  const transcriptRef = useRef('');
  const focusedRef = useRef(props.commandInputFocused);
  focusedRef.current = props.commandInputFocused;

  const phrases = useMemo(
    () => buildSpeechPhrases(props.scenario),
    [props.scenario]
  );

  useEffect(() => {
    setAvailability(detectSpeechLogAvailability());
  }, []);

  const stopCapture = () => {
    captureRef.current?.stop();
    captureRef.current = null;
    setRecording(false);
  };

  const startCapture = () => {
    if (!props.canContribute || recording || pending) return;
    transcriptRef.current = '';
    setInterim('');
    setError(undefined);
    setRecording(true);
    captureRef.current = startSpeechCapture({
      phrases,
      onResult: (transcript) => {
        transcriptRef.current = transcript;
        setInterim(transcript);
      },
      onError: (code) => {
        if (MIC_DENIED_ERRORS.has(code)) setMicDenied(true);
        else if (code !== 'no-speech' && code !== 'aborted') {
          setError('音声認識に失敗しました。もう一度お試しください。');
        }
      },
      onEnd: () => {
        captureRef.current = null;
        setRecording(false);
        setInterim('');
        const classified = classifySpokenLog(transcriptRef.current);
        setPending(classified.body ? classified : undefined);
      },
    });
  };

  const confirm = () => {
    if (!pending) return;
    props.onAppendIncidentLog(pending.body, pending.kind);
    setPending(undefined);
  };

  const discard = () => {
    setPending(undefined);
  };

  // V キー長押しのプッシュトゥトーク。ターミナルのコマンド入力中は無効にして
  // 既存のコマンド入力と衝突させない。
  useEffect(() => {
    if (availability === undefined || availability === 'unsupported') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'v' && event.key !== 'V') return;
      if (event.repeat || focusedRef.current) return;
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) {
        return;
      }
      startCapture();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'v' || event.key === 'V') stopCapture();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  });

  useEffect(
    () => () => {
      captureRef.current?.stop();
      captureRef.current = null;
    },
    []
  );

  useEffect(() => {
    if (!pending) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        confirm();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        discard();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  });

  if (availability === undefined || availability === 'unsupported') return null;

  return (
    <section class='speech-log' aria-label='音声インシデントログ'>
      <p class='speech-log-status' role='status'>
        {micDenied
          ? 'マイクが未許可です。ブラウザの設定で許可してください。'
          : recording
            ? '録音中… 話し終えたらボタンを離してください'
            : describeSpeechLogAvailability(availability)}
      </p>
      <button
        type='button'
        class={`speech-log-mic${recording ? ' recording' : ''}`}
        aria-pressed={recording}
        aria-label={
          recording ? '録音を終了' : '押している間だけ録音(V キー長押しでも可)'
        }
        disabled={!props.canContribute || micDenied || pending !== undefined}
        onPointerDown={(event) => {
          event.preventDefault();
          startCapture();
        }}
        onPointerUp={stopCapture}
        onPointerLeave={() => {
          if (recording) stopCapture();
        }}
      >
        {recording ? '⏺ 録音中' : '🎙 押して話す'}
      </button>
      {!props.canContribute && (
        <p class='team-readonly-note' role='status'>
          Observer は閲覧専用です
        </p>
      )}
      {recording && interim && <p class='speech-log-interim'>{interim}</p>}
      {error && (
        <p class='speech-log-error' role='alert'>
          {error}
        </p>
      )}
      {pending && (
        <div
          class='speech-log-confirm'
          role='dialog'
          aria-label='記録内容の確認'
        >
          <p class='speech-log-confirm-kind'>
            {INCIDENT_LOG_KIND_LABELS[pending.kind]}
          </p>
          <p class='speech-log-confirm-body'>{pending.body}</p>
          <div class='speech-log-confirm-actions'>
            <button type='button' onClick={confirm}>
              記録 (Enter)
            </button>
            <button type='button' class='ghost' onClick={discard}>
              破棄 (Esc)
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
