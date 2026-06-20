import { useEffect, useMemo, useState } from "preact/hooks";
import type { ReplayVisibility } from "@incident/shared";
import { ApiClient } from "../api/client.js";
import { ReplayMediaPanel } from "../components/ReplayMediaPanel.js";
import {
  buildTimelineFromEvents,
  filterImportantEvents,
  formatDuration,
  type IndexedReplayEvent,
  type TimelineEntry
} from "../replay/replayMediaUtils.js";

type Props = {
  replayId: string;
  sessionId: string;
  scenarioTitle: string;
  timeline: TimelineEntry[];
  canPlayVideo: boolean;
  onRetry: () => void;
  onOpenReplay: () => void;
  canOpenReplay: boolean;
};

type ReplayMeta = {
  id: string;
  scenario_id: string;
  difficulty: string;
  result: string | null;
  duration_ms: number | null;
  visibility: ReplayVisibility;
};

const api = new ApiClient();

export function ResultPage({
  replayId,
  sessionId,
  scenarioTitle,
  timeline,
  canPlayVideo,
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

  const commands = useMemo(
    () => events.filter((event) => event.type === "command_detected"),
    [events]
  );
  const alerts = useMemo(() => events.filter((event) => event.type === "alert"), [events]);
  const runbooks = useMemo(() => events.filter((event) => event.type === "runbook_open"), [events]);
  const importantEvents = useMemo(() => filterImportantEvents(events), [events]);
  const visibleTimeline = useMemo(() => buildTimelineFromEvents(events, timeline), [events, timeline]);

  const resultLabel = meta?.result === "resolved" ? "成功" : meta?.result === "retired" ? "リタイア" : "失敗";

  return (
    <section class="panel result-panel">
      <p class="eyebrow">Mission Report</p>
      <h1>{scenarioTitle}</h1>
      {error && <p class="app-error" role="alert">{error}</p>}
      <div class="result-grid">
        <div>
          <span class="result-label">結果</span>
          <strong>{resultLabel}</strong>
        </div>
        <div>
          <span class="result-label">対応時間</span>
          <strong>{formatDuration(meta?.duration_ms ?? 0)}</strong>
        </div>
        <div>
          <span class="result-label">セッション</span>
          <strong>{sessionId}</strong>
        </div>
      </div>

      <ReplayMediaPanel
        replayId={replayId}
        events={events}
        timeline={timeline}
        showVideo={canPlayVideo}
        title="リプレイ動画とタイムライン"
      />

      <div class="result-columns">
        <section>
          <h2>アラート</h2>
          <ul>{alerts.map((event) => <li key={event.event_id}>{event.summary ?? event.type}</li>)}</ul>
        </section>
        <section>
          <h2>実行コマンド</h2>
          <ul>{commands.map((event) => <li key={event.event_id}>{event.summary ?? event.type}</li>)}</ul>
        </section>
        <section>
          <h2>開いた Runbook</h2>
          <ul>{runbooks.map((event) => <li key={event.event_id}>{event.summary ?? event.type}</li>)}</ul>
        </section>
      </div>

      <section class="result-important-events">
        <h2>重要イベント</h2>
        <ul>
          {importantEvents.length > 0
            ? importantEvents.map((event) => (
              <li key={event.event_id}>{formatDuration(event.at_ms)} {event.summary ?? event.type}</li>
            ))
            : visibleTimeline.map((event) => (
              <li key={`${event.at}-${event.label}`}>{formatDuration(event.at * 1000)} {event.label}</li>
            ))}
        </ul>
      </section>

      <div class="result-actions">
        <button type="button" onClick={onRetry}>再挑戦</button>
        <button type="button" onClick={onOpenReplay} disabled={!canOpenReplay}>Replay 詳細を見る</button>
      </div>
    </section>
  );
}
