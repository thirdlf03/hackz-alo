export interface AddonSendChannels {
  sendResize: (cols: number, rows: number) => void;
  sendData: (data: string) => void;
}

export interface FocusableTerminal {
  focus: () => void;
}

/**
 * Shadows an addon's sendResize/sendData with instance-own versions
 * gated on canOperate(), mutating `addon` in place.
 *
 * This has to patch the instance rather than relying on call-site
 * guards around TerminalSession's own resize()/input() methods:
 * SandboxAddon (@cloudflare/sandbox/xterm) always calls these as
 * `this.sendResize(...)` / `this.sendData(...)` from inside its own
 * methods, including two paths TerminalSession doesn't otherwise
 * control —
 *  - `handleControlMessage`'s "ready" branch unconditionally calls
 *    `this.sendResize(cols, rows)` on every (re)connect, which would
 *    otherwise overwrite the shared PTY size as soon as a read-only
 *    viewer connects or reconnects.
 *  - `onSocketOpen` calls `terminal.focus()` on "ready" and wires
 *    `terminal.onData(data => this.sendData(data))`, so a read-only
 *    viewer's keystrokes landing in the (offscreen) xterm instance
 *    would otherwise reach the PTY directly.
 * Because JS resolves `this.sendResize(...)` by checking own properties
 * before the prototype chain, an own property assigned on the addon
 * instance intercepts every one of those call sites — including ones
 * defined only inside the vendor addon's compiled code, which this
 * module never touches or forks.
 */
export function guardAddonTransport(
  addon: AddonSendChannels,
  canOperate: () => boolean
): void {
  const rawSendResize = addon.sendResize.bind(addon);
  addon.sendResize = (cols, rows) => {
    if (canOperate()) rawSendResize(cols, rows);
  };
  const rawSendData = addon.sendData.bind(addon);
  addon.sendData = (data) => {
    if (canOperate()) rawSendData(data);
  };
}

/**
 * Shadows a terminal's `focus` with an instance-own version gated on
 * canOperate(), mutating `terminal` in place.
 *
 * SandboxAddon's `handleControlMessage` calls `this.terminal?.focus()`
 * unconditionally on every "ready" control message — `this.terminal`
 * there is the exact same xterm `Terminal` instance passed to
 * `addon.activate(terminal)` by `terminal.loadAddon(addon)`, so shadowing
 * `focus` on that instance intercepts the addon's call the same way
 * guardAddonTransport intercepts sendResize/sendData. Left unguarded, a
 * read-only viewer's (hidden, offscreen) xterm would steal real DOM
 * focus on every connect/reconnect: keystrokes meant for other UI would
 * be swallowed, and would flow into TerminalSession's own onData
 * handler, feeding the local command-parsing pipeline (see
 * TerminalSession.handleTerminalData's own canOperate() guard for the
 * other half of that defense).
 */
export function guardTerminalFocus(
  terminal: FocusableTerminal,
  canOperate: () => boolean
): void {
  const rawFocus = terminal.focus.bind(terminal);
  terminal.focus = () => {
    if (canOperate()) rawFocus();
  };
}
