import {getSandbox, type Sandbox} from '@cloudflare/sandbox';
import {
  INCIDENT_ATTRS,
  INCIDENT_SPAN_NAMES,
  withWorkerSpan,
} from '@incident/observability/worker';
import type {Bindings} from '../types.js';

export type SandboxRuntime = Sandbox;

const DEFAULT_SANDBOX_SLEEP_AFTER = '16m';

export function getSessionSandbox(
  env: Bindings,
  sessionId: string
): SandboxRuntime {
  return getSandbox(env.Sandbox, sessionSandboxName(sessionId), {
    sleepAfter: sandboxSleepAfter(env),
  });
}

export async function withSandboxExecSpan<T>(
  env: Bindings,
  sessionId: string,
  commandKind: string,
  run: () => T | Promise<T>,
  processId?: string
): Promise<T> {
  return await withWorkerSpan(
    env,
    INCIDENT_SPAN_NAMES.sandboxExec,
    {
      [INCIDENT_ATTRS.sessionId]: sessionId,
      [INCIDENT_ATTRS.sandboxCommandKind]: commandKind,
      [INCIDENT_ATTRS.sandboxProcessId]: processId,
    },
    async () => await run()
  );
}

function sandboxSleepAfter(env: Bindings) {
  const configured = env.INCIDENT_SANDBOX_SLEEP_AFTER?.trim();
  return configured || DEFAULT_SANDBOX_SLEEP_AFTER;
}

function sessionSandboxName(sessionId: string) {
  return `session-${sessionId}`;
}
