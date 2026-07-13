import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  guardAddonTransport,
  guardTerminalFocus,
} from '../../apps/web/src/game/terminal/addonTransportGuard.ts';

// Mimics the relevant slice of @cloudflare/sandbox's SandboxAddon: plain
// prototype methods that other instance methods call as `this.sendResize(...)`
// / `this.sendData(...)`, including an unconditional call from a "ready"-style
// control-message handler — the exact shape that made the vendor addon's
// initial resize send look unguardable from the outside.
class FakeAddon {
  sent = [];
  sendResize(cols, rows) {
    this.sent.push({type: 'resize', cols, rows});
  }
  sendData(data) {
    this.sent.push({type: 'data', data});
  }
  // Simulates SandboxAddon.handleControlMessage's "ready" branch, which
  // calls `this.sendResize(...)` unconditionally on every (re)connect.
  onReadyControlMessage(cols, rows) {
    this.sendResize(cols, rows);
  }
  // Simulates terminal.onData(data => this.sendData(data)), wired once the
  // socket opens.
  onLocalKeystroke(data) {
    this.sendData(data);
  }
}

test('guardAddonTransport blocks sendResize/sendData while canOperate is false', () => {
  const addon = new FakeAddon();
  let canOperate = false;
  guardAddonTransport(addon, () => canOperate);

  addon.sendResize(80, 24);
  addon.sendData('ls\n');

  assert.deepEqual(addon.sent, []);
});

test('guardAddonTransport blocks the vendor "ready" control message auto-resize', () => {
  const addon = new FakeAddon();
  guardAddonTransport(addon, () => false);

  // This is the call this fix specifically targets: SandboxAddon sends
  // this on every connect/reconnect regardless of caller intent.
  addon.onReadyControlMessage(80, 24);

  assert.deepEqual(addon.sent, []);
});

test('guardAddonTransport blocks keystrokes routed through onData once focused', () => {
  const addon = new FakeAddon();
  guardAddonTransport(addon, () => false);

  addon.onLocalKeystroke('rm -rf /\n');

  assert.deepEqual(addon.sent, []);
});

test('guardAddonTransport passes calls through once canOperate() is true', () => {
  const addon = new FakeAddon();
  guardAddonTransport(addon, () => true);

  addon.sendResize(120, 30);
  addon.sendData('ls\n');
  addon.onReadyControlMessage(120, 30);

  assert.deepEqual(addon.sent, [
    {type: 'resize', cols: 120, rows: 30},
    {type: 'data', data: 'ls\n'},
    {type: 'resize', cols: 120, rows: 30},
  ]);
});

test('guardAddonTransport re-evaluates canOperate() live, e.g. when solo rescue kicks in', () => {
  const addon = new FakeAddon();
  let canOperate = false;
  guardAddonTransport(addon, () => canOperate);

  addon.sendResize(80, 24);
  assert.deepEqual(addon.sent, [], 'blocked while canOperate is false');

  // Solo rescue: everyone else drops offline and the room falls back to
  // unrestricted. The guard must not have latched the earlier false
  // result — the very next call should go through immediately.
  canOperate = true;
  addon.sendResize(100, 30);
  addon.sendData('echo solo-rescue\n');

  assert.deepEqual(addon.sent, [
    {type: 'resize', cols: 100, rows: 30},
    {type: 'data', data: 'echo solo-rescue\n'},
  ]);
});

// Mimics the relevant slice of xterm's Terminal + SandboxAddon
// interaction: `focus` is an ordinary instance-called method, and
// SandboxAddon's "ready" control-message handler calls
// `this.terminal?.focus()` unconditionally on every (re)connect (`this.terminal`
// there is the very same object reference as the one below, since
// `terminal.loadAddon(addon)` hands it to the addon via `activate`).
class FakeTerminal {
  focusCount = 0;
  focus() {
    this.focusCount += 1;
  }
  // Simulates SandboxAddon.handleControlMessage's "ready" branch, which
  // calls `this.terminal?.focus()` unconditionally on every (re)connect.
  onReadyControlMessage() {
    this.focus();
  }
}

test('guardTerminalFocus blocks focus() while canOperate is false', () => {
  const terminal = new FakeTerminal();
  guardTerminalFocus(terminal, () => false);

  terminal.focus();

  assert.equal(terminal.focusCount, 0);
});

test('guardTerminalFocus blocks the vendor "ready" control message auto-focus', () => {
  const terminal = new FakeTerminal();
  guardTerminalFocus(terminal, () => false);

  // This is the call this fix specifically targets: SandboxAddon steals
  // DOM focus onto the hidden xterm on every connect/reconnect.
  terminal.onReadyControlMessage();

  assert.equal(terminal.focusCount, 0);
});

test('guardTerminalFocus passes focus() through once canOperate() is true', () => {
  const terminal = new FakeTerminal();
  guardTerminalFocus(terminal, () => true);

  terminal.onReadyControlMessage();

  assert.equal(terminal.focusCount, 1);
});

test('guardTerminalFocus re-evaluates canOperate() live, e.g. when solo rescue kicks in', () => {
  const terminal = new FakeTerminal();
  let canOperate = false;
  guardTerminalFocus(terminal, () => canOperate);

  terminal.onReadyControlMessage();
  assert.equal(terminal.focusCount, 0, 'blocked while canOperate is false');

  // Solo rescue: everyone else drops offline and the room falls back to
  // unrestricted. The guard must not have latched the earlier false
  // result — the very next call should go through immediately.
  canOperate = true;
  terminal.onReadyControlMessage();

  assert.equal(terminal.focusCount, 1);
});
