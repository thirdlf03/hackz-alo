import {
  INCIDENT_ATTRS,
  INCIDENT_SPAN_NAMES,
  withWorkerSpan,
} from '@incident/observability/worker';
import type {ScenarioDefinition} from '@incident/shared';
import type {Bindings} from '../types.js';
import {installSandboxAssets} from './assets.js';
import {shellArg} from './pathSafety.js';
import type {SandboxFileApi} from './sessionData.js';
import {
  getSessionSandbox,
  type SandboxRuntime,
  withSandboxExecSpan,
} from './sessionSandbox.js';

const SANDBOX_PREPARED_MARKER = '/workspace/run/.incident-prepared.json';

export interface SandboxPrepareResult {
  prepared: true;
  reused: boolean;
}

export async function prepareScenarioSandbox(
  env: Bindings,
  sessionId: string,
  scenario: ScenarioDefinition
): Promise<SandboxPrepareResult> {
  return await withWorkerSpan(
    env,
    INCIDENT_SPAN_NAMES.sandboxPrepare,
    {
      [INCIDENT_ATTRS.sessionId]: sessionId,
      [INCIDENT_ATTRS.scenarioId]: scenario.id,
    },
    async (span) => {
      const sandbox = getSessionSandbox(env, sessionId);
      const reused = await isSandboxPrepared(sandbox, scenario.id);
      span.setAttribute(INCIDENT_ATTRS.cached, reused);
      if (reused) return {prepared: true, reused};

      await installSandboxAssets(sandbox);
      await withSandboxExecSpan(env, sessionId, 'sandbox_setup', async () => {
        await sandbox.exec(
          'mkdir -p /workspace/logs /workspace/run /workspace/run/metrics /workspace/etc /workspace/releases && ' +
            'rm -f /workspace/logs/debug.log /workspace/logs/batch.log /workspace/logs/deploy.log ' +
            '/workspace/etc/yamabiko-api.json /workspace/etc/monitoring.json ' +
            '/workspace/run/metrics/agent.json && ' +
            "(pkill -f 'report-batch.mjs' || true) && (pkill -f 'legacy-metrics-agent.mjs' || true) && " +
            "(pkill -f 'monitor-agent/agent.mjs' || true) && (pkill -f 'alert-flood-daemon.mjs' || true) && " +
            "(pkill -f 'loadgen.mjs' || true)",
          {cwd: '/workspace'}
        );
      });
      await (sandbox as SandboxFileApi).writeFile(
        SANDBOX_PREPARED_MARKER,
        JSON.stringify({
          scenarioId: scenario.id,
          preparedAt: new Date().toISOString(),
        })
      );
      return {prepared: true, reused};
    }
  );
}

async function isSandboxPrepared(
  sandbox: SandboxRuntime,
  scenarioId: string
): Promise<boolean> {
  try {
    const result = await sandbox.exec(
      `if [ -f ${shellArg(SANDBOX_PREPARED_MARKER)} ]; then cat ${shellArg(
        SANDBOX_PREPARED_MARKER
      )}; fi`,
      {cwd: '/workspace'}
    );
    if (!result.success || !result.stdout.trim()) return false;
    const marker = JSON.parse(result.stdout) as {scenarioId?: unknown};
    return marker.scenarioId === scenarioId;
  } catch {
    return false;
  }
}
