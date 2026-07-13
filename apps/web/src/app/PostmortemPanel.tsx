import {useEffect, useMemo, useState} from 'preact/hooks';
import {createApiClient} from '../api/client.js';
import {
  formatDownloadProgress,
  type AssistAvailability,
} from '../pure/aiAssist.js';
import {
  buildPostmortemMarkdown,
  buildPostmortemSource,
  combinePostmortemAvailability,
  describePostmortemAvailability,
  POSTMORTEM_ACTIONS_TASK,
  POSTMORTEM_ROOT_CAUSE_TASK,
} from '../pure/postmortem.js';
import {
  checkSummarizerAvailability,
  checkWriterAvailability,
  summarizeTimeline,
  writeSection,
} from '../effect/postmortemAi.js';
import type {IndexedReplayEvent} from '../replay/replayMediaUtils.js';
import {ModelDownloadProgress} from './ModelDownloadProgress.js';

interface PostmortemSections {
  timeline?: string;
  rootCause?: string;
  actions?: string;
}

const api = createApiClient();

function canRun(availability: AssistAvailability | undefined): boolean {
  return (
    availability === 'available' ||
    availability === 'downloadable' ||
    availability === 'downloading'
  );
}

export function PostmortemPanel(props: {
  sessionId: string;
  scenarioTitle: string;
  result: string | null;
  durationMs: number;
  events: IndexedReplayEvent[];
}) {
  const [summarizerAvailability, setSummarizerAvailability] =
    useState<AssistAvailability>();
  const [writerAvailability, setWriterAvailability] =
    useState<AssistAvailability>();
  const [downloadProgress, setDownloadProgress] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string>();
  const [panelError, setPanelError] = useState<string>();
  const [sections, setSections] = useState<PostmortemSections>({});
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      checkSummarizerAvailability(),
      checkWriterAvailability(),
    ]).then(([summarizer, writer]) => {
      if (cancelled) return;
      setSummarizerAvailability(summarizer);
      setWriterAvailability(writer);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const markdown = useMemo(() => buildPostmortemMarkdown(sections), [sections]);

  if (
    summarizerAvailability === undefined ||
    writerAvailability === undefined
  ) {
    return null;
  }
  const availability = combinePostmortemAvailability(
    summarizerAvailability,
    writerAvailability
  );
  // 非対応ブラウザでもパネル自体は出し、機能の存在と対応環境を案内する
  const unavailable =
    availability === 'unsupported' || availability === 'unavailable';
  if (unavailable) {
    return (
      <section class='postmortem-panel' aria-label='AIポストモーテム'>
        <h2>
          AIポストモーテム <span class='ai-assist-badge'>on-device</span>
        </h2>
        <p class='ai-assist-status' role='status'>
          {describePostmortemAvailability(availability)}(Chrome の Summarizer /
          Writer API 対応環境で、イベントログとインシデントログから
          タイムライン要約・根本原因・改善アクションの草案を生成できます)
        </p>
        <div class='postmortem-actions'>
          <button type='button' disabled>
            ポストモーテム草案を生成
          </button>
        </div>
      </section>
    );
  }

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    setPanelError(undefined);
    setSections({});
    setDone(false);
    setCopied(false);
    const markDownloading = () => {
      setDownloadProgress((current) => current ?? 0);
    };
    try {
      // Degrade gracefully: without a session token the AAR fetch fails and
      // the postmortem is built from replay events only.
      const incidentLog = await api
        .getAfterActionReport(props.sessionId)
        .then(({report}) =>
          report.incidentLog.map((entry) => ({
            kind: entry.kind,
            body: entry.body,
            createdAt: entry.createdAt,
          }))
        )
        .catch(() => []);
      const source = buildPostmortemSource({
        scenarioTitle: props.scenarioTitle,
        result: props.result,
        durationMs: props.durationMs,
        events: props.events,
        incidentLog,
      });

      let timeline = '';
      if (canRun(summarizerAvailability)) {
        setStep('タイムラインを要約しています…');
        if (
          summarizerAvailability === 'downloadable' ||
          summarizerAvailability === 'downloading'
        ) {
          markDownloading();
        }
        timeline = await summarizeTimeline(source, {
          onChunk: (chunk) => {
            setSections((current) => ({
              ...current,
              timeline: (current.timeline ?? '') + chunk,
            }));
          },
          onDownloadProgress: setDownloadProgress,
        });
        setSummarizerAvailability('available');
        setDownloadProgress(undefined);
      }

      if (canRun(writerAvailability)) {
        const writerContext = timeline
          ? `${source}\n\n# タイムライン要約\n${timeline}`
          : source;
        setStep('根本原因を分析しています…');
        await writeSection(POSTMORTEM_ROOT_CAUSE_TASK, writerContext, {
          onChunk: (chunk) => {
            setSections((current) => ({
              ...current,
              rootCause: (current.rootCause ?? '') + chunk,
            }));
          },
          onDownloadProgress: setDownloadProgress,
        });
        setStep('改善アクションを作成しています…');
        await writeSection(POSTMORTEM_ACTIONS_TASK, writerContext, {
          onChunk: (chunk) => {
            setSections((current) => ({
              ...current,
              actions: (current.actions ?? '') + chunk,
            }));
          },
          onDownloadProgress: setDownloadProgress,
        });
        setWriterAvailability('available');
      }
      setDownloadProgress(undefined);
      setDone(true);
    } catch (error) {
      console.error(error);
      setPanelError(
        'ポストモーテム草案の生成に失敗しました。もう一度お試しください。'
      );
    } finally {
      setDownloadProgress(undefined);
      setStep(undefined);
      setBusy(false);
    }
  };

  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
    } catch {
      setPanelError('クリップボードへのコピーに失敗しました。');
    }
  };

  const statusLabel =
    downloadProgress !== undefined
      ? `${describePostmortemAvailability('downloading')} ${formatDownloadProgress(downloadProgress)}`
      : describePostmortemAvailability(availability);

  return (
    <section class='postmortem-panel' aria-label='AIポストモーテム'>
      <h2>
        AIポストモーテム <span class='ai-assist-badge'>on-device</span>
      </h2>
      <p class='ai-assist-status' role='status'>
        {busy && step ? step : statusLabel}
      </p>
      {downloadProgress !== undefined && availability !== 'available' && (
        <ModelDownloadProgress progress={downloadProgress} />
      )}
      {!busy && availability === 'downloadable' && (
        <p class='postmortem-hint'>
          生成ボタンを押すと、必要なAIモデルを端末内にダウンロードしてから草案を作成します。
        </p>
      )}
      <div class='postmortem-actions'>
        <button type='button' disabled={busy} onClick={() => void generate()}>
          {busy ? '生成中…' : 'ポストモーテム草案を生成'}
        </button>
        {done && markdown && (
          <button
            type='button'
            class='postmortem-copy'
            onClick={() => void copyMarkdown()}
          >
            {copied ? 'コピーしました' : 'Markdownをコピー'}
          </button>
        )}
      </div>
      {panelError && (
        <p class='ai-assist-error' role='alert'>
          {panelError}
        </p>
      )}
      {markdown && <pre class='postmortem-output'>{markdown}</pre>}
    </section>
  );
}
