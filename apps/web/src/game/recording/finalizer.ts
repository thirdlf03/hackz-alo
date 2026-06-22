import type {ApiClientSurface} from '../../api/client.js';

export class RecordingFinalizer {
  private chunkCount = 0;

  append(_blob: Blob) {
    this.chunkCount += 1;
    return Promise.resolve();
  }

  hasData() {
    return this.chunkCount > 0;
  }

  reset() {
    this.chunkCount = 0;
  }

  async finalize(replayId: string, api: ApiClientSurface) {
    if (!this.hasData()) return false;
    try {
      const result = await api.finalizeReplayVideo(replayId);
      this.reset();
      return result.status === 'ready';
    } catch {
      return false;
    }
  }
}
