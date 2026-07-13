import {useEffect, useRef, useState} from 'preact/hooks';
import type {
  ExtractedReplayFrame,
  ReplayFrameExtractor,
} from '../effect/webcodecsReplay.js';
import type {HighlightWindow} from '../pure/webmDemux.js';
import {pickThumbnailTimestamps} from '../pure/webmDemux.js';
import {formatSeconds} from '../replay/replayMediaUtils.js';

const filmstripThumbnailCount = 10;
const filmstripWidth = 160;
const filmstripHeight = 90;
const highlightCanvasWidth = 480;
const highlightCanvasHeight = 270;

interface BitmapCanvasProps {
  bitmap: ImageBitmap | undefined;
  width: number;
  height: number;
}

/** Small canvas that renders an ImageBitmap scaled to fit (does not own it). */
function BitmapCanvas({bitmap, width, height}: BitmapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    drawBitmap(canvasRef.current, bitmap);
  }, [bitmap, width, height]);
  return <canvas ref={canvasRef} width={width} height={height} />;
}

function drawBitmap(
  canvas: HTMLCanvasElement | null,
  bitmap: ImageBitmap | undefined
) {
  if (!canvas) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (bitmap) {
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  }
}

interface FilmstripThumb {
  timestampMs: number;
  bitmap?: ImageBitmap;
}

interface ReplayFilmstripProps {
  durationMs: number;
  extractor: ReplayFrameExtractor;
  onSeek: (seconds: number) => void;
}

