import type {ReplayEvent} from '@incident/shared';
import type {ApiClientSurface} from '../../api/client.js';
import {ApiResultError} from '../../api/httpClient.js';

interface QueuedChunk {
  kind: 'chunk';
  replayId: string;
  seq: number;
  blob: Blob;
  startedAtMs: number;
  endedAtMs: number;
}

interface QueuedEvents {
  kind: 'events';
  replayId: string;
  events: ReplayEvent[];
}

type QueueItem = QueuedChunk | QueuedEvents;

const DB_NAME = 'incident-offline-queue';
const STORE = 'queue';
const MAX_QUEUE_ITEMS = 200;
const MAX_QUEUE_BYTES = 100 * 1024 * 1024;
const BASE_RETRY_MS = 1000;
const MAX_RETRY_MS = 60_000;

function indexedDbError(message: string, cause?: DOMException | null): Error {
  if (cause) return new Error(cause.message, {cause});
  return new Error(message);
}

export class OfflineUploadQueue {
  private flushing = false;
  private retryDelayMs = BASE_RETRY_MS;
  private degraded = false;

  constructor(private api: ApiClientSurface) {}

  isDegraded() {
    return this.degraded;
  }

  async enqueueChunk(input: Omit<QueuedChunk, 'kind'>) {
    await this.enforceLimits(input.blob.size);
    await this.put({kind: 'chunk', ...input});
    void this.flush();
  }

  async enqueueEvents(replayId: string, events: ReplayEvent[]) {
    if (events.length === 0) return;
    await this.enforceLimits(JSON.stringify(events).length);
    const item: Omit<QueuedEvents, 'id'> = {kind: 'events', replayId, events};
    await this.put(item);
    void this.flush();
  }

  async flush() {
    if (this.flushing || typeof indexedDB === 'undefined') return;
    this.flushing = true;
    try {
      const items = await this.readAll();
      for (const item of items) {
        try {
          if (item.kind === 'chunk') {
            await this.api.uploadChunk(item.replayId, item);
          } else {
            await this.api.uploadEvents(item.replayId, item.events);
          }
          await this.delete(item.id);
          this.retryDelayMs = BASE_RETRY_MS;
        } catch (error) {
          if (shouldDiscardOfflineUploadError(error)) {
            // Conflicts and permanent auth/not-found failures can never
            // succeed on retry. Drop stale items so they do not jam uploads
            // for the current replay.
            await this.delete(item.id);
            this.degraded = true;
            continue;
          }
          this.retryDelayMs = Math.min(this.retryDelayMs * 2, MAX_RETRY_MS);
          await new Promise((resolve) =>
            setTimeout(resolve, this.retryDelayMs)
          );
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private async enforceLimits(incomingBytes: number) {
    const items = await this.readAll();
    let totalBytes = items.reduce(
      (sum, item) => sum + estimateItemBytes(item),
      0
    );
    while (
      (items.length >= MAX_QUEUE_ITEMS ||
        totalBytes + incomingBytes > MAX_QUEUE_BYTES) &&
      items.length > 0
    ) {
      const dropped = items.shift();
      if (!dropped) break;
      await this.delete(dropped.id);
      totalBytes -= estimateItemBytes(dropped);
      this.degraded = true;
    }
  }

  private put(item: Omit<QueueItem, 'id'> & {id?: string}) {
    return this.withStore('readwrite', (store) => {
      store.put({...item, id: item.id ?? crypto.randomUUID()});
    });
  }

  private readAll(): Promise<Array<QueueItem & {id: string}>> {
    return this.withStore('readonly', (store) => {
      return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => {
          resolve(request.result as Array<QueueItem & {id: string}>);
        };
        request.onerror = () => {
          reject(indexedDbError('IndexedDB getAll failed', request.error));
        };
      });
    });
  }

  private delete(id: string) {
    return this.withStore('readwrite', (store) => {
      store.delete(id);
    });
  }

  private withStore<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => T | Promise<T>
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE, {keyPath: 'id'});
      };
      request.onerror = () => {
        reject(indexedDbError('IndexedDB open failed', request.error));
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        Promise.resolve(run(store)).then(resolve).catch(reject);
        tx.oncomplete = () => {
          db.close();
        };
        tx.onerror = () => {
          reject(indexedDbError('IndexedDB transaction failed', tx.error));
        };
      };
    });
  }
}

export function shouldDiscardOfflineUploadError(error: unknown) {
  return (
    error instanceof ApiResultError &&
    shouldDiscardOfflineUploadFailure(error.status, error.code)
  );
}

export function shouldDiscardOfflineUploadFailure(
  status: number,
  code: string
) {
  return code === 'conflict' || [401, 403, 404].includes(status);
}

function estimateItemBytes(item: QueueItem) {
  if (item.kind === 'chunk') return item.blob.size;
  return JSON.stringify(item.events).length;
}

export function installOfflineFlush(
  queue: OfflineUploadQueue,
  onPageHide?: () => void
) {
  const flush = () => void queue.flush();
  window.addEventListener('online', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      onPageHide?.();
      flush();
    }
  });
  window.addEventListener('pagehide', () => {
    onPageHide?.();
    flush();
  });
}
