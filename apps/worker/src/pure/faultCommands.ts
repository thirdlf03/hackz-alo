import {shellArg} from './pathSafety.js';

const FAULT_INJECTOR = 'node /workspace/bin/fault-injector.mjs';

export type FaultCommandBuilder = (params: Record<string, unknown>) => string;

export const faultCommandBuilders: Record<string, FaultCommandBuilder> = {
  process_stop: (params) =>
    `${FAULT_INJECTOR} process_stop ${shellArg(coerceString(params.processId, 'api'))}`,

  disk_full: (params) =>
    `${FAULT_INJECTOR} disk_full ${shellArg(coerceString(params.path, '/workspace/logs/debug.log'))} ${String(coerceNumber(params.bytes, 67108864))}`,

  kodama_batch_failure: (params) => {
    const batchPath = coerceString(
      params.path,
      '/workspace/services/batch/sales.kdm'
    );
    const jobId = coerceString(params.jobId, 'sales-nightly');
    const specFlag = coerceBoolean(params.specInComments)
      ? ' spec-in-comments'
      : '';
    return `${FAULT_INJECTOR} kodama_batch_failure ${shellArg(batchPath)} ${shellArg(jobId)}${specFlag}`;
  },

  queue_backlog: (params) =>
    `${FAULT_INJECTOR} queue_backlog ${String(coerceNumber(params.count, 32))}`,

  bad_deploy: (params) =>
    `${FAULT_INJECTOR} bad_deploy ${shellArg(coerceString(params.configPath, '/workspace/run/deploy.json'))}`,

  db_pool_exhaust: (params) =>
    `${FAULT_INJECTOR} db_pool_exhaust ${String(coerceNumber(params.maxConnections, 40))}`,

  memory_leak: (params) =>
    `${FAULT_INJECTOR} memory_leak ${String(coerceNumber(params.targetPercent, 92))}`,

  dns_misconfig: (params) =>
    `${FAULT_INJECTOR} dns_misconfig ${shellArg(coerceString(params.hostsPath, '/workspace/run/hosts.override'))}`,

  monitor_blind: (params) =>
    `${FAULT_INJECTOR} monitor_blind ${shellArg(JSON.stringify(params.blindMetrics ?? ['cpu', 'memory']))}`,

  composite_restart_loop: (params) =>
    `${FAULT_INJECTOR} composite_restart_loop ${shellArg(coerceString(params.diskPath, '/workspace/logs/debug.log'))} ${String(coerceNumber(params.bytes, 67108864))} ${shellArg(coerceString(params.processId, 'api'))}`,

  janitor_power_pull: (params) =>
    `${FAULT_INJECTOR} janitor_power_pull ${shellArg(coerceString(params.processId, 'api'))}`,

  cable_jumprope: (params) =>
    `${FAULT_INJECTOR} cable_jumprope ${shellArg(coerceString(params.hostsPath, '/workspace/run/hosts.override'))}`,

  keyboard_spill: (params) =>
    `${FAULT_INJECTOR} keyboard_spill ${shellArg(coerceString(params.noise, 'べちゃっxべちゃっ'))}`,

  alert_spam: (params) =>
    `${FAULT_INJECTOR} alert_spam ${String(coerceNumber(params.count, 24))}`,

  runbook_gaslight: (params) =>
    `${FAULT_INJECTOR} runbook_gaslight ${shellArg(coerceString(params.replacement, '気合いで直す。根性。深呼吸。'))}`,
};

export function buildFaultCommand(
  type: string,
  params: Record<string, unknown>
) {
  const builder = faultCommandBuilders[type];
  if (!builder) throw new Error(`unknown fault type: ${type}`);
  return builder(params);
}

function coerceString(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return fallback;
}

function coerceNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function coerceBoolean(value: unknown): boolean {
  return value === true;
}
