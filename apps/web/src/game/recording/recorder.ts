import {
  createReplayEvent,
  pickSupportedMimeType,
  recordingChunkMs,
  type ReplayEvent,
} from '@incident/shared';

interface UploadChunk {
  seq: number;
  blob: Blob;
  startedAtMs: number;
  endedAtMs: number;
}

interface RecorderOptions {
  replayId: string;
  onChunk: (chunk: UploadChunk) => Promise<unknown>;
  onEvent: (event: ReplayEvent) => Promise<unknown>;
}

export class CanvasRecorder {
  private recorder?: MediaRecorder;
  private activeMimeType?: string;
  private seq = 0;
  private startedAt = 0;
  private lastChunkEndedAtMs = 0;
  private queue = Promise.resolve();
  private uploadErrors: unknown[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private options: RecorderOptions
  ) {}

  get mimeType() {
    return this.activeMimeType;
  }

  get durationMs() {
    return this.lastChunkEndedAtMs;
  }

  get currentElapsedMs() {
    if (!this.recorder || this.recorder.state === 'inactive') {
      return this.lastChunkEndedAtMs;
    }
    return Math.max(0, Math.round(performance.now() - this.startedAt));
  }

  /**
   * @param audioStream 録画へ合成する音声(アラート音・ウォールーム音声の
   *   ミックス)。省略時は従来どおり映像のみ(docs/dev/tech/03-recording-and-replay.md R30-R32)。
   */
  start(audioStream?: MediaStream) {
    if (this.recorder && this.recorder.state !== 'inactive') return;
    const mimeType = pickSupportedMimeType((candidate) =>
      MediaRecorder.isTypeSupported(candidate)
    );
    if (!mimeType) {
      throw new Error('MediaRecorder is not supported in this browser');
    }
    this.activeMimeType = mimeType;
    const canvasStream = this.canvas.captureStream(30);
    const audioTracks = audioStream?.getAudioTracks() ?? [];
    const stream =
      audioTracks.length > 0
        ? new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks])
        : canvasStream;
    this.startedAt = performance.now();
    this.lastChunkEndedAtMs = 0;
    this.seq = 0;
    this.uploadErrors = [];
    this.queue = Promise.resolve();
    this.recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 2_500_000,
    });
    this.recorder.addEventListener('dataavailable', (event) => {
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
    this.recorder.addEventListener('error', (event) => {
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
          type: 'recording_error',
          at,
          actor: 'system',
          payload: {message: 'MediaRecorder failed'},
          visibility: 'private',
        })
      );
    } catch (error) {
      this.uploadErrors.push(error);
    }
  }

  private async uploadChunkAndEvent(
    seq: number,
    blob: Blob,
    startedAtMs: number,
    endedAtMs: number
  ) {
    try {
      await this.options.onChunk({seq, blob, startedAtMs, endedAtMs});
      await this.options.onEvent(
        createReplayEvent({
          replayId: this.options.replayId,
          type: 'recording_chunk_created',
          at: endedAtMs,
          actor: 'system',
          payload: {
            seq,
            byteSize: blob.size,
            startedAtMs,
            endedAtMs,
          },
        })
      );
    } catch (error) {
      this.uploadErrors.push(error);
    }
  }

  async stop() {
    if (!this.recorder || this.recorder.state === 'inactive') return;
    if (this.recorder.state === 'recording') {
      this.recorder.requestData();
    }
    await new Promise<void>((resolve) => {
      this.recorder?.addEventListener(
        'stop',
        () => {
          resolve();
        },
        {once: true}
      );
      this.recorder?.stop();
    });
    await this.queue;
    if (this.uploadErrors.length > 0) {
      throw new AggregateError(
        this.uploadErrors,
        'One or more recording uploads failed'
      );
    }
  }
}
