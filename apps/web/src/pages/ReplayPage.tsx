import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ApiClient } from "../api/client.js";
import {
  buildTimelineFromEvents,
  formatDuration,
  formatSeconds,
  gameTimeToVideoSeekSeconds,
  parseBrowserInfo,
  parseRecordingStartedAtGameMs,
  timelineDisplaySeconds,
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
  video_duration_ms?: number | null;
  browser_info_json?: string | null;
};

type VideoLoadState = "loading" | "ready" | "unavailable";

const api = new ApiClient();
const timelineSeekPrerollSeconds = 1;

export function ReplayPage({ replayId, timeline }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [meta, setMeta] = useState<ReplayMeta>();
  const [events, setEvents] = useState<IndexedReplayEvent[]>([]);
  const [comments, setComments] = useState<Array<{ id: string; at_ms: number; body: string }>>([]);
  const [tab, setTab] = useState<"timeline" | "commands" | "alerts" | "runbooks" | "comments">("timeline");
  const [currentTime, setCurrentTime] = useState(0);
  const [activeTimelineId, setActiveTimelineId] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  const [videoSrc, setVideoSrc] = useState<string>();
  const [videoLoadState, setVideoLoadState] = useState<VideoLoadState>("loading");
  const [videoDuration, setVideoDuration] = useState(0);
  const [commentDraft, setCommentDraft] = useState("");
  const [shareWarning, setShareWarning] = useState(false);

  const browserInfo = useMemo(() => parseBrowserInfo(meta?.browser_info_json), [meta?.browser_info_json]);
  const persistedVideoDuration = (meta?.video_duration_ms ?? 0) / 1000;
  const effectiveVideoDuration = videoDuration > 0 ? videoDuration : persistedVideoDuration;
  const recordingStartMs = useMemo(
    () => parseRecordingStartedAtGameMs(browserInfo, meta?.duration_ms ?? 0, effectiveVideoDuration),
    [browserInfo, meta?.duration_ms, effectiveVideoDuration]
  );

  useEffect(() => {
    let partialUrl: string | undefined;
    setVideoSrc(undefined);
    setVideoLoadState("loading");
    setVideoDuration(0);
    setCurrentTime(0);
    Promise.all([api.getReplay(replayId), api.getReplayEvents(replayId), api.getReplayComments(replayId)])
      .then(([replay, indexed, loadedComments]) => {
        setMeta(replay as ReplayMeta);
        setEvents(indexed);
        setComments(loadedComments);
      })
      .catch((error) => setLoadError(error instanceof Error ? error.message : "failed to load"));

    fetch(`/api/replays/${encodeURIComponent(replayId)}/video`, { method: "HEAD" })
      .then(async (response) => {
        if (response.ok) {
          setVideoSrc(`/api/replays/${encodeURIComponent(replayId)}/video`);
          setVideoLoadState("ready");
          return;
        }
        partialUrl = await api.assemblePartialReplayVideo(replayId);
        setVideoSrc(partialUrl);
        setVideoLoadState("ready");
      })
      .catch(() => {
        setVideoSrc(undefined);
        setVideoLoadState("unavailable");
      });

    return () => {
      if (partialUrl) URL.revokeObjectURL(partialUrl);
    };
  }, [replayId]);

  const visibleTimeline = useMemo(() => buildTimelineFromEvents(events, timeline), [events, timeline]);
  const commands = events.filter((event) => event.type === "command_detected");
  const alerts = events.filter((event) => event.type === "alert");
  const runbooks = events.filter((event) => event.type === "runbook_open");
  const hasReplayVideo = videoLoadState === "ready" && Boolean(videoSrc);
  const isVideoTimingReady = videoLoadState === "unavailable" || effectiveVideoDuration > 0;
  const displayDurationMs = effectiveVideoDuration > 0
    ? Math.round(effectiveVideoDuration * 1000)
    : meta?.duration_ms ?? 0;
  const durationLabel = (videoLoadState === "loading" || hasReplayVideo) && !isVideoTimingReady
    ? "計算中…"
    : formatDuration(displayDurationMs);

  function seekGameTime(gameSeconds: number, timelineId?: string) {
    const video = videoRef.current;
    if (!video) return;
    const mapped = gameTimeToVideoSeekSeconds(
      gameSeconds,
      effectiveVideoDuration,
      meta?.duration_ms ?? 0,
      recordingStartMs
    );
    seekVideoSeconds(mapped - timelineSeekPrerollSeconds, timelineId);
  }

  function seekVideoSeconds(seconds: number, timelineId?: string) {
    const video = videoRef.current;
    if (!video) return;
    const target = clampSeekTime(video, seconds);
    video.currentTime = target;
    setCurrentTime(target);
    setActiveTimelineId(timelineId);
    void video.play().catch(() => {});
  }

  function rememberVideoDuration(video: HTMLVideoElement) {
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    setVideoDuration((current) => Math.abs(current - duration) < 0.001 ? current : duration);
  }

  async function submitComment() {
    const body = commentDraft.trim();
    if (!body) return;
    const created = await api.addReplayComment(replayId, Math.round(currentTime * 1000), body);
    setComments((items) => [...items, created]);
    setCommentDraft("");
  }

  function copyShareLink() {
    if (!shareWarning) {
      setShareWarning(true);
      return;
    }
    const url = `${window.location.origin}/?replay=${encodeURIComponent(replayId)}`;
    void navigator.clipboard.writeText(url);
  }

  return (
    <section class="replay-layout expanded">
      <div class="replay-main">
        {videoSrc ? (
          <video
            ref={videoRef}
            controls
            preload="metadata"
            src={videoSrc}
            onLoadedMetadata={(event: Event) => {
              const video = event.currentTarget as HTMLVideoElement;
              rememberVideoDuration(video);
            }}
            onDurationChange={(event: Event) => rememberVideoDuration(event.currentTarget as HTMLVideoElement)}
            onTimeUpdate={(event: Event) => {
              const video = event.currentTarget as HTMLVideoElement;
              rememberVideoDuration(video);
              setCurrentTime(video.currentTime);
            }}
          />
        ) : videoLoadState === "loading" ? (
          <p class="result-replay-note">動画の時間を計算中です…</p>
        ) : (
          <p class="result-replay-note">保存された録画はありません。タイムラインのみ表示しています。</p>
        )}
        <div class="replay-meta">
          <span>結果: {meta?.result ?? "-"}</span>
          <span>難易度: {meta?.difficulty ?? "-"}</span>
          <span>対応時間: {durationLabel}</span>
        </div>
        <button type="button" onClick={copyShareLink}>共有リンクをコピー</button>
        {shareWarning && (
          <p class="visibility-warning">ターミナル入力や Slack の内容が含まれる可能性があります。共有前に内容を確認してください。</p>
        )}
      </div>
      <aside class="replay-side">
        <div class="replay-tabs">
          {(["timeline", "commands", "alerts", "runbooks", "comments"] as const).map((item) => (
            <button key={item} type="button" class={tab === item ? "active" : ""} onClick={() => setTab(item)}>
              {tabLabel(item)}
            </button>
          ))}
        </div>
        {tab === "timeline" && (
          isVideoTimingReady ? (
            <ol class="timeline">
              {visibleTimeline.map((event) => (
                <li key={event.id}>
                  {videoSrc ? (
                    <button
                      type="button"
                      aria-current={activeTimelineId === event.id ? "time" : undefined}
                      onClick={() => seekGameTime(event.at, event.id)}
                    >
                      {formatSeconds(timelineDisplaySeconds(event.at, true, effectiveVideoDuration, meta?.duration_ms ?? 0, recordingStartMs))} {event.label}
                    </button>
                  ) : (
                    <span>{formatSeconds(timelineDisplaySeconds(event.at, effectiveVideoDuration > 0, effectiveVideoDuration, meta?.duration_ms ?? 0, recordingStartMs))} {event.label}</span>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p class="result-replay-note">タイムラインの時間を計算中です…</p>
          )
        )}
        {tab === "commands" && <ul class="replay-list">{commands.map((event) => <li key={event.event_id}>{event.summary}</li>)}</ul>}
        {tab === "alerts" && <ul class="replay-list">{alerts.map((event) => <li key={event.event_id}>{event.summary}</li>)}</ul>}
        {tab === "runbooks" && <ul class="replay-list">{runbooks.map((event) => <li key={event.event_id}>{event.summary}</li>)}</ul>}
        {tab === "comments" && (
          <section class="replay-comments">
            <ul class="replay-list">
              {comments.map((comment) => (
                <li key={comment.id}>
                  {videoSrc ? (
                    <button type="button" onClick={() => seekVideoSeconds(comment.at_ms / 1000)}>
                      {formatSeconds(comment.at_ms / 1000)} {comment.body}
                    </button>
                  ) : (
                    <span>{formatSeconds(comment.at_ms / 1000)} {comment.body}</span>
                  )}
                </li>
              ))}
            </ul>
            <textarea value={commentDraft} onInput={(event) => setCommentDraft((event.currentTarget as HTMLTextAreaElement).value)} rows={3} placeholder="この時刻へのコメント" />
            <button type="button" onClick={() => void submitComment()}>コメント追加</button>
          </section>
        )}
        {loadError && <p class="app-error">{loadError}</p>}
      </aside>
    </section>
  );
}

function clampSeekTime(video: HTMLVideoElement, seconds: number) {
  const lower = Math.max(0, seconds);
  return Number.isFinite(video.duration) && video.duration > 0
    ? Math.min(lower, Math.max(0, video.duration - 0.05))
    : lower;
}

function tabLabel(tab: "timeline" | "commands" | "alerts" | "runbooks" | "comments") {
  if (tab === "timeline") return "タイムライン";
  if (tab === "commands") return "コマンド";
  if (tab === "alerts") return "アラート";
  if (tab === "comments") return "コメント";
  return "Runbook";
}
