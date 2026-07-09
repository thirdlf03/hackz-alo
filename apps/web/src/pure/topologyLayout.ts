import type {
  ScenarioTopology,
  ScenarioTopologyNodeKind,
} from '@incident/shared';

export interface TopologyLayoutNode {
  id: string;
  label: string;
  kind: ScenarioTopologyNodeKind;
  x: number;
  y: number;
}

export interface TopologyLayoutEdge {
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TopologyLayout {
  nodes: TopologyLayoutNode[];
  edges: TopologyLayoutEdge[];
}

const LAYOUT_MARGIN_X = 56;
const LAYOUT_MARGIN_Y = 32;

/** Layered left-to-right layout: externals seed depth 0, BFS assigns depth via from->to edges. */
export function computeTopologyLayout(
  topology: ScenarioTopology | undefined,
  width: number,
  height: number
): TopologyLayout {
  if (!topology || topology.nodes.length === 0) return {nodes: [], edges: []};

  const depths = assignDepths(topology);
  const maxDepth = Math.max(...depths.values());

  const depthOrder: string[] = [];
  const depthGroups = new Map<number, string[]>();
  for (const node of topology.nodes) {
    const depth = depths.get(node.id) ?? 0;
    const group = depthGroups.get(depth);
    if (group) {
      group.push(node.id);
    } else {
      depthGroups.set(depth, [node.id]);
      depthOrder.push(node.id);
    }
  }

  const columnWidth =
    maxDepth > 0 ? (width - LAYOUT_MARGIN_X * 2) / maxDepth : 0;
  const positions = new Map<string, {x: number; y: number}>();
  for (const [depth, ids] of depthGroups) {
    const x = maxDepth > 0 ? LAYOUT_MARGIN_X + columnWidth * depth : width / 2;
    const rowHeight = (height - LAYOUT_MARGIN_Y * 2) / ids.length;
    ids.forEach((id, index) => {
      const y = LAYOUT_MARGIN_Y + rowHeight * (index + 0.5);
      positions.set(id, {x, y});
    });
  }

  const nodes: TopologyLayoutNode[] = topology.nodes.map((node) => {
    const pos = positions.get(node.id) ?? {x: width / 2, y: height / 2};
    return {
      id: node.id,
      label: node.label,
      kind: node.kind,
      x: pos.x,
      y: pos.y,
    };
  });

  const edges: TopologyLayoutEdge[] = topology.edges.flatMap((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return [];
    return [
      {
        from: edge.from,
        to: edge.to,
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
      },
    ];
  });

  return {nodes, edges};
}

function assignDepths(topology: ScenarioTopology): Map<string, number> {
  const depths = new Map<string, number>();
  const externalIds = topology.nodes
    .filter((node) => node.kind === 'external')
    .map((node) => node.id);
  for (const id of externalIds) depths.set(id, 0);

  let frontier = externalIds;
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      const depth = depths.get(id) ?? 0;
      for (const edge of topology.edges) {
        if (edge.from !== id || depths.has(edge.to)) continue;
        depths.set(edge.to, depth + 1);
        next.push(edge.to);
      }
    }
    frontier = next;
  }

  // Nodes unreachable from any external node (isolated or disconnected) fall back to depth 0.
  for (const node of topology.nodes) {
    if (!depths.has(node.id)) depths.set(node.id, 0);
  }

  return depths;
}
