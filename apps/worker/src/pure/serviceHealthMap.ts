import type {
  ScenarioTopology,
  ScenarioTrigger,
  ServiceHealth,
} from '@incident/shared';

export function computeServiceHealthMap(
  topology: ScenarioTopology | undefined,
  firedTriggers: ScenarioTrigger[],
  resolved: boolean
): Record<string, ServiceHealth> {
  if (!topology) return {};

  const health: Record<string, ServiceHealth> = {};
  for (const node of topology.nodes) {
    health[node.id] = 'healthy';
  }
  if (resolved) return health;

  const downProcessIds = new Set<string>();
  for (const trigger of firedTriggers) {
    const processId = triggerProcessId(trigger);
    if (processId) downProcessIds.add(processId);
  }

  const downNodeIds: string[] = [];
  for (const node of topology.nodes) {
    if (node.processId && downProcessIds.has(node.processId)) {
      health[node.id] = 'down';
      downNodeIds.push(node.id);
    }
  }
  if (downNodeIds.length === 0) return health;

  const callers = new Map<string, string[]>();
  for (const edge of topology.edges) {
    const list = callers.get(edge.to);
    if (list) list.push(edge.from);
    else callers.set(edge.to, [edge.from]);
  }

  const queue = [...downNodeIds];
  while (queue.length > 0) {
    const nodeId = queue.shift() as string;
    for (const callerId of callers.get(nodeId) ?? []) {
      if (health[callerId] === 'down') continue;
      if (health[callerId] === 'degraded') continue;
      health[callerId] = 'degraded';
      queue.push(callerId);
    }
  }

  return health;
}

export interface ServiceHealthChange {
  nodeId: string;
  health: ServiceHealth;
  label: string;
}

export function diffServiceHealth(
  before: Record<string, ServiceHealth>,
  after: Record<string, ServiceHealth>,
  topology: ScenarioTopology | undefined
): ServiceHealthChange[] {
  if (!topology) return [];

  const changes: ServiceHealthChange[] = [];
  for (const node of topology.nodes) {
    const nextHealth = after[node.id] ?? 'healthy';
    if (before[node.id] !== nextHealth) {
      changes.push({
        nodeId: node.id,
        health: nextHealth,
        label: node.label,
      });
    }
  }
  return changes;
}

function triggerProcessId(trigger: ScenarioTrigger): string | undefined {
  const params = trigger.params as Record<string, unknown> | undefined;
  const processId = params?.processId;
  return typeof processId === 'string' ? processId : undefined;
}
