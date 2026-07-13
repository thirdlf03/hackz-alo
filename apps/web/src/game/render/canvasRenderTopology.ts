import type {
  ScenarioTopology,
  ScenarioTopologyNodeKind,
  ServiceHealth,
} from '@incident/shared';
import {
  clamp,
  roundRect,
  truncateToWidth,
  withAlpha,
} from './canvasDrawUtils.js';
import {fontFloor, gamePalette as palette, uiFont} from './gamePalette.js';
import {
  computeTopologyLayout,
  type TopologyLayout,
  type TopologyLayoutEdge,
  type TopologyLayoutNode,
} from '../../pure/topologyLayout.js';
import type {CanvasRenderSurface} from './canvasRenderSurface.js';

const NODE_RADIUS = 18;
const SERVICE_WIDTH = 84;
const SERVICE_HEIGHT = 36;
const DATASTORE_WIDTH = 56;
const DATASTORE_HEIGHT = 40;
const DATASTORE_CAP_RY = 7;
const LABEL_MAX_WIDTH = 96;

const PULSE_PERIOD_HEALTHY_MS = 1500;
const PULSE_PERIOD_DEGRADED_MS = 700;
const PULSE_PERIOD_DOWN_MS = 380;
const FLASH_DURATION_MS = 550;
const PARTICLE_PERIOD_MS = 1400;
const PARTICLE_MAX_TOTAL = 12;

/** Draws the always-on service dependency map for the metrics monitor's upper slice. */
export function drawTopologyMap(
  surface: CanvasRenderSurface,
  topology: ScenarioTopology | undefined,
  serviceHealth: Record<string, ServiceHealth> | undefined,
  nowMs: number,
  width: number,
  height: number
) {
  if (!topology || topology.nodes.length === 0) return;
  const layout = computeTopologyLayout(topology, width, height);
  drawEdges(surface.ctx, layout, serviceHealth, nowMs);
  drawNodes(surface, layout, serviceHealth, nowMs);
}

function resolveHealth(
  serviceHealth: Record<string, ServiceHealth> | undefined,
  id: string
): ServiceHealth {
  return serviceHealth?.[id] ?? 'healthy';
}

function healthColor(health: ServiceHealth) {
  if (health === 'down') return palette.statusCritical;
  if (health === 'degraded') return palette.statusWarn;
  return palette.statusHealthy;
}

function sinPulse(nowMs: number, periodMs: number, phase: number) {
  return 0.5 + 0.5 * Math.sin((nowMs / periodMs + phase) * Math.PI * 2);
}

function boundingRadius(kind: ScenarioTopologyNodeKind) {
  if (kind === 'service') return 30;
  if (kind === 'datastore') return 28;
  return NODE_RADIUS + 6;
}

// --- Edges + flowing particles -------------------------------------------

function particleProgress(nowMs: number, periodMs: number, offset: number) {
  const t = (nowMs / periodMs + offset) % 1;
  return t < 0 ? t + 1 : t;
}

function drawEdges(
  ctx: CanvasRenderingContext2D,
  layout: TopologyLayout,
  serviceHealth: Record<string, ServiceHealth> | undefined,
  nowMs: number
) {
  const particlesPerEdge = layout.edges.length * 2 > PARTICLE_MAX_TOTAL ? 1 : 2;

  layout.edges.forEach((edge, edgeIndex) => {
    drawEdgeLine(ctx, edge);

    const fromHealth = resolveHealth(serviceHealth, edge.from);
    if (fromHealth === 'down') return;
    const toHealth = resolveHealth(serviceHealth, edge.to);

    for (
      let particleIndex = 0;
      particleIndex < particlesPerEdge;
      particleIndex += 1
    ) {
      drawEdgeParticle(
        ctx,
        edge,
        toHealth,
        nowMs,
        edgeIndex * 0.37 + particleIndex / particlesPerEdge
      );
    }
  });
}

