import type {ReplayEvent} from '@incident/shared';
import type {ApiClientSurface} from '../../api/client.js';

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

function indexedDbError(message: string, cause?: DOMException | null): Error {
  if (cause) return new Error(cause.message, {cause});
  return new Error(message);
}

export class OfflineUploadQueue {
  private flushing = false;

  constructor(private api: ApiClientSurface) {}

  async enqueueChunk(input: Omit<QueuedChunk, 'kind'>) {
    await this.put({kind: 'chunk', ...input});
    void this.flush();
  }

  async enqueueEvents(replayId: string, events: ReplayEvent[]) {
    if (events.length === 0) return;
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
        } catch {
          break;
        }
      }
    } finally {
      this.flushing = false;
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
