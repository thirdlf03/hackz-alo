import type {Bindings} from '../types.js';
import {getSessionSandbox, type SandboxRuntime} from './sessionSandbox.js';

export async function destroySessionSandbox(env: Bindings, sessionId: string) {
  const sandbox = getSessionSandbox(env, sessionId);
  try {
    await sandbox.killAllProcesses();
  } catch {
    // best effort
  }
  try {
    await (sandbox as SandboxRuntime & {destroy(): Promise<void>}).destroy();
  } catch {
    // best effort
  }
}
