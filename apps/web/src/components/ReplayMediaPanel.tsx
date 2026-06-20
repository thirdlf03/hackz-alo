import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ApiClient } from "../api/client.js";
import {
  buildTimelineFromEvents,
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
  events: IndexedReplayEvent[];
  timeline?: TimelineEntry[];
  showVideo: boolean;
  durationMs?: number | null | undefined;
  videoDurationMs?: number | null | undefined;
  browserInfoJson?: string | null | undefined;
  title?: string;
  onVideoDurationChange?: (durationMs: number | null | undefined) => void;
};

type VideoLoadState = "loading" | "ready" | "unavailable";

const api = new ApiClient();
const timelineSeekPrerollSeconds = 1;

export function ReplayMediaPanel({
  replayId,
  events,
  timeline = [],
  showVideo,
  durationMs,
  videoDurationMs,
  browserInfoJson,
  title = "リプレイ",
  onVideoDurationChange
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [activeTimelineId, setActiveTimelineId] = useState<string>();
  const [videoSrc, setVideoSrc] = useState<string>();
  const [videoLoadState, setVideoLoadState] = useState<VideoLoadState>(showVideo ? "loading" : "unavailable");
  const [videoDuration, setVideoDuration] = useState(0);
  const visibleTimeline = useMemo(() => buildTimelineFromEvents(events, timeline), [events, timeline]);
  const browserInfo = useMemo(() => parseBrowserInfo(browserInfoJson), [browserInfoJson]);
  const persistedVideoDuration = (videoDurationMs ?? 0) / 1000;
  const effectiveVideoDuration = videoDuration > 0 ? videoDuration : persistedVideoDuration;
  const recordingStartMs = useMemo(
    () => parseRecordingStartedAtGameMs(browserInfo, durationMs ?? 0, effectiveVideoDuration),
    [browserInfo, durationMs, effectiveVideoDuration]
  );

  useEffect(() => {
    if (!showVideo) {
      setVideoSrc(undefined);
      setVideoLoadState("unavailable");
      setVideoDuration(0);
      onVideoDurationChange?.(null);
      return;
    }

    let partialUrl: string | undefined;
    let cancelled = false;
    setVideoSrc(undefined);
    setVideoLoadState("loading");
    setVideoDuration(0);
    onVideoDurationChange?.(undefined);

    fetch(`/api/replays/${encodeURIComponent(replayId)}/video`, { method: "HEAD" })
      .then(async (response) => {
        if (cancelled) return;
        if (response.ok) {
          setVideoSrc(`/api/replays/${encodeURIComponent(replayId)}/video`);
          setVideoLoadState("ready");
          return;
        }
        partialUrl = await api.assemblePartialReplayVideo(replayId);
        if (!cancelled) {
          setVideoSrc(partialUrl);
          setVideoLoadState("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setVideoSrc(undefined);
          setVideoLoadState("unavailable");
          onVideoDurationChange?.(null);
        }
      });

    return () => {
      cancelled = true;
      if (partialUrl) URL.revokeObjectURL(partialUrl);
    };
  }, [replayId, showVideo, onVideoDurationChange]);

  function seekGameTime(gameSeconds: number, timelineId?: string) {
    const video = videoRef.current;
    if (!video) return;
    const mapped = gameTimeToVideoSeekSeconds(
      gameSeconds,
      effectiveVideoDuration,
      durationMs ?? 0,
      recordingStartMs
    );
    seekVideoSeconds(mapped - timelineSeekPrerollSeconds, timelineId);
  }

  function rememberVideoDuration(video: HTMLVideoElement) {
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    setVideoDuration((current) => {
      if (Math.abs(current - duration) < 0.001) return current;
      onVideoDurationChange?.(Math.round(duration * 1000));
      return duration;
    });
  }

  function seekVideoSeconds(seconds: number, timelineId?: string) {
    const video = videoRef.current;
    if (!video) return;
    const target = clampSeekTime(video, seconds);
    video.currentTime = target;
    setActiveTimelineId(timelineId);
    void video.play().catch(() => {});
  }

  const hasReplayVideo = videoLoadState === "ready" && Boolean(videoSrc);
  const canSeek = hasReplayVideo && effectiveVideoDuration > 0;
  const isVideoTimingReady = videoLoadState === "unavailable" || effectiveVideoDuration > 0;

  return (
    <section class="result-replay-panel">
      <h2>{title}</h2>
      {showVideo && videoSrc ? (
        <video
          ref={videoRef}
          controls
          preload="metadata"
          class="result-replay-video"
          src={videoSrc}
          onLoadedMetadata={(event: Event) => {
            const video = event.currentTarget as HTMLVideoElement;
            rememberVideoDuration(video);
          }}
          onDurationChange={(event: Event) => rememberVideoDuration(event.currentTarget as HTMLVideoElement)}
          onTimeUpdate={(event: Event) => rememberVideoDuration(event.currentTarget as HTMLVideoElement)}
        />
      ) : videoLoadState === "loading" ? (
        <p class="result-replay-note">動画を読み込み中です…</p>
      ) : (
        <p class="result-replay-note">録画は保存されていません。イベントログのタイムラインのみ表示しています。</p>
      )}
      {isVideoTimingReady ? (
        <ol class="timeline">
          {visibleTimeline.map((event) => (
            <li key={event.id}>
              {canSeek ? (
                <button
                  type="button"
                  aria-current={activeTimelineId === event.id ? "time" : undefined}
                  onClick={() => seekGameTime(event.at, event.id)}
                >
                  {formatSeconds(timelineDisplaySeconds(event.at, true, effectiveVideoDuration, durationMs ?? 0, recordingStartMs))} {event.label}
                </button>
              ) : (
                <span>{formatSeconds(timelineDisplaySeconds(event.at, effectiveVideoDuration > 0, effectiveVideoDuration, durationMs ?? 0, recordingStartMs))} {event.label}</span>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p class="result-replay-note">タイムラインの時間を計算中です…</p>
      )}
    </section>
  );
}

function clampSeekTime(video: HTMLVideoElement, seconds: number) {
  const lower = Math.max(0, seconds);
  return Number.isFinite(video.duration) && video.duration > 0
    ? Math.min(lower, Math.max(0, video.duration - 0.05))
    : lower;
}
