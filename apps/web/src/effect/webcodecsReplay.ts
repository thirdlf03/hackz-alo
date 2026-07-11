import type {DemuxedWebm} from '../pure/webmDemux.js';
import {findDecodeRange} from '../pure/webmDemux.js';

/** True when the WebCodecs VideoDecoder API is available in this browser. */
export function isWebCodecsSupported(): boolean {
  return 'VideoDecoder' in globalThis && 'EncodedVideoChunk' in globalThis;
}

export interface ExtractedReplayFrame {
  timestampMs: number;
  bitmap: ImageBitmap;
}

function toMicros(timestampMs: number): number {
  return Math.round(timestampMs * 1000);
}

/**
 * Decodes frames of a demuxed MediaRecorder WebM via WebCodecs.
 *
 * A fresh VideoDecoder is created per request (cheap for VP8/VP9) and always
 * closed afterwards; every decoded VideoFrame is closed after use. Calls are
 * serialized through a promise queue and single-frame results are cached as
 * ImageBitmaps by rounded timestamp.
 */
export class ReplayFrameExtractor {
  private readonly demuxed: DemuxedWebm;
  private readonly cache = new Map<number, ImageBitmap>();
  private queue: Promise<unknown> = Promise.resolve();
  private configSupported: boolean | undefined;
  private disposed = false;

  constructor(demuxed: DemuxedWebm) {
    this.demuxed = demuxed;
  }

  /** Decode the frame closest to (at or before) the timestamp; cached. */
  async extractFrameAt(timestampMs: number): Promise<ImageBitmap | undefined> {
    const key = Math.round(timestampMs);
    const cached = this.cache.get(key);
    if (cached) return cached;
    return this.enqueue(async () => {
      if (this.isDisposed()) return undefined;
      const cachedAgain = this.cache.get(key);
      if (cachedAgain) return cachedAgain;
      const {startIndex, endIndex} = findDecodeRange(this.demuxed.samples, key);
      const target = this.demuxed.samples[endIndex];
      if (!target) return undefined;
      const frames = await this.decodeSampleRange(
        startIndex,
        endIndex,
        new Set([toMicros(target.timestampMs)])
      );
      const bitmap = frames[0]?.bitmap;
      if (!bitmap) return undefined;
      if (this.isDisposed()) {
        bitmap.close();
        return undefined;
      }
      this.cache.set(key, bitmap);
      return bitmap;
    });
  }

  /**
   * Decode all frames within [startMs, endMs], thinned evenly to maxFrames.
   * Returned bitmaps are NOT cached: the caller owns and must close them.
   */
  async extractFrames(
    startMs: number,
    endMs: number,
    maxFrames = 90
  ): Promise<ExtractedReplayFrame[]> {
    return this.enqueue(async () => {
      if (this.isDisposed()) return [];
      const samples = this.demuxed.samples;
      if (samples.length === 0 || maxFrames <= 0) return [];
      const startIndex = findDecodeRange(samples, startMs).startIndex;
      const endIndex = Math.max(
        startIndex,
        findDecodeRange(samples, endMs).endIndex
      );
      let wanted: number[] = [];
      for (let i = startIndex; i <= endIndex; i += 1) {
        const sample = samples[i];
        if (sample && sample.timestampMs >= startMs) wanted.push(i);
      }
      if (wanted.length === 0) wanted = [endIndex];
      if (wanted.length > maxFrames) {
        const thinned: number[] = [];
        for (let j = 0; j < maxFrames; j += 1) {
          const pick =
            wanted[Math.round((j * (wanted.length - 1)) / (maxFrames - 1))];
          if (pick !== undefined && thinned[thinned.length - 1] !== pick) {
            thinned.push(pick);
          }
        }
        wanted = thinned;
      }
      const wantedUs = new Set<number>();
      for (const index of wanted) {
        const sample = samples[index];
        if (sample) wantedUs.add(toMicros(sample.timestampMs));
      }
      return this.decodeSampleRange(startIndex, endIndex, wantedUs);
    });
  }

  /** Close all cached bitmaps; further extractions resolve empty. */
  dispose(): void {
    this.disposed = true;
    for (const bitmap of this.cache.values()) bitmap.close();
    this.cache.clear();
  }

  private isDisposed(): boolean {
    return this.disposed;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async isSupported(config: VideoDecoderConfig): Promise<boolean> {
    if (this.configSupported === undefined) {
      try {
        const support = await VideoDecoder.isConfigSupported(config);
        this.configSupported = support.supported === true;
      } catch {
        this.configSupported = false;
      }
    }
    return this.configSupported;
  }

  private async decodeSampleRange(
    startIndex: number,
    endIndex: number,
    wantedUs: Set<number>
  ): Promise<ExtractedReplayFrame[]> {
    const config: VideoDecoderConfig = {
      codec: this.demuxed.codec,
      codedWidth: this.demuxed.codedWidth,
      codedHeight: this.demuxed.codedHeight,
    };
    if (!(await this.isSupported(config))) return [];
    const results: ExtractedReplayFrame[] = [];
    const pending: Promise<void>[] = [];
    const decoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        const timestampUs = frame.timestamp;
        if (!wantedUs.has(timestampUs)) {
          frame.close();
          return;
        }
        pending.push(
          createImageBitmap(frame)
            .then((bitmap) => {
              results.push({
                timestampMs: Math.round(timestampUs / 1000),
                bitmap,
              });
            })
            .catch(() => undefined)
            .finally(() => {
              frame.close();
            })
        );
      },
      error: () => undefined,
    });
    try {
      decoder.configure(config);
      for (let i = startIndex; i <= endIndex; i += 1) {
        const sample = this.demuxed.samples[i];
        if (!sample) continue;
        decoder.decode(
          new EncodedVideoChunk({
            type: sample.keyframe ? 'key' : 'delta',
            timestamp: toMicros(sample.timestampMs),
            data: sample.data,
          })
        );
      }
      await decoder.flush();
    } catch {
      // Decode errors are non-fatal: return whatever frames were produced.
    } finally {
      if (decoder.state !== 'closed') decoder.close();
    }
    await Promise.all(pending);
    return results.toSorted((a, b) => a.timestampMs - b.timestampMs);
  }
}
