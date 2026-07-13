import type {Bindings} from '../types.js';
import {logStructured} from '../http/requestLog.js';
import {getSessionSandbox, type SandboxRuntime} from './sessionSandbox.js';

export async function destroySessionSandbox(env: Bindings, sessionId: string) {
  const startedAt = Date.now();
  let killAllProcessesOk = true;
  let destroyOk = true;
  const sandbox = getSessionSandbox(env, sessionId);
  try {
    await sandbox.killAllProcesses();
  } catch {
    // best effort
    killAllProcessesOk = false;
  }
  try {
    await (sandbox as SandboxRuntime & {destroy(): Promise<void>}).destroy();
  } catch {
    // best effort
    destroyOk = false;
  }
  logStructured('sandbox_destroyed', {
    sessionId,
    durationMs: Date.now() - startedAt,
    killAllProcessesOk,
    destroyOk,
  });
}
