export type ClientToSandboxFrameKind = 'stdin' | 'resize' | 'unknown';

/**
 * Classifies a WebSocket message frame sent by the terminal client toward
 * the sandbox PTY, per the actual `@cloudflare/sandbox` SandboxAddon wire
 * protocol (verified by reading
 * node_modules/@cloudflare/sandbox/dist/xterm/index.js, not guessed): in
 * `onSocketOpen` the addon wires exactly two client -> sandbox message
 * kinds —
 *   - `terminal.onData` -> `sendData(data)`, which sends the raw
 *     keystroke bytes as a *binary* WebSocket frame (`socket.send(
 *     textEncoder.encode(data))`);
 *   - `terminal.onResize` -> `sendResize(cols, rows)`, which sends a
 *     *text* JSON frame `{"type":"resize","cols":...,"rows":...}`. The
 *     addon also fires this unconditionally on every "ready" control
 *     message from the server (i.e. on every (re)connect).
 * Both are PTY *operate* actions. There is no other client -> sandbox
 * message in this protocol (no keepalive/ping frame originates from the
 * client side — "ready"/"error"/"exit" are server -> client only, per the
 * same file's `handleControlMessage`).
 */
export function classifyClientToSandboxFrame(
  data: string | ArrayBuffer | ArrayBufferView
): ClientToSandboxFrameKind {
  if (typeof data !== 'string') return 'stdin';
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return 'unknown';
  }
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    (parsed as {type?: unknown}).type === 'resize'
  ) {
    return 'resize';
  }
  return 'unknown';
}

// The SandboxAddon client protocol has no client -> sandbox keepalive or
// other control frame (see classifyClientToSandboxFrame above) — every
// frame kind it can currently produce is a PTY operate action. Nothing
// is allowlisted here; if the addon's protocol ever grows a genuine
// control frame that must survive without operate access (e.g. a
// client-side keepalive ping), it needs to be added explicitly rather
// than let through by a permissive default.
const ALLOWED_WITHOUT_OPERATE: ReadonlySet<ClientToSandboxFrameKind> =
  new Set();

/**
 * Whether a client -> sandbox frame of the given kind should be
 * forwarded to the sandbox PTY. Operators forward everything; a
 * non-operator (read-only terminal viewer) only gets frame kinds
 * explicitly allowlisted above, which today is none.
 */
export function shouldForwardClientToSandboxFrame(
  kind: ClientToSandboxFrameKind,
  canOperate: boolean
): boolean {
  return canOperate || ALLOWED_WITHOUT_OPERATE.has(kind);
}
