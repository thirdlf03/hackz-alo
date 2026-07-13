import {
  INCIDENT_ATTRS,
  INCIDENT_SPAN_NAMES,
  withWorkerSpan,
} from '@incident/observability/worker';
import type {ScenarioDefinition} from '@incident/shared';
import {logStructured} from '../http/requestLog.js';
import type {Bindings} from '../types.js';
import {prepareScenarioSandbox} from './sandboxPrepare.js';
import {getSessionSandbox, withSandboxExecSpan} from './sessionSandbox.js';

export async function startScenarioSandbox(
  env: Bindings,
  sessionId: string,
  scenario: ScenarioDefinition
) {
  const startedAt = Date.now();
  let result: Array<{
    id: string;
    command: string;
    waitForPort?: number;
  }>;
  try {
    result = await withWorkerSpan(
      env,
      INCIDENT_SPAN_NAMES.sandboxStart,
      {
        [INCIDENT_ATTRS.sessionId]: sessionId,
        [INCIDENT_ATTRS.scenarioId]: scenario.id,
      },
      async () => {
        await prepareScenarioSandbox(env, sessionId, scenario);
        const sandbox = getSessionSandbox(env, sessionId);
        const started: Array<{
          id: string;
          command: string;
          waitForPort?: number;
        }> = [];
        for (const process of scenario.startup) {
          await withSandboxExecSpan(
            env,
            sessionId,
            'startup_process',
            async () => {
              const child = await sandbox.startProcess(process.command, {
                processId: process.id,
                cwd: '/workspace',
                autoCleanup: false,
              });
              if (process.waitForPort !== undefined) {
                await child.waitForPort(process.waitForPort, {
                  mode: 'tcp',
                  timeout: 30_000,
                });
              }
            },
            process.id
          );
          started.push({
            id: process.id,
            command: process.command,
            ...(process.waitForPort === undefined
              ? {}
              : {waitForPort: process.waitForPort}),
          });
        }
        return started;
      }
    );
  } catch (error) {
    logStructured('sandbox_start_failed', {
      sessionId,
      scenarioId: scenario.id,
      durationMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  logStructured('sandbox_started', {
    sessionId,
    scenarioId: scenario.id,
    processCount: result.length,
    waitForPortCount: result.filter(
      (process) => process.waitForPort !== undefined
    ).length,
    durationMs: Date.now() - startedAt,
  });
  return result;
}