function drawEdgeLine(ctx: CanvasRenderingContext2D, edge: TopologyLayoutEdge) {
  ctx.strokeStyle = withAlpha(palette.textMuted, 0.32);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(edge.x1, edge.y1);
  ctx.lineTo(edge.x2, edge.y2);
  ctx.stroke();
}

function drawEdgeParticle(
  ctx: CanvasRenderingContext2D,
  edge: TopologyLayoutEdge,
  toHealth: ServiceHealth,
  nowMs: number,
  offset: number
) {
  const progress = particleProgress(nowMs, PARTICLE_PERIOD_MS, offset);
  // Jam near the endpoint when the downstream node is dead: decelerate and fade out past 70%.
  const jamming = toHealth === 'down' && progress > 0.7;
  const alpha = jamming ? clamp(1 - (progress - 0.7) / 0.3, 0, 1) : 1;
  if (alpha <= 0) return;

  const displayProgress = jamming
    ? 0.7 + (1 - (1 - (progress - 0.7) / 0.3) ** 3) * 0.15
    : progress;

  const px = edge.x1 + (edge.x2 - edge.x1) * displayProgress;
  const py = edge.y1 + (edge.y2 - edge.y1) * displayProgress;
  ctx.fillStyle = withAlpha(healthColor(toHealth), alpha);
  ctx.beginPath();
  ctx.arc(px, py, 3, 0, Math.PI * 2);
  ctx.fill();
}

// --- Nodes ------------------------------------------------------------

function drawNodes(
  surface: CanvasRenderSurface,
  layout: TopologyLayout,
  serviceHealth: Record<string, ServiceHealth> | undefined,
  nowMs: number
) {
  layout.nodes.forEach((node, index) => {
    const health = resolveHealth(serviceHealth, node.id);
    const flashAlpha = updateFlashState(surface, node.id, health, nowMs);
    const phase = index * 0.21;

    drawNodeShape(surface.ctx, node, health, nowMs, phase);
    if (flashAlpha > 0) drawNodeFlash(surface.ctx, node, flashAlpha);
    drawNodeLabel(surface.ctx, node);
  });
}

/** Tracks the previous health per node and returns the current revive-flash alpha. */
function updateFlashState(
  surface: CanvasRenderSurface,
  nodeId: string,
  health: ServiceHealth,
  nowMs: number
) {
  const cached = surface.topologyHealthCache.get(nodeId);
  const revived = cached && cached.health !== 'healthy' && health === 'healthy';
  const flashUntilMs = revived
    ? nowMs + FLASH_DURATION_MS
    : (cached?.flashUntilMs ?? 0);
  surface.topologyHealthCache.set(nodeId, {health, flashUntilMs});
  return clamp((flashUntilMs - nowMs) / FLASH_DURATION_MS, 0, 1);
}

function nodeFillAlpha(health: ServiceHealth, nowMs: number, phase: number) {
  if (health === 'down') {
    return 0.45 + 0.55 * sinPulse(nowMs, PULSE_PERIOD_DOWN_MS, phase);
  }
  if (health === 'degraded') {
    return 0.6 + 0.4 * sinPulse(nowMs, PULSE_PERIOD_DEGRADED_MS, phase);
  }
  return 1;
}

