import {useEffect, useMemo, useRef, useState} from 'preact/hooks';
import {createApiClient} from '../api/client.js';
import {
  ReplayFilmstrip,
  ReplayHighlightReel,
} from '../app/ReplayHighlights.js';
import {
  isWebCodecsSupported,
  ReplayFrameExtractor,
} from '../effect/webcodecsReplay.js';
import {
  demuxWebm,
  pickHighlightWindows,
  type DemuxedWebm,
} from '../pure/webmDemux.js';
import {
  buildTimelineFromEvents,
  formatDuration,
  formatSeconds,
  parseBrowserInfo,
  parseRecordingClockSegments,
  parseRecordingStartedAtGameMs,
  timelineDisplaySeconds,
  type IndexedReplayEvent,
  type TimelineEntry,
} from '../replay/replayMediaUtils.js';
import {shouldPollForReplayVideo} from '../game/recording/finalizationPolicy.js';

interface Props {
  replayId: string;
  timeline: TimelineEntry[];
}

interface ReplayMeta {
  scenario_id: string;
  difficulty: string;
  result: string | null;
  duration_ms: number | null;
  video_duration_ms?: number | null;
  browser_info_json?: string | null;
  recording_status?: string;
}

type VideoLoadState = 'loading' | 'ready' | 'unavailable';

const api = createApiClient();
const timelineSeekPrerollSeconds = 1;

