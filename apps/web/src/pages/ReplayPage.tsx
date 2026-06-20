import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ReplayVisibility } from "@incident/shared";
import { ApiClient } from "../api/client.js";
import {
  buildTimelineFromEvents,
  formatDuration,
  formatSeconds,
  type IndexedReplayEvent,
  type TimelineEntry
} from "../replay/replayMediaUtils.js";

type Props = {
  replayId: string;
  timeline: TimelineEntry[];
};

type ReplayMeta = {
  scenario_id: string;
  difficulty: string;
  result: string | null;
  duration_ms: number | null;
  visibility: ReplayVisibility;
};

const api = new ApiClient();
const visibilityOptions: ReplayVisibility[] = ["private", "unlisted", "team", "public"];

export function ReplayPage({ replayId, timeline }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [meta, setMeta] = useState<ReplayMeta>();
  const [events, setEvents] = useState<IndexedReplayEvent[]>([]);
  const [tab, setTab] = useState<"timeline" | "commands" | "alerts" | "runbooks">("timeline");
  const [visibility, setVisibility] = useState<ReplayVisibility>("private");
  const [currentTime, setCurrentTime] = useState(0);
  const [loadError, setLoadError] = useState<string>();
  const [visibilityWarning, setVisibilityWarning] = useState(false);
  const [hasVideo, setHasVideo] = useState(true);

  useEffect(() => {
    Promise.all([api.getReplay(replayId), api.getReplayEvents(replayId)])
      .then(([replay, indexed]) => {
        setMeta(replay as ReplayMeta);
        setVisibility((replay as ReplayMeta).visibility ?? "private");
        setEvents(indexed);
      })
      .catch((error) => setLoadError(error instanceof Error ? error.message : "failed to load"));
    fetch(`/api/replays/${encodeURIComponent(replayId)}/video`, { method: "HEAD" })
      .then((response) => setHasVideo(response.ok))
      .catch(() => setHasVideo(false));
  }, [replayId]);

  const visibleTimeline = useMemo(() => buildTimelineFromEvents(events, timeline), [events, timeline]);

  const commands = events.filter((event) => event.type === "command_detected");
  const alerts = events.filter((event) => event.type === "alert");
  const runbooks = events.filter((event) => event.type === "runbook_open");

  function seekTo(seconds: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, seconds);
  }

  async function saveVisibility(next: ReplayVisibility) {
    if (next !== "private" && next !== "self" && !visibilityWarning) {
      setVisibilityWarning(true);
      return;
    }
    await api.updateReplayVisibility(replayId, next);
    setVisibility(next);
  }

  return (
    <section class="replay-layout expanded">
      <div class="replay-main">
        {hasVideo ? (
          <video
            ref={videoRef}
            controls
            preload="metadata"
            src={`/api/replays/${encodeURIComponent(replayId)}/video`}
            onTimeUpdate={(event: Event) => setCurrentTime((event.currentTarget as HTMLVideoElement).currentTime)}
          />
        ) : (
          <p class="result-replay-note">保存された録画はありません。タイムラインのみ表示しています。</p>
        )}
        <div class="replay-meta">
          <span>結果: {meta?.result ?? "-"}</span>
          <span>難易度: {meta?.difficulty ?? "-"}</span>
          <span>対応時間: {formatDuration(meta?.duration_ms ?? 0)}</span>
        </div>
      </div>
      <aside class="replay-side">
        <div class="replay-tabs">
          {(["timeline", "commands", "alerts", "runbooks"] as const).map((item) => (
            <button key={item} type="button" class={tab === item ? "active" : ""} onClick={() => setTab(item)}>
              {tabLabel(item)}
            </button>
          ))}
        </div>
        {tab === "timeline" && (
          <ol class="timeline">
            {visibleTimeline.map((event) => (
              <li key={`${event.at}-${event.label}`}>
                <button
                  type="button"
                  disabled={!hasVideo}
                  aria-current={hasVideo && Math.abs(currentTime - event.at) < 1 ? "time" : undefined}
                  onClick={() => seekTo(event.at)}
                >
                  {formatSeconds(event.at)} {event.label}
                </button>
              </li>
            ))}
          </ol>
        )}
        {tab === "commands" && <ul class="replay-list">{commands.map((event) => <li key={event.event_id}>{event.summary}</li>)}</ul>}
        {tab === "alerts" && <ul class="replay-list">{alerts.map((event) => <li key={event.event_id}>{event.summary}</li>)}</ul>}
        {tab === "runbooks" && <ul class="replay-list">{runbooks.map((event) => <li key={event.event_id}>{event.summary}</li>)}</ul>}
        {loadError && <p class="app-error">{loadError}</p>}
        <section class="visibility-panel">
          <h2>公開範囲</h2>
          {visibilityWarning && (
            <p class="visibility-warning">ターミナル入力や Slack の内容が含まれる可能性があります。公開前にプレビューしてください。</p>
          )}
          <select value={visibility} onChange={(event) => void saveVisibility((event.currentTarget as HTMLSelectElement).value as ReplayVisibility)}>
            {visibilityOptions.map((option) => <option value={option} key={option}>{option}</option>)}
          </select>
        </section>
      </aside>
    </section>
  );
}

function tabLabel(tab: "timeline" | "commands" | "alerts" | "runbooks") {
  if (tab === "timeline") return "タイムライン";
  if (tab === "commands") return "コマンド";
  if (tab === "alerts") return "アラート";
  return "Runbook";
}
