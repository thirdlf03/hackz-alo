import { useEffect, useMemo, useRef, useState } from "preact/hooks";
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
  thumbnail_object_key?: string | null;
};

const api = new ApiClient();

export function ReplayPage({ replayId, timeline }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [meta, setMeta] = useState<ReplayMeta>();
  const [events, setEvents] = useState<IndexedReplayEvent[]>([]);
  const [comments, setComments] = useState<Array<{ id: string; at_ms: number; body: string }>>([]);
  const [tab, setTab] = useState<"timeline" | "commands" | "alerts" | "runbooks" | "comments">("timeline");
  const [currentTime, setCurrentTime] = useState(0);
  const [loadError, setLoadError] = useState<string>();
  const [videoSrc, setVideoSrc] = useState<string>();
  const [commentDraft, setCommentDraft] = useState("");
  const [shareWarning, setShareWarning] = useState(false);

  useEffect(() => {
    let partialUrl: string | undefined;
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
          return;
        }
        partialUrl = await api.assemblePartialReplayVideo(replayId);
        setVideoSrc(partialUrl);
      })
      .catch(() => setVideoSrc(undefined));

    return () => {
      if (partialUrl) URL.revokeObjectURL(partialUrl);
    };
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
            onTimeUpdate={(event: Event) => setCurrentTime((event.currentTarget as HTMLVideoElement).currentTime)}
          />
        ) : (
          <p class="result-replay-note">保存された録画はありません。タイムラインのみ表示しています。</p>
        )}
        {meta?.thumbnail_object_key && (
          <img
            class="replay-thumbnail"
            alt="シナリオ終了時のサムネイル"
            src={`/api/replays/${encodeURIComponent(replayId)}/thumbnail`}
          />
        )}
        <div class="replay-meta">
          <span>結果: {meta?.result ?? "-"}</span>
          <span>難易度: {meta?.difficulty ?? "-"}</span>
          <span>対応時間: {formatDuration(meta?.duration_ms ?? 0)}</span>
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
          <ol class="timeline">
            {visibleTimeline.map((event) => (
              <li key={`${event.at}-${event.label}`}>
                <button
                  type="button"
                  disabled={!videoSrc}
                  aria-current={videoSrc && Math.abs(currentTime - event.at) < 1 ? "time" : undefined}
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
        {tab === "comments" && (
          <section class="replay-comments">
            <ul class="replay-list">
              {comments.map((comment) => (
                <li key={comment.id}>
                  <button type="button" onClick={() => seekTo(comment.at_ms / 1000)}>
                    {formatSeconds(comment.at_ms / 1000)} {comment.body}
                  </button>
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

function tabLabel(tab: "timeline" | "commands" | "alerts" | "runbooks" | "comments") {
  if (tab === "timeline") return "タイムライン";
  if (tab === "commands") return "コマンド";
  if (tab === "alerts") return "アラート";
  if (tab === "comments") return "コメント";
  return "Runbook";
}
