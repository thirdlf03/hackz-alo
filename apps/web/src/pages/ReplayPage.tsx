import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ApiResult } from "@incident/shared";

type Props = {
  replayId: string;
  timeline: Array<{ at: number; label: string }>;
};

type IndexedReplayEvent = {
  event_id: string;
  type: string;
  at_ms: number;
  summary?: string | null;
  visibility: string;
};

type TimelineItem = {
  at: number;
  label: string;
};

export function ReplayPage({ replayId, timeline }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [indexedTimeline, setIndexedTimeline] = useState<TimelineItem[]>();
  const [currentTime, setCurrentTime] = useState(0);
  const [loadError, setLoadError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    setIndexedTimeline(undefined);
    setLoadError(undefined);

    fetch(`/api/replays/${encodeURIComponent(replayId)}/events`, { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as ApiResult<IndexedReplayEvent[]>;
        if (!payload.ok) throw new Error(payload.error.message);
        return payload.data;
      })
      .then((events) => setIndexedTimeline(eventsToTimeline(events)))
      .catch((error) => {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "failed to load events");
      });

    return () => controller.abort();
  }, [replayId]);

  const visibleTimeline: TimelineItem[] = useMemo(() => {
    const source = indexedTimeline && indexedTimeline.length > 0 ? indexedTimeline : timeline;
    return [...source].sort((a, b) => a.at - b.at);
  }, [indexedTimeline, timeline]);

  function seekTo(seconds: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, seconds);
  }

  return (
    <section class="replay-layout">
      <video
        ref={videoRef}
        controls
        preload="metadata"
        src={`/api/replays/${encodeURIComponent(replayId)}/video`}
        onTimeUpdate={(event: Event) => setCurrentTime((event.currentTarget as HTMLVideoElement).currentTime)}
      />
      <ol class="timeline">
        {visibleTimeline.map((event) => (
          <li key={`${event.at}-${event.label}`}>
            <button
              type="button"
              aria-current={Math.abs(currentTime - event.at) < 1 ? "time" : undefined}
              onClick={() => seekTo(event.at)}
            >
              {formatSeconds(event.at)} {event.label}
            </button>
          </li>
        ))}
        {visibleTimeline.length === 0 && <li>イベントはまだありません</li>}
        {loadError && <li>イベントの読み込みに失敗しました: {loadError}</li>}
      </ol>
    </section>
  );
}

function eventsToTimeline(events: IndexedReplayEvent[]): TimelineItem[] {
  return events
    .filter((event) => event.type !== "recording_chunk_created")
    .map((event) => ({
      at: Math.max(0, event.at_ms / 1000),
      label: event.summary || event.type.replaceAll("_", " ")
    }));
}

function formatSeconds(seconds: number) {
  const min = Math.floor(seconds / 60).toString().padStart(2, "0");
  const sec = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${min}:${sec}`;
}