export function ReplayPage({replayId, timeline}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const seekRequestRef = useRef(0);
  const [meta, setMeta] = useState<ReplayMeta>();
  const [events, setEvents] = useState<IndexedReplayEvent[]>([]);
  const [comments, setComments] = useState<
    Array<{id: string; at_ms: number; body: string}>
  >([]);
  const [tab, setTab] = useState<
    'timeline' | 'commands' | 'alerts' | 'runbooks' | 'comments'
  >('timeline');
  const [currentTime, setCurrentTime] = useState(0);
  const [activeTimelineId, setActiveTimelineId] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  const [videoSrc, setVideoSrc] = useState<string>();
  const [videoLoadState, setVideoLoadState] =
    useState<VideoLoadState>('loading');
  const [videoDuration, setVideoDuration] = useState(0);
  const [commentDraft, setCommentDraft] = useState('');
  const [shareWarning, setShareWarning] = useState(false);
  const [shareStatus, setShareStatus] = useState<string>();
  const [demuxed, setDemuxed] = useState<DemuxedWebm>();
  const [frameExtractor, setFrameExtractor] = useState<ReplayFrameExtractor>();

  const browserInfo = useMemo(
    () => parseBrowserInfo(meta?.browser_info_json),
    [meta?.browser_info_json]
  );
  const persistedVideoDuration = (meta?.video_duration_ms ?? 0) / 1000;
  const effectiveVideoDuration =
    videoDuration > 0 ? videoDuration : persistedVideoDuration;
  const recordingStartMs = useMemo(
    () =>
      parseRecordingStartedAtGameMs(
        browserInfo,
        meta?.duration_ms ?? 0,
        effectiveVideoDuration
      ),
    [browserInfo, meta?.duration_ms, effectiveVideoDuration]
  );
  const recordingClockSegments = useMemo(
    () => parseRecordingClockSegments(browserInfo),
    [browserInfo]
  );
  const canUseVideoTimelineMapping = Boolean(
    videoLoadState === 'ready' &&
    videoSrc &&
    (effectiveVideoDuration > 0 || recordingClockSegments?.length)
  );

  useEffect(() => {
    setVideoSrc(undefined);
    setVideoLoadState('loading');
    setVideoDuration(0);
    setCurrentTime(0);
    setDemuxed(undefined);
    setFrameExtractor(undefined);
    let cancelled = false;
    const isCancelled = () => cancelled;
    let videoObjectUrl: string | undefined;
    let extractor: ReplayFrameExtractor | undefined;

    const replayPromise = api.getReplay(replayId);
    void Promise.all([
      replayPromise,
      api.getReplayEvents(replayId),
      api.getReplayComments(replayId),
    ])
      .then(([replay, indexed, loadedComments]) => {
        if (cancelled) return;
        setMeta(replay);
        setEvents(indexed);
        setComments(loadedComments);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : 'failed to load'
          );
        }
      });

    void replayPromise
      .then((replay) => {
        if (cancelled) return;
        if (!shouldPollForReplayVideo(replay.recording_status)) {
          setVideoLoadState('unavailable');
          return;
        }
        return api.waitForReplayVideo(replayId).then(async () => {
          const blob = await api.fetchReplayVideoBlob(replayId);
          if (cancelled) return;
          videoObjectUrl = URL.createObjectURL(blob);
          setVideoSrc(videoObjectUrl);
          setVideoLoadState('ready');
          void refreshReplayTimingMeta(replayId, isCancelled, setMeta);
          // WebCodecs 補助機能: 失敗しても通常の再生には影響させない。
          try {
            if (!isWebCodecsSupported()) return;
            const buffer = await blob.arrayBuffer();
            if (isCancelled()) return;
            const parsed = demuxWebm(buffer);
            if (!parsed || parsed.samples.length === 0) return;
            extractor = new ReplayFrameExtractor(parsed);
            setDemuxed(parsed);
            setFrameExtractor(extractor);
          } catch {
            // demux / WebCodecs 未対応時はフィルムストリップ等を出さないだけ。
          }
        });
      })
      .catch(() => {
        if (!cancelled) {
          setVideoSrc(undefined);
          setVideoLoadState('unavailable');
        }
      });

    return () => {
      cancelled = true;
      extractor?.dispose();
      if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
    };
  }, [replayId]);

  const visibleTimeline = useMemo(
    () => buildTimelineFromEvents(events, timeline),
    [events, timeline]
  );
  const highlightWindows = useMemo(() => {
    if (!demuxed || demuxed.durationMs <= 0) return [];
    const mapped = events.map((event) => ({
      event_id: event.event_id,
      type: event.type,
      at_ms: Math.round(
        timelineDisplaySeconds(
          event.at_ms / 1000,
          canUseVideoTimelineMapping,
          effectiveVideoDuration,
          meta?.duration_ms ?? 0,
          recordingStartMs,
          recordingClockSegments
        ) * 1000
      ),
      summary: event.summary ?? null,
    }));
    return pickHighlightWindows(mapped, demuxed.durationMs);
  }, [
    demuxed,
    events,
    canUseVideoTimelineMapping,
    effectiveVideoDuration,
    meta?.duration_ms,
    recordingStartMs,
    recordingClockSegments,
  ]);
  const commands = events.filter((event) => event.type === 'command_detected');
  const alerts = events.filter((event) => event.type === 'alert');
  const runbooks = events.filter((event) => event.type === 'runbook_open');
  const isTimelineLoading =
    !meta && events.length === 0 && timeline.length === 0 && !loadError;
  const displayDurationMs =
    effectiveVideoDuration > 0
      ? Math.round(effectiveVideoDuration * 1000)
      : (meta?.duration_ms ?? 0);
  const durationLabel = meta ? formatDuration(displayDurationMs) : '計算中…';

  function timelineVideoSeconds(gameSeconds: number) {
    return timelineDisplaySeconds(
      gameSeconds,
      canUseVideoTimelineMapping,
      effectiveVideoDuration,
      meta?.duration_ms ?? 0,
      recordingStartMs,
      recordingClockSegments
    );
  }

  function seekVideoSeconds(seconds: number, timelineId?: string) {
    const video = videoRef.current;
    if (!video) return;
    const target = clampSeekTime(video, seconds);
    const seekRequestId = seekRequestRef.current + 1;
    seekRequestRef.current = seekRequestId;
    setCurrentTime(target);
    setActiveTimelineId(timelineId);
    video.pause();
    seekMediaElement(video, target, () => {
      if (seekRequestRef.current !== seekRequestId) return;
      void video.play().catch(() => {});
    });
  }

  function rememberVideoDuration(video: HTMLVideoElement) {
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    setVideoDuration((current) =>
      Math.abs(current - duration) < 0.001 ? current : duration
    );
  }

  async function submitComment() {
    const body = commentDraft.trim();
    if (!body) return;
    const created = await api.addReplayComment(
      replayId,
      Math.round(currentTime * 1000),
      body
    );
    setComments((items) => [...items, created]);
    setCommentDraft('');
  }

  async function copyShareLink() {
    if (!shareWarning) {
      setShareWarning(true);
      return;
    }
    try {
      const share = await api.createShareLink(replayId);
      const url = `${window.location.origin}${share.sharePath}`;
      await navigator.clipboard.writeText(url);
      const expiresAt = new Date(share.expiresAt).toLocaleString('ja-JP');
      setShareStatus(
        `共有リンクをコピーしました（範囲: ${share.scope}、期限: ${expiresAt}）`
      );
    } catch (error: unknown) {
      setShareStatus(
        error instanceof Error
          ? error.message
          : '共有リンクの発行に失敗しました'
      );
    }
  }

  const tabIds = {
    timeline: 'replay-tab-timeline',
    commands: 'replay-tab-commands',
    alerts: 'replay-tab-alerts',
    runbooks: 'replay-tab-runbooks',
    comments: 'replay-tab-comments',
  } as const;
  const panelIds = {
    timeline: 'replay-panel-timeline',
    commands: 'replay-panel-commands',
    alerts: 'replay-panel-alerts',
    runbooks: 'replay-panel-runbooks',
    comments: 'replay-panel-comments',
  } as const;

  return (
    <section class='replay-layout expanded' aria-label='リプレイ詳細'>
      <div class='replay-main'>
        {videoSrc ? (
          <video
            ref={videoRef}
            controls
            preload='metadata'
            src={videoSrc}
            onLoadedMetadata={(event: Event) => {
              const video = event.currentTarget as HTMLVideoElement;
              rememberVideoDuration(video);
            }}
            onDurationChange={(event: Event) => {
              rememberVideoDuration(event.currentTarget as HTMLVideoElement);
            }}
            onTimeUpdate={(event: Event) => {
              const video = event.currentTarget as HTMLVideoElement;
              rememberVideoDuration(video);
              setCurrentTime(video.currentTime);
            }}
          />
        ) : videoLoadState === 'loading' ? (
          <p class='result-replay-note'>動画を準備中です…</p>
        ) : (
          <p class='result-replay-note'>
            保存された録画はありません。タイムラインのみ表示しています。
          </p>
        )}
        {frameExtractor && demuxed && (
          <ReplayFilmstrip
            durationMs={demuxed.durationMs}
            extractor={frameExtractor}
            onSeek={(seconds) => {
              seekVideoSeconds(seconds);
            }}
          />
        )}
        {frameExtractor && highlightWindows.length > 0 && (
          <ReplayHighlightReel
            highlights={highlightWindows}
            extractor={frameExtractor}
            onWatchInMain={(seconds) => {
              seekVideoSeconds(seconds);
            }}
          />
        )}
        <div class='replay-meta'>
          <span>結果: {meta?.result ?? '-'}</span>
          <span>難易度: {meta?.difficulty ?? '-'}</span>
          <span>対応時間: {durationLabel}</span>
        </div>
        <button
          type='button'
          aria-label='共有リンクをコピー'
          onClick={() => {
            void copyShareLink();
          }}
        >
          共有リンクをコピー
        </button>
        {shareWarning && (
          <p class='visibility-warning' role='alert'>
            ターミナル入力や チャット
            の内容が含まれる可能性があります。共有前に内容を確認してください。
          </p>
        )}
        {shareStatus && <p class='replay-meta'>{shareStatus}</p>}
      </div>
      <aside class='replay-side'>
        <div class='replay-tabs' role='tablist' aria-label='リプレイ情報'>
          {(
            ['timeline', 'commands', 'alerts', 'runbooks', 'comments'] as const
          ).map((item) => (
            <button
              key={item}
              id={tabIds[item]}
              type='button'
              role='tab'
              class={tab === item ? 'active' : ''}
              aria-selected={tab === item}
              aria-controls={panelIds[item]}
              onClick={() => {
                setTab(item);
              }}
            >
              {tabLabel(item)}
            </button>
          ))}
        </div>
        <div class='replay-panel-scroll' tabIndex={0}>
          {tab === 'timeline' &&
            (isTimelineLoading ? (
              <p
                class='result-replay-note'
                id={panelIds.timeline}
                role='tabpanel'
                aria-labelledby={tabIds.timeline}
              >
                タイムラインを読み込み中です…
              </p>
            ) : (
              <ol
                id={panelIds.timeline}
                class='timeline'
                role='tabpanel'
                aria-labelledby={tabIds.timeline}
              >
                {visibleTimeline.map((event) => {
                  const videoSeconds = timelineVideoSeconds(event.at);
                  const seekSeconds = videoSeconds - timelineSeekPrerollSeconds;
                  return (
                    <li key={event.id}>
                      {canUseVideoTimelineMapping ? (
                        <button
                          type='button'
                          aria-current={
                            activeTimelineId === event.id ? 'time' : undefined
                          }
                          onMouseDown={() => {
                            seekVideoSeconds(seekSeconds, event.id);
                          }}
                          onClick={() => {
                            seekVideoSeconds(seekSeconds, event.id);
                          }}
                        >
                          {formatSeconds(videoSeconds)} {event.label}
                        </button>
                      ) : (
                        <span>
                          {formatSeconds(videoSeconds)} {event.label}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            ))}
          {tab === 'commands' && (
            <ul
              id={panelIds.commands}
              class='replay-list'
              role='tabpanel'
              aria-labelledby={tabIds.commands}
            >
              {commands.map((event) => (
                <li key={event.event_id}>{event.summary}</li>
              ))}
            </ul>
          )}
          {tab === 'alerts' && (
            <ul
              id={panelIds.alerts}
              class='replay-list'
              role='tabpanel'
              aria-labelledby={tabIds.alerts}
            >
              {alerts.map((event) => (
                <li key={event.event_id}>{event.summary}</li>
              ))}
            </ul>
          )}
          {tab === 'runbooks' && (
            <ul
              id={panelIds.runbooks}
              class='replay-list'
              role='tabpanel'
              aria-labelledby={tabIds.runbooks}
            >
              {runbooks.map((event) => (
                <li key={event.event_id}>{event.summary}</li>
              ))}
            </ul>
          )}
          {tab === 'comments' && (
            <section
              id={panelIds.comments}
              class='replay-comments'
              role='tabpanel'
              aria-labelledby={tabIds.comments}
            >
              <ul class='replay-list'>
                {comments.map((comment) => (
                  <li key={comment.id}>
                    {videoSrc ? (
                      <button
                        type='button'
                        onClick={() => {
                          seekVideoSeconds(comment.at_ms / 1000);
                        }}
                      >
                        {formatSeconds(comment.at_ms / 1000)} {comment.body}
                      </button>
                    ) : (
                      <span>
                        {formatSeconds(comment.at_ms / 1000)} {comment.body}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        {tab === 'comments' && (
          <section class='replay-comments' aria-label='コメント入力'>
            <label for='replay-comment-draft'>この時刻へのコメント</label>
            <textarea
              id='replay-comment-draft'
              value={commentDraft}
              onInput={(event) => {
                setCommentDraft(event.currentTarget.value);
              }}
              rows={3}
              placeholder='この時刻へのコメント…'
            />
            <button type='button' onClick={() => void submitComment()}>
              コメント追加
            </button>
          </section>
        )}
        {loadError && (
          <p class='app-error' role='alert'>
            {loadError}
          </p>
        )}
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

function seekMediaElement(
  video: HTMLVideoElement,
  target: number,
  onReady: () => void
) {
  let timeout = 0;
  const done = () => {
    window.clearTimeout(timeout);
    video.removeEventListener('seeked', done);
    onReady();
  };

  video.addEventListener('seeked', done, {once: true});
  video.currentTime = target;

  if (!video.seeking && Math.abs(video.currentTime - target) < 0.1) {
    done();
    return;
  }
  timeout = window.setTimeout(done, 800);
}

async function refreshReplayTimingMeta(
  replayId: string,
  isCancelled: () => boolean,
  setMeta: (meta: ReplayMeta) => void
) {
  const deadline = Date.now() + 10_000;
  while (!isCancelled() && Date.now() < deadline) {
    const replay = (await api.getReplay(replayId).catch(() => undefined)) as
      | ReplayMeta
      | undefined;
    if (isCancelled()) return;
    if (replay) {
      setMeta(replay);
      if (hasReplayTimingMetadata(replay)) return;
    }
    await sleep(500);
  }
}

function hasReplayTimingMetadata(meta: ReplayMeta) {
  if ((meta.video_duration_ms ?? 0) > 0) return true;
  const browserInfo = parseBrowserInfo(meta.browser_info_json);
  return Boolean(parseRecordingClockSegments(browserInfo)?.length);
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function tabLabel(
  tab: 'timeline' | 'commands' | 'alerts' | 'runbooks' | 'comments'
) {
  if (tab === 'timeline') return 'タイムライン';
  if (tab === 'commands') return 'コマンド';
  if (tab === 'alerts') return 'アラート';
  if (tab === 'comments') return 'コメント';
  return 'Runbook';
}
