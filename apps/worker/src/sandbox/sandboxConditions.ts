import type {SuccessCondition} from '@incident/shared';
import type {Bindings} from '../types.js';
import {buildFaultCommand} from './faultCommands.js';
import {getSessionSandbox, withSandboxExecSpan} from './sessionSandbox.js';
import {buildSuccessCheckCommand} from './successEvaluators.js';

export async function injectFault(
  env: Bindings,
  sessionId: string,
  type: string,
  params: Record<string, unknown>
) {
  const sandbox = getSessionSandbox(env, sessionId);
  await withSandboxExecSpan(env, sessionId, 'fault_inject', async () => {
    await sandbox.exec(buildFaultCommand(type, params));
  });
}

export async function evaluateSuccessCondition(
  env: Bindings,
  sessionId: string,
  condition: SuccessCondition
) {
  const sandbox = getSessionSandbox(env, sessionId);
  const result = await withSandboxExecSpan(
    env,
    sessionId,
    'success_check',
    async () => await sandbox.exec(buildSuccessCheckCommand(condition))
  );
  return result.success;
}
