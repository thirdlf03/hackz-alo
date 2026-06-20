import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ApiClient } from "../api/client.js";
import {
  buildTimelineFromEvents,
  formatSeconds,
  type IndexedReplayEvent,
  type TimelineEntry
} from "../replay/replayMediaUtils.js";

type Props = {
  replayId: string;
  events: IndexedReplayEvent[];
  timeline?: TimelineEntry[];
  showVideo: boolean;
  title?: string;
};

const api = new ApiClient();

export function ReplayMediaPanel({ replayId, events, timeline = [], showVideo, title = "リプレイ" }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoSrc, setVideoSrc] = useState<string>();
  const visibleTimeline = useMemo(() => buildTimelineFromEvents(events, timeline), [events, timeline]);

  useEffect(() => {
    if (!showVideo) {
      setVideoSrc(undefined);
      return;
    }

    let partialUrl: string | undefined;
    let cancelled = false;

    fetch(`/api/replays/${encodeURIComponent(replayId)}/video`, { method: "HEAD" })
      .then(async (response) => {
        if (cancelled) return;
        if (response.ok) {
          setVideoSrc(`/api/replays/${encodeURIComponent(replayId)}/video`);
          return;
        }
        partialUrl = await api.assemblePartialReplayVideo(replayId);
        if (!cancelled) setVideoSrc(partialUrl);
      })
      .catch(() => {
        if (!cancelled) setVideoSrc(undefined);
      });

    return () => {
      cancelled = true;
      if (partialUrl) URL.revokeObjectURL(partialUrl);
    };
  }, [replayId, showVideo]);

  function seekTo(seconds: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, seconds);
  }

  const canSeek = Boolean(videoSrc);

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
          onTimeUpdate={(event: Event) => setCurrentTime((event.currentTarget as HTMLVideoElement).currentTime)}
        />
      ) : showVideo ? (
        <p class="result-replay-note">動画を読み込み中です…</p>
      ) : (
        <p class="result-replay-note">録画は保存されていません。イベントログのタイムラインのみ表示しています。</p>
      )}
      <ol class="timeline">
        {visibleTimeline.map((event) => (
          <li key={`${event.at}-${event.label}`}>
            <button
              type="button"
              disabled={!canSeek}
              aria-current={canSeek && Math.abs(currentTime - event.at) < 1 ? "time" : undefined}
              onClick={() => seekTo(event.at)}
            >
              {formatSeconds(event.at)} {event.label}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
