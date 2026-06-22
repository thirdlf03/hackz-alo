import {
  recordingMultipartPartSize,
  splitBufferIntoParts,
} from '@incident/shared';
import type {ApiClient} from '../../api/client.js';

export {splitBufferIntoParts};

export class RecordingFinalizer {
  private parts: Uint8Array[] = [];
  private totalSize = 0;

  append(blob: Blob) {
    return blob.arrayBuffer().then((buffer) => {
      const bytes = new Uint8Array(buffer);
      this.parts.push(bytes);
      this.totalSize += bytes.length;
    });
  }

  hasData() {
    return this.totalSize > 0;
  }

  reset() {
    this.parts = [];
    this.totalSize = 0;
  }

  async finalize(replayId: string, api: ApiClient) {
    if (!this.hasData()) return false;

    const merged = mergeUint8Arrays(this.parts);
    await api.createMultipartUpload(replayId);

    const chunks = splitBufferIntoParts(merged, recordingMultipartPartSize);
    for (let index = 0; index < chunks.length; index += 1) {
      const part = chunks[index];
      if (!part || part.length === 0) continue;
      await api.uploadMultipartPart(
        replayId,
        index + 1,
        new Blob([part as BlobPart])
      );
    }

    await api.completeMultipartUpload(replayId);
    this.reset();
    return true;
  }
}

function mergeUint8Arrays(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}