/** Clickable filmstrip of evenly spaced decoded thumbnails under the video. */
export function ReplayFilmstrip({
  durationMs,
  extractor,
  onSeek,
}: ReplayFilmstripProps) {
  const [thumbnails, setThumbnails] = useState<FilmstripThumb[]>([]);

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    const timestamps = pickThumbnailTimestamps(
      durationMs,
      filmstripThumbnailCount
    );
    setThumbnails(timestamps.map((timestampMs) => ({timestampMs})));
    void (async () => {
      for (const timestampMs of timestamps) {
        const bitmap = await extractor
          .extractFrameAt(timestampMs)
          .catch(() => undefined);
        if (isCancelled()) return;
        if (!bitmap) continue;
        setThumbnails((items) =>
          items.map((item) =>
            item.timestampMs === timestampMs ? {timestampMs, bitmap} : item
          )
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [durationMs, extractor]);

  if (thumbnails.length === 0) return null;
  return (
    <div
      class='replay-filmstrip'
      role='group'
      aria-label='サムネイルフィルムストリップ'
    >
      {thumbnails.map((thumb) => (
        <button
          key={thumb.timestampMs}
          type='button'
          class='replay-filmstrip-item'
          aria-label={`${formatSeconds(thumb.timestampMs / 1000)} へ移動`}
          onClick={() => {
            onSeek(thumb.timestampMs / 1000);
          }}
        >
          <BitmapCanvas
            bitmap={thumb.bitmap}
            width={filmstripWidth}
            height={filmstripHeight}
          />
          <span class='replay-filmstrip-time' aria-hidden='true'>
            {formatSeconds(thumb.timestampMs / 1000)}
          </span>
        </button>
      ))}
    </div>
  );
}

type HighlightReelStatus = 'loading' | 'ready' | 'empty';

interface ReplayHighlightReelProps {
  highlights: HighlightWindow[];
  extractor: ReplayFrameExtractor;
  onWatchInMain: (seconds: number) => void;
}

/**
 * Mini canvas player that decodes highlight windows via WebCodecs and plays
 * them at 1x with auto-advance across highlights.
 */
export function ReplayHighlightReel({
  highlights,
  extractor,
  onWatchInMain,
}: ReplayHighlightReelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const framesRef = useRef<ExtractedReplayFrame[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState<HighlightReelStatus>('loading');

  const safeIndex = Math.min(index, Math.max(0, highlights.length - 1));
  const current = highlights[safeIndex];

  // Load decoded frames for the current highlight.
  useEffect(() => {
    const highlight = highlights[safeIndex];
    if (!highlight) return;
    let cancelled = false;
    setStatus('loading');
    extractor
      .extractFrames(highlight.startMs, highlight.endMs)
      .then((frames) => {
        if (cancelled) {
          closeFrames(frames);
          return;
        }
        closeFrames(framesRef.current);
        framesRef.current = frames;
        setStatus(frames.length > 0 ? 'ready' : 'empty');
        const firstBitmap = frames[0]?.bitmap;
        if (firstBitmap && canvasRef.current) {
          canvasRef.current.width = firstBitmap.width;
          canvasRef.current.height = firstBitmap.height;
        }
        drawBitmap(canvasRef.current, firstBitmap);
      })
      .catch(() => {
        if (!cancelled) setStatus('empty');
      });
    return () => {
      cancelled = true;
    };
  }, [safeIndex, highlights, extractor]);

  // Close owned bitmaps on unmount.
  useEffect(
    () => () => {
      closeFrames(framesRef.current);
      framesRef.current = [];
    },
    []
  );

  // requestAnimationFrame playback at 1x, auto-advancing across highlights.
  useEffect(() => {
    if (!playing || status !== 'ready') return;
    const highlight = highlights[safeIndex];
    const frames = framesRef.current;
    const firstFrame = frames[0];
    if (!highlight || !firstFrame) return;
    const startMediaMs = firstFrame.timestampMs;
    const endMediaMs = Math.max(
      highlight.endMs,
      frames[frames.length - 1]?.timestampMs ?? 0
    );
    const startWall = performance.now();
    let rafId = 0;
    const tick = () => {
      const mediaMs = startMediaMs + (performance.now() - startWall);
      drawBitmap(canvasRef.current, frameAtOrBefore(frames, mediaMs)?.bitmap);
      if (mediaMs >= endMediaMs) {
        if (safeIndex < highlights.length - 1) {
          setIndex(safeIndex + 1);
        } else {
          setPlaying(false);
        }
        return;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [playing, status, safeIndex, highlights]);

  if (!current) return null;
  const eventSeconds = current.eventAtMs / 1000;
  return (
    <section class='replay-highlights' aria-label='ハイライトリール'>
      <h3>ハイライトリール</h3>
      <canvas
        ref={canvasRef}
        class='replay-highlight-canvas'
        width={highlightCanvasWidth}
        height={highlightCanvasHeight}
        role='img'
        aria-label={`ハイライト映像: ${current.label}`}
      />
      <div class='replay-highlight-controls'>
        <button
          type='button'
          aria-label={playing ? 'ハイライトを一時停止' : 'ハイライトを再生'}
          onClick={() => {
            setPlaying((value) => !value);
          }}
        >
          {playing ? '一時停止' : '再生'}
        </button>
        <button
          type='button'
          aria-label='この場面を本編で見る'
          onClick={() => {
            setPlaying(false);
            onWatchInMain(eventSeconds);
          }}
        >
          本編で見る
        </button>
        <span class='replay-highlight-caption'>
          {current.label}（{formatSeconds(eventSeconds)}）
        </span>
        {status === 'loading' && (
          <span class='replay-highlight-caption'>デコード中…</span>
        )}
        {status === 'empty' && (
          <span class='replay-highlight-caption'>
            この場面はデコードできませんでした
          </span>
        )}
      </div>
      <ol class='replay-highlight-list' aria-label='ハイライト一覧'>
        {highlights.map((highlight, itemIndex) => (
          <li key={highlight.id}>
            <button
              type='button'
              class={itemIndex === safeIndex ? 'active' : ''}
              aria-current={itemIndex === safeIndex ? 'true' : undefined}
              onClick={() => {
                setIndex(itemIndex);
              }}
            >
              {formatSeconds(highlight.eventAtMs / 1000)} {highlight.label}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function frameAtOrBefore(
  frames: ExtractedReplayFrame[],
  mediaMs: number
): ExtractedReplayFrame | undefined {
  let picked = frames[0];
  for (const frame of frames) {
    if (frame.timestampMs > mediaMs) break;
    picked = frame;
  }
  return picked;
}

function closeFrames(frames: ExtractedReplayFrame[]) {
  for (const frame of frames) frame.bitmap.close();
}
