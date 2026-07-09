import {useEffect, useMemo, useState} from 'preact/hooks';
import {createApiClient} from '../api/client.js';
import {
  buildTimelineFromEvents,
  filterImportantEvents,
  formatDuration,
  type IndexedReplayEvent,
} from '../replay/replayMediaUtils.js';

interface Props {
  replayId: string;
  sessionId: string;
  scenarioTitle: string;
  onGoHome: () => void;
  onRetry: () => void;
  onOpenReplay: () => void;
  onOpenHotwash: () => void;
  canOpenReplay: boolean;
  isRetrying?: boolean;
}

interface ReplayMeta {
  result: string | null;
  duration_ms: number | null;
  video_duration_ms?: number | null;
  ending_id?: string | null;
}

type ResultTone = 'success' | 'warning' | 'danger' | 'neutral';

interface Highlight {
  id: string;
  atMs: number;
  label: string;
}

const api = createApiClient();
const highlightLimit = 3;

export function ResultPage({
  replayId,
  sessionId,
  scenarioTitle,
  onGoHome,
  onRetry,
  onOpenReplay,
  onOpenHotwash,
  canOpenReplay,
  isRetrying = false,
}: Props) {
  const [meta, setMeta] = useState<ReplayMeta>();
  const [events, setEvents] = useState<IndexedReplayEvent[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    Promise.all([api.getReplay(replayId), api.getReplayEvents(replayId)])
      .then(([replay, indexed]) => {
        setMeta(replay);
        setEvents(indexed);
      })
      .catch((loadError: unknown) => {
        setError(
          loadError instanceof Error ? loadError.message : 'load failed'
        );
      });
  }, [replayId]);

  const durationMs = meta?.video_duration_ms ?? meta?.duration_ms ?? 0;
  const durationLabel = formatDuration(durationMs);
  const isDismissed = meta?.result !== 'resolved';
  const resultLabel = isDismissed ? '解雇！' : '成功';
  const endingLabel = meta?.ending_id
    ? formatEnding(meta.ending_id)
    : undefined;
  const resultTone = resolveResultTone(meta?.result, meta?.ending_id);
  const flavorText = buildFlavorText(
    meta?.result,
    meta?.ending_id,
    durationLabel
  );
  const dismissalSubline = endingLabel ?? '処分確定';

  const stats = useMemo(
    () => ({
      alerts: events.filter((event) => event.type === 'alert').length,
      commands: events.filter((event) => event.type === 'command_detected')
        .length,
      runbooks: events.filter((event) => event.type === 'runbook_open').length,
    }),
    [events]
  );

  const highlights = useMemo(() => pickHighlights(events), [events]);

  return (
    <section
      class={`panel result-panel${isDismissed ? ' result-panel-dismissed' : ''}`}
      aria-labelledby='result-heading'
    >
      <p class={`eyebrow${isDismissed ? ' eyebrow-dismissed' : ''}`}>
        {isDismissed ? '解雇通知' : 'Mission Report'}
      </p>
      <h1 id='result-heading'>{scenarioTitle}</h1>
      {error && (
        <p class='app-error' role='alert'>
          {error}
        </p>
      )}

      <div class={`result-hero${isDismissed ? ' result-hero-dismissed' : ''}`}>
        {isDismissed ? (
          <>
            <p class='result-stamp' role='status'>
              {resultLabel}
            </p>
            <p class='result-dismissal-subline'>{dismissalSubline}</p>
            <p class='result-flavor result-flavor-dismissed'>{flavorText}</p>
            <p class='result-dismissal-notice'>
              人事部に録画を送付済み
              <span aria-hidden='true'> · </span>
              <span>{durationLabel}</span>
            </p>
          </>
        ) : (
          <>
            <p class={`result-badge result-badge-${resultTone}`}>
              {resultLabel}
            </p>
            <p class='result-hero-meta'>
              {endingLabel ? <span>{endingLabel}</span> : null}
              {endingLabel ? <span aria-hidden='true'> · </span> : null}
              <span>{durationLabel}</span>
            </p>
            <p class='result-flavor'>{flavorText}</p>
          </>
        )}

        <dl
          class={`result-stats${isDismissed ? ' result-stats-dismissed' : ''}`}
          aria-label={isDismissed ? '解雇理由の記録' : '対応サマリー'}
        >
          <div>
            <dt>アラート</dt>
            <dd>{stats.alerts}</dd>
          </div>
          <div>
            <dt>コマンド</dt>
            <dd>{stats.commands}</dd>
          </div>
          <div>
            <dt>Runbook</dt>
            <dd>{stats.runbooks}</dd>
          </div>
        </dl>
      </div>

      {highlights.length > 0 && (
        <section
          class='result-highlights'
          aria-labelledby='result-highlights-heading'
        >
          <h2 id='result-highlights-heading'>ハイライト</h2>
          <ol>
            {highlights.map((item) => (
              <li key={item.id}>
                <span class='result-highlight-time'>
                  {formatDuration(item.atMs)}
                </span>
                <span class='result-highlight-label'>{item.label}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <p class='result-session-meta'>
        <span class='result-label'>セッション</span>
        <span>{sessionId}</span>
      </p>

      <div class='result-actions'>
        <button
          type='button'
          class='result-action-secondary'
          onClick={onGoHome}
        >
          ホームに戻る
        </button>
        <button
          type='button'
          class='result-action-secondary'
          onClick={onRetry}
          disabled={isRetrying}
        >
          {isRetrying ? '開始中…' : '再挑戦'}
        </button>
        <button
          type='button'
          class='result-action-secondary'
          onClick={onOpenHotwash}
        >
          Hotwash
        </button>
        <button
          type='button'
          class='result-action-primary'
          onClick={onOpenReplay}
          disabled={!canOpenReplay}
        >
          Replay
        </button>
      </div>
    </section>
  );
}

function pickHighlights(events: IndexedReplayEvent[]): Highlight[] {
  const important = filterImportantEvents(events)
    .sort((a, b) => a.at_ms - b.at_ms)
    .map((event) => ({
      id: event.event_id,
      atMs: event.at_ms,
      label: event.summary?.trim() || event.type,
    }));

  if (important.length >= highlightLimit) {
    return important.slice(-highlightLimit);
  }

  const timeline = buildTimelineFromEvents(events)
    .filter(
      (entry) =>
        entry.label !== 'シナリオ開始' && entry.label !== 'セッション終了'
    )
    .map((entry) => ({
      id: entry.id,
      atMs: Math.round(entry.at * 1000),
      label: entry.label,
    }));

  const merged = [...important];
  for (const entry of timeline) {
    if (merged.length >= highlightLimit) break;
    if (merged.some((item) => item.id === entry.id)) continue;
    merged.push(entry);
  }
  return merged.slice(0, highlightLimit);
}

function resolveResultTone(
  result: string | null | undefined,
  endingId: string | null | undefined
): ResultTone {
  if (result === 'resolved' || endingId === 'clear-shift') return 'success';
  if (
    result === 'retired' ||
    result === 'failed' ||
    result === 'timeout' ||
    endingId === 'early-exit' ||
    endingId === 'false-resolve' ||
    endingId === 'overtime' ||
    endingId === 'aborted'
  ) {
    return 'danger';
  }
  return 'neutral';
}

function buildFlavorText(
  result: string | null | undefined,
  endingId: string | null | undefined,
  durationLabel: string
) {
  if (endingId === 'clear-shift' || result === 'resolved') {
    return `${durationLabel}で復旧完了。`;
  }
  if (endingId === 'early-exit' || result === 'retired') {
    return '途中で手を抜いた。再雇用の話はない。荷物をまとめて出て行け。';
  }
  if (endingId === 'false-resolve' || result === 'false_resolve') {
    return 'まだ障害が続いているのに復旧完了を押した。監視は嘘をつかない。会社の鍵は返せ。';
  }
  if (endingId === 'overtime' || result === 'timeout') {
    return '朝までに復旧できなかった。明日の朝は来ない。会社の鍵は返せ。';
  }
  if (endingId === 'aborted' || result === 'aborted') {
    return 'セッションが中断された。結果は解雇。言い訳は聞かない。';
  }
  return '記録は残っている。人事部が全部見た。';
}

function formatEnding(endingId: string) {
  switch (endingId) {
    case 'clear-shift':
      return '無事退勤';
    case 'overtime':
      return '朝まで復旧できず';
    case 'false-resolve':
      return '未復旧のまま宣言';
    case 'early-exit':
      return '途中で手を抜いた';
    case 'aborted':
      return '強制終了';
    default:
      return endingId;
  }
}
