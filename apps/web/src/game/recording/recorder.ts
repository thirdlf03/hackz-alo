import { createReplayEvent, pickSupportedMimeType, recordingChunkMs, type ReplayEvent } from "@incident/shared";

type UploadChunk = {
  seq: number;
  blob: Blob;
  startedAtMs: number;
  endedAtMs: number;
};

type RecorderOptions = {
  replayId: string;
  onChunk: (chunk: UploadChunk) => Promise<unknown>;
  onEvent: (event: ReplayEvent) => Promise<unknown>;
};

export class CanvasRecorder {
  private recorder?: MediaRecorder;
  private activeMimeType?: string;
  private seq = 0;
  private startedAt = 0;
  private lastChunkEndedAtMs = 0;
  private queue = Promise.resolve();
  private uploadErrors: unknown[] = [];

  constructor(private canvas: HTMLCanvasElement, private options: RecorderOptions) {}

  get mimeType() {
    return this.activeMimeType;
  }

  get durationMs() {
    return this.lastChunkEndedAtMs;
  }

  async start() {
    if (this.recorder && this.recorder.state !== "inactive") return;
    const mimeType = pickSupportedMimeType((candidate) => MediaRecorder.isTypeSupported(candidate));
    if (!mimeType) throw new Error("MediaRecorder is not supported in this browser");
    this.activeMimeType = mimeType;
    const stream = this.canvas.captureStream(30);
    this.startedAt = performance.now();
    this.lastChunkEndedAtMs = 0;
    this.seq = 0;
    this.uploadErrors = [];
    this.queue = Promise.resolve();
    this.recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
    this.recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size === 0) return;
      const seq = this.seq++;
      const endedAtMs = Math.round(performance.now() - this.startedAt);
      const startedAtMs = this.lastChunkEndedAtMs;
      this.lastChunkEndedAtMs = Math.max(this.lastChunkEndedAtMs, endedAtMs);
      this.queue = this.queue.then(
        () => this.uploadChunkAndEvent(seq, event.data, startedAtMs, endedAtMs),
        () => this.uploadChunkAndEvent(seq, event.data, startedAtMs, endedAtMs)
      );
    });
    this.recorder.addEventListener("error", (event) => {
      this.uploadErrors.push(event);
      const at = Math.round(performance.now() - this.startedAt);
      this.queue = this.queue.then(
        () => this.uploadRecorderErrorEvent(at),
        () => this.uploadRecorderErrorEvent(at)
      );
    });
    this.recorder.start(recordingChunkMs);
  }

  private async uploadRecorderErrorEvent(at: number) {
    try {
      await this.options.onEvent(
        createReplayEvent({
          replayId: this.options.replayId,
          type: "recording_error",
          at,
          actor: "system",
          payload: { message: "MediaRecorder failed" },
          visibility: "private"
        })
      );
    } catch (error) {
      this.uploadErrors.push(error);
    }
  }

  private async uploadChunkAndEvent(seq: number, blob: Blob, startedAtMs: number, endedAtMs: number) {
    try {
      await this.options.onChunk({ seq, blob, startedAtMs, endedAtMs });
      await this.options.onEvent(
        createReplayEvent({
          replayId: this.options.replayId,
          type: "recording_chunk_created",
          at: endedAtMs,
          actor: "system",
          payload: {
            seq,
            byteSize: blob.size,
            startedAtMs,
            endedAtMs
          }
        })
      );
    } catch (error) {
      this.uploadErrors.push(error);
    }
  }

  async stop() {
    if (!this.recorder || this.recorder.state === "inactive") return;
    if (this.recorder.state === "recording") {
      this.recorder.requestData();
    }
    await new Promise<void>((resolve) => {
      this.recorder?.addEventListener("stop", () => resolve(), { once: true });
      this.recorder?.stop();
    });
    await this.queue;
    if (this.uploadErrors.length > 0) {
      throw new AggregateError(this.uploadErrors, "One or more recording uploads failed");
    }
  }
}
