import {useEffect, useRef, useState} from 'preact/hooks';
import {
  buildAssistPrompt,
  describeAssistAvailability,
  formatDownloadProgress,
  type AssistAvailability,
} from '../pure/aiAssist.js';
import {
  askAboutSnapshot,
  captureCanvasSnapshot,
  checkAssistAvailability,
  createAssistantSession,
  type AssistantSession,
} from '../effect/promptAssistant.js';
import {ModelDownloadProgress} from './ModelDownloadProgress.js';

export function AiAssistPanel(props: {
  canvasRef: {current: HTMLCanvasElement | null};
}) {
  const sessionRef = useRef<AssistantSession | null>(null);
  const [availability, setAvailability] = useState<AssistAvailability>();
  const [downloadProgress, setDownloadProgress] = useState<number>();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [assistError, setAssistError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    void checkAssistAvailability().then((state) => {
      if (!cancelled) setAvailability(state);
    });
    return () => {
      cancelled = true;
      sessionRef.current?.destroy();
      sessionRef.current = null;
    };
  }, []);

  if (
    availability === undefined ||
    availability === 'unsupported' ||
    availability === 'unavailable'
  ) {
    return null;
  }

  const ensureSession = async (): Promise<AssistantSession> => {
    if (sessionRef.current) return sessionRef.current;
    if (availability !== 'available') {
      setAvailability('downloading');
      setDownloadProgress(0);
    }
    const session = await createAssistantSession(setDownloadProgress);
    sessionRef.current = session;
    setAvailability('available');
    setDownloadProgress(undefined);
    return session;
  };

  const ask = async () => {
    const prompt = buildAssistPrompt(question);
    const canvas = props.canvasRef.current;
    if (!prompt || !canvas || busy) return;
    setBusy(true);
    setAssistError(undefined);
    setAnswer('');
    try {
      const snapshot = captureCanvasSnapshot(canvas);
      setPreviewUrl(snapshot.previewUrl);
      const session = await ensureSession();
      const stream = askAboutSnapshot(session, prompt, snapshot.canvas);
      for await (const chunk of stream) {
        setAnswer((current) => current + chunk);
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
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class='ai-assist' aria-label='オンデバイスAIアシスタント'>
      <h2>
        AI Assist <span class='ai-assist-badge'>on-device</span>
      </h2>
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
          {busy ? '解析中…' : '📸 質問'}
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
    </section>
  );
}