function drawNodeShape(
  ctx: CanvasRenderingContext2D,
  node: TopologyLayoutNode,
  health: ServiceHealth,
  nowMs: number,
  phase: number
) {
  const radius = boundingRadius(node.kind);
  if (health === 'healthy') drawHealthyGlow(ctx, node, nowMs, phase, radius);
  if (health === 'down') drawDownRing(ctx, node, nowMs, phase, radius);

  const color = healthColor(health);
  const alpha = nodeFillAlpha(health, nowMs, phase);
  ctx.fillStyle = withAlpha(color, alpha);
  ctx.strokeStyle = withAlpha(color, Math.min(1, alpha + 0.2));
  ctx.lineWidth = 1.5;

  if (node.kind === 'external') {
    ctx.beginPath();
    ctx.arc(node.x, node.y, NODE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (node.kind === 'service') {
    roundRect(
      ctx,
      node.x - SERVICE_WIDTH / 2,
      node.y - SERVICE_HEIGHT / 2,
      SERVICE_WIDTH,
      SERVICE_HEIGHT,
      8
    );
    ctx.fill();
    ctx.stroke();
  } else if (node.kind === 'datastore') {
    drawDatastoreShape(ctx, node.x, node.y);
  } else {
    drawBatchShape(ctx, node.x, node.y);
  }
}

function drawHealthyGlow(
  ctx: CanvasRenderingContext2D,
  node: TopologyLayoutNode,
  nowMs: number,
  phase: number,
  radius: number
) {
  const glowAlpha =
    0.12 + 0.18 * sinPulse(nowMs, PULSE_PERIOD_HEALTHY_MS, phase);
  ctx.fillStyle = withAlpha(palette.statusHealthy, glowAlpha);
  ctx.beginPath();
  ctx.arc(node.x, node.y, radius + 8, 0, Math.PI * 2);
  ctx.fill();
}

function drawDownRing(
  ctx: CanvasRenderingContext2D,
  node: TopologyLayoutNode,
  nowMs: number,
  phase: number,
  radius: number
) {
  const ringAlpha =
    0.35 + 0.35 * sinPulse(nowMs, PULSE_PERIOD_DOWN_MS, phase + 0.25);
  ctx.strokeStyle = withAlpha(palette.statusCritical, ringAlpha);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(node.x, node.y, radius + 8, 0, Math.PI * 2);
  ctx.stroke();
}

function drawDatastoreShape(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number
) {
  const halfW = DATASTORE_WIDTH / 2;
  const halfH = DATASTORE_HEIGHT / 2;

  ctx.fillRect(
    cx - halfW,
    cy - halfH + DATASTORE_CAP_RY,
    DATASTORE_WIDTH,
    halfH * 2 - DATASTORE_CAP_RY
  );
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy - halfH + DATASTORE_CAP_RY,
    halfW,
    DATASTORE_CAP_RY,
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy + halfH - DATASTORE_CAP_RY,
    halfW,
    DATASTORE_CAP_RY,
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(cx - halfW, cy - halfH + DATASTORE_CAP_RY);
  ctx.lineTo(cx - halfW, cy + halfH - DATASTORE_CAP_RY);
  ctx.moveTo(cx + halfW, cy - halfH + DATASTORE_CAP_RY);
  ctx.lineTo(cx + halfW, cy + halfH - DATASTORE_CAP_RY);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy - halfH + DATASTORE_CAP_RY,
    halfW,
    DATASTORE_CAP_RY,
    0,
    0,
    Math.PI * 2
  );
  ctx.stroke();
}

function drawBatchShape(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.beginPath();
  ctx.arc(cx, cy, NODE_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.save();
  ctx.strokeStyle = palette.textPrimary;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, cy - NODE_RADIUS * 0.55);
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + NODE_RADIUS * 0.4, cy + NODE_RADIUS * 0.25);
  ctx.stroke();
  ctx.restore();
}

function drawNodeFlash(
  ctx: CanvasRenderingContext2D,
  node: TopologyLayoutNode,
  alpha: number
) {
  const radius = boundingRadius(node.kind) + 4;
  ctx.fillStyle = withAlpha(palette.textBadge, alpha * 0.85);
  ctx.beginPath();
  ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawNodeLabel(
  ctx: CanvasRenderingContext2D,
  node: TopologyLayoutNode
) {
  ctx.font = uiFont(fontFloor);
  ctx.fillStyle = palette.textSecondary;
  const label = truncateToWidth(ctx, node.label, LABEL_MAX_WIDTH);
  const width = ctx.measureText(label).width;
  const labelY = node.y + boundingRadius(node.kind) + 16;
  ctx.fillText(label, node.x - width / 2, labelY);
}
