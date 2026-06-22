const enabled = import.meta.env.DEV;

export function terminalDebug(event: string, detail?: Record<string, unknown>) {
  if (!enabled) return;
  void fetch('/api/dev/terminal-debug', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({event, detail, at: Date.now()}),
  }).catch(() => {});
}

export function installTerminalWebSocketDebug() {
  if (!enabled) return;
  const marker = '__incidentTerminalWsDebug';
  const scope = globalThis as typeof globalThis & {[marker]?: boolean};
  if (scope[marker]) return;
  scope[marker] = true;

  const descriptor = Object.getOwnPropertyDescriptor(
    WebSocket.prototype,
    'send'
  );
  if (!descriptor || typeof descriptor.value !== 'function') return;
  const originalSend = descriptor.value as (
    this: WebSocket,
    data: string | ArrayBufferLike | Blob | ArrayBufferView
  ) => void;

  WebSocket.prototype.send = function sendWithDebug(
    data: ArrayBuffer | ArrayBufferView | Blob | string
  ) {
    if (this.url.includes('/ws/terminal')) {
      let bytes: number[] | undefined;
      if (data instanceof ArrayBuffer) bytes = [...new Uint8Array(data)];
      else if (ArrayBuffer.isView(data)) {
        bytes = [
          ...new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        ];
      } else if (data instanceof Blob) {
        terminalDebug('ws.send.blob', {size: data.size});
      } else if (typeof data === 'string') {
        try {
          const parsed = JSON.parse(data) as {type?: string};
          terminalDebug('ws.send.json', {type: parsed.type ?? 'unknown'});
        } catch {
          terminalDebug('ws.send.text', {length: data.length});
        }
      }
      if (bytes) {
        terminalDebug('ws.send.binary', {
          hex: bytes
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join(' '),
          bytes,
          sigint: bytes.includes(3),
        });
      }
    }
    if (data instanceof Blob) {
      originalSend.call(this, data);
      return;
    }
    originalSend.call(this, data);
  };
}
