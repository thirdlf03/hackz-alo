import {type PtyOptions} from '@cloudflare/sandbox';
import {
  INCIDENT_ATTRS,
  INCIDENT_SPAN_NAMES,
  withWorkerSpan,
} from '@incident/observability/worker';
import type {Bindings} from '../types.js';
import {shellArg} from './pathSafety.js';
import {
  getSessionSandbox,
  type SandboxRuntime,
  withSandboxExecSpan,
} from './sessionSandbox.js';

export async function proxySessionTerminal(
  env: Bindings,
  sessionId: string,
  request: Request,
  options?: PtyOptions
) {
  return await withWorkerSpan(
    env,
    INCIDENT_SPAN_NAMES.sandboxTerminalProxy,
    {
      [INCIDENT_ATTRS.sessionId]: sessionId,
      [INCIDENT_ATTRS.sandboxCommandKind]: 'terminal_upgrade',
    },
    async () =>
      await (
        getSessionSandbox(env, sessionId) as SandboxRuntime & {
          terminal(
            request: Request,
            options?: PtyOptions
          ): Response | Promise<Response>;
        }
      ).terminal(request, options)
  );
}

/**
 * Cloudflare Sandbox 0.12.x PTY (Bun.Terminal) echoes ^C but does not deliver
 * SIGINT to the foreground process group. Send INT to the interactive bash instead.
 */
export async function interruptSessionTerminal(
  env: Bindings,
  sessionId: string
) {
  const sandbox = getSessionSandbox(env, sessionId);
  const script = [
    'for pid in $(pgrep -x bash); do',
    '  args=$(ps -p "$pid" -o args= 2>/dev/null || continue)',
    '  case "$args" in *"--norc"*) continue ;; esac',
    '  pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d " ")',
    '  if [ -n "$pgid" ]; then kill -INT "-$pgid" 2>/dev/null || kill -INT "$pid" 2>/dev/null || true; fi',
    '  break',
    'done',
  ].join('\n');
  await withSandboxExecSpan(env, sessionId, 'terminal_interrupt', async () => {
    await sandbox.exec(`bash -lc ${shellArg(script)}`, {cwd: '/workspace'});
  });
}
