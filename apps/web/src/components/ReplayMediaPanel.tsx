import { useMemo, useRef, useState } from "preact/hooks";
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

export function ReplayMediaPanel({ replayId, events, timeline = [], showVideo, title = "リプレイ" }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const visibleTimeline = useMemo(() => buildTimelineFromEvents(events, timeline), [events, timeline]);

  function seekTo(seconds: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, seconds);
  }

  return (
    <section class="result-replay-panel">
      <h2>{title}</h2>
      {showVideo ? (
        <video
          ref={videoRef}
          controls
          preload="metadata"
          class="result-replay-video"
          src={`/api/replays/${encodeURIComponent(replayId)}/video`}
          onTimeUpdate={(event: Event) => setCurrentTime((event.currentTarget as HTMLVideoElement).currentTime)}
        />
      ) : (
        <p class="result-replay-note">録画は保存されていません。イベントログのタイムラインのみ表示しています。</p>
      )}
      <ol class="timeline">
        {visibleTimeline.map((event) => (
          <li key={`${event.at}-${event.label}`}>
            <button
              type="button"
              disabled={!showVideo}
              aria-current={showVideo && Math.abs(currentTime - event.at) < 1 ? "time" : undefined}
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
