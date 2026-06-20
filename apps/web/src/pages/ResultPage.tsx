import { useEffect, useMemo, useState } from "preact/hooks";
import { ApiClient } from "../api/client.js";
import {
  buildTimelineFromEvents,
  filterImportantEvents,
  formatDuration,
  type IndexedReplayEvent
} from "../replay/replayMediaUtils.js";

type Props = {
  replayId: string;
  sessionId: string;
  scenarioTitle: string;
  onRetry: () => void;
  onOpenReplay: () => void;
  canOpenReplay: boolean;
};

type ReplayMeta = {
  result: string | null;
  duration_ms: number | null;
  video_duration_ms?: number | null;
  ending_id?: string | null;
};

type ResultTone = "success" | "warning" | "danger" | "neutral";

type Highlight = {
  id: string;
  atMs: number;
  label: string;
};

const api = new ApiClient();
const highlightLimit = 3;

export function ResultPage({
  replayId,
  sessionId,
  scenarioTitle,
  onRetry,
  onOpenReplay,
  canOpenReplay
}: Props) {
  const [meta, setMeta] = useState<ReplayMeta>();
  const [events, setEvents] = useState<IndexedReplayEvent[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    Promise.all([api.getReplay(replayId), api.getReplayEvents(replayId)])
      .then(([replay, indexed]) => {
        setMeta(replay as ReplayMeta);
        setEvents(indexed);
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "load failed"));
  }, [replayId]);

  const durationMs = meta?.video_duration_ms ?? meta?.duration_ms ?? 0;
  const durationLabel = formatDuration(durationMs);
  const resultLabel = meta?.result === "resolved" ? "成功" : meta?.result === "retired" ? "リタイア" : "失敗";
  const endingLabel = meta?.ending_id ? formatEnding(meta.ending_id) : undefined;
  const resultTone = resolveResultTone(meta?.result, meta?.ending_id);
  const flavorText = buildFlavorText(meta?.result, meta?.ending_id, durationLabel);

  const stats = useMemo(() => ({
    alerts: events.filter((event) => event.type === "alert").length,
    commands: events.filter((event) => event.type === "command_detected").length,
    runbooks: events.filter((event) => event.type === "runbook_open").length
  }), [events]);

  const highlights = useMemo(() => pickHighlights(events), [events]);

  return (
    <section class="panel result-panel" aria-labelledby="result-heading">
      <p class="eyebrow">Mission Report</p>
      <h1 id="result-heading">{scenarioTitle}</h1>
      {error && <p class="app-error" role="alert">{error}</p>}

      <div class="result-hero">
        <p class={`result-badge result-badge-${resultTone}`}>{resultLabel}</p>
        <p class="result-hero-meta">
          {endingLabel ? <span>{endingLabel}</span> : null}
          {endingLabel ? <span aria-hidden="true"> · </span> : null}
          <span>{durationLabel}</span>
        </p>
        <p class="result-flavor">{flavorText}</p>

        <dl class="result-stats" aria-label="対応サマリー">
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
        <section class="result-highlights" aria-labelledby="result-highlights-heading">
          <h2 id="result-highlights-heading">ハイライト</h2>
          <ol>
            {highlights.map((item) => (
              <li key={item.id}>
                <span class="result-highlight-time">{formatDuration(item.atMs)}</span>
                <span class="result-highlight-label">{item.label}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <p class="result-session-meta">
        <span class="result-label">セッション</span>
        <span>{sessionId}</span>
      </p>

      <div class="result-actions">
        <button type="button" class="result-action-secondary" onClick={onRetry}>再挑戦</button>
        <button
          type="button"
          class="result-action-primary"
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
      label: event.summary?.trim() || event.type
    }));

  if (important.length >= highlightLimit) {
    return important.slice(-highlightLimit);
  }

  const timeline = buildTimelineFromEvents(events)
    .filter((entry) => entry.label !== "シナリオ開始" && entry.label !== "セッション終了")
    .map((entry) => ({
      id: entry.id,
      atMs: Math.round(entry.at * 1000),
      label: entry.label
    }));

  const merged = [...important];
  for (const entry of timeline) {
    if (merged.length >= highlightLimit) break;
    if (merged.some((item) => item.id === entry.id)) continue;
    merged.push(entry);
  }
  return merged.slice(0, highlightLimit);
}

function resolveResultTone(result: string | null | undefined, endingId: string | null | undefined): ResultTone {
  if (result === "resolved" || endingId === "clear-shift") return "success";
  if (result === "retired" || endingId === "early-exit") return "warning";
  if (result === "failed" || endingId === "overtime" || endingId === "aborted") return "danger";
  return "neutral";
}

function buildFlavorText(
  result: string | null | undefined,
  endingId: string | null | undefined,
  durationLabel: string
) {
  if (endingId === "clear-shift" || result === "resolved") {
    return `${durationLabel}で対応完了。お疲れ様でした。`;
  }
  if (endingId === "overtime" || result === "failed" || result === "timeout") {
    return "対応は終わらなかった。明日また戦う。";
  }
  if (endingId === "early-exit" || result === "retired") {
    return "途中で切り上げた。また挑戦できる。";
  }
  if (endingId === "aborted" || result === "aborted") {
    return "セッションが中断された。";
  }
  return "記録を残した。Replay で振り返れる。";
}

function formatEnding(endingId: string) {
  switch (endingId) {
    case "clear-shift":
      return "無事退勤";
    case "overtime":
      return "残業確定";
    case "early-exit":
      return "途中撤退";
    case "aborted":
      return "強制終了";
    default:
      return endingId;
  }
}
