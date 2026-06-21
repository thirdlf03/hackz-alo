import type { GameRenderState, MetricsSnapshot, MetricsSource, ScenarioDefinition } from "@incident/shared";
import { mergedSlackMessages, unreadNotificationCount } from "../state/gameState.js";
import { parseAnsiLine, stripAnsi, type AnsiSpan } from "../terminal/ansi.js";
import officeMonitorBackdropUrl from "../../assets/office-monitor-backdrop.avif";
import {
  gamePalette as palette,
  toneColor,
  severityColor,
  uiFont,
  monoFont,
  type MetricTone
} from "./gamePalette.js";

const logicalWidth = 1920;
const logicalHeight = 1080;
const monitorContentWidth = 496;
const monitorContentHeight = 540;
const terminalContentWidth = 496;
const worldPanelHeight = 148;
const runbookContentX = 1332;
const runbookContentY = 204;

const RUNBOOK_TAB_HEIGHT = 40;
const RUNBOOK_TAB_MIN_WIDTH = 132;
const RUNBOOK_TAB_MAX_WIDTH = 240;
const RUNBOOK_TAB_GAP = 8;
const RUNBOOK_TAB_PAD_X = 16;
const RUNBOOK_TAB_HIT_PAD = 8;
const RUNBOOK_CONTENT_GAP = 28;

const RIGHT_PANEL_PRIMARY_TABS = [
  { id: "runbook" as const, label: "Runbook", width: 108 },
  { id: "slack" as const, label: "Slack", width: 88 }
];
const RIGHT_PANEL_PRIMARY_TAB_HEIGHT = 40;
const RIGHT_PANEL_SECONDARY_TAB_HEIGHT = 40;
const RIGHT_PANEL_TAB_ROW_GAP = 8;
const RIGHT_PANEL_COMPOSE_HEIGHT = 44;
const RIGHT_PANEL_COMPOSE_PADDING = 16;
const CENTER_TOOL_TAB_WIDTH = 118;
const CENTER_TOOL_TAB_HEIGHT = 34;
const CENTER_TOOL_TAB_GAP = 8;

type RightPanelTab = "runbook" | "slack";

function rightPanelLayout(
  difficulty: GameRenderState["session"]["difficulty"],
  activeTab: RightPanelTab,
  hasRunbooks: boolean
) {
  const worldHeight = runbookWorldOffset(difficulty);
  const primaryTop = worldHeight;
  const secondaryTop = primaryTop + RIGHT_PANEL_PRIMARY_TAB_HEIGHT + RIGHT_PANEL_TAB_ROW_GAP;
  const runbookContentTop = hasRunbooks
    ? secondaryTop + RIGHT_PANEL_SECONDARY_TAB_HEIGHT + RUNBOOK_CONTENT_GAP
    : primaryTop + RIGHT_PANEL_PRIMARY_TAB_HEIGHT + RUNBOOK_CONTENT_GAP;
  const slackMessagesTop = primaryTop + RIGHT_PANEL_PRIMARY_TAB_HEIGHT + RUNBOOK_CONTENT_GAP;
  const composeTop = monitorContentHeight - RIGHT_PANEL_COMPOSE_HEIGHT - RIGHT_PANEL_COMPOSE_PADDING;

  return {
    worldHeight,
    primaryTop,
    secondaryTop,
    contentTop: activeTab === "runbook" ? runbookContentTop : slackMessagesTop,
    composeTop,
    slackMessagesTop,
    slackMessagesBottom: composeTop - 12
  };
}

let runbookTabMeasureCtx: CanvasRenderingContext2D | null | undefined;

function runbookTabMeasureTextWidth(text: string) {
  if (typeof document !== "undefined") {
    if (runbookTabMeasureCtx === undefined) {
      const canvas = document.createElement("canvas");
      runbookTabMeasureCtx = canvas.getContext("2d");
    }
    if (runbookTabMeasureCtx) {
      runbookTabMeasureCtx.font = uiFont(16);
      return runbookTabMeasureCtx.measureText(text).width;
    }
  }
  return text.length * 16;
}

export function measureRunbookTabWidth(title: string, measure?: (text: string) => number) {
  const width = (measure ?? runbookTabMeasureTextWidth)(title);
  return Math.max(
    RUNBOOK_TAB_MIN_WIDTH,
    Math.min(RUNBOOK_TAB_MAX_WIDTH, width + RUNBOOK_TAB_PAD_X * 2)
  );
}

function showWorldPanel(difficulty: GameRenderState["session"]["difficulty"]) {
  return difficulty === "advanced";
}

function runbookWorldOffset(difficulty: GameRenderState["session"]["difficulty"]) {
  return showWorldPanel(difficulty) ? worldPanelHeight : 0;
}

export type MonitorId = "metrics" | "terminal" | "runbook";

export const monitorLayouts = [
  { id: "metrics" as const, x: 70, y: 140, width: 540, height: 620, title: "METRICS" },
  { id: "terminal" as const, x: 690, y: 140, width: 540, height: 620, title: "TERMINAL" },
  { id: "runbook" as const, x: 1310, y: 140, width: 540, height: 620, title: "RUNBOOK / SLACK" }
] as const;

export const expandedMonitorLayout = { x: 260, y: 50, width: 1400, height: 780 } as const;

function monitorContentRegion(monitor: { x: number; y: number; width: number; height: number }) {
  return {
    x: monitor.x + 22,
    y: monitor.y + 64,
    width: monitor.width - 44,
    height: monitor.height - 80
  };
}

function runbookContentTransform(expandedRunbook: boolean) {
  const monitor = monitorLayouts.find((item) => item.id === "runbook")!;
  const frameX = expandedRunbook ? expandedMonitorLayout.x : monitor.x;
  const frameY = expandedRunbook ? expandedMonitorLayout.y : monitor.y;
  const frameWidth = expandedRunbook ? expandedMonitorLayout.width : monitor.width;
  const frameHeight = expandedRunbook ? expandedMonitorLayout.height : monitor.height;
  const contentWidth = frameWidth - 44;
  const contentHeight = frameHeight - 80;
  const scale = Math.min(contentWidth / monitorContentWidth, contentHeight / monitorContentHeight);
  return {
    x: frameX + 22,
    y: frameY + 64,
    scale
  };
}

export const monitorMagnifyRegions = monitorLayouts.map((monitor) => ({
  id: monitor.id,
  x: monitor.x + monitor.width - 50,
  y: monitor.y + 4,
  width: 44,
  height: 44
}));

const monitorPoses: Record<MonitorId, { scaleX: number }> = {
  metrics: { scaleX: 0.958 },
  terminal: { scaleX: 1 },
  runbook: { scaleX: 0.958 }
};

const METRICS_BANNER_HEIGHT = 40;
const METRICS_SCROLL_TOP = 56;

export class CanvasRenderer {
  private ctx: CanvasRenderingContext2D;
  private staticCanvas: HTMLCanvasElement;
  private staticCtx: CanvasRenderingContext2D;
  private roomBackdrop: HTMLImageElement;
  private roomBackdropLoaded = false;
  private lastRendered?: { state: GameRenderState; scenario?: ScenarioDefinition };
  private terminalLineCache = new Map<string, { spans: AnsiSpan[]; plain: string }>();
  private metricsScrollY = 0;
  private metricsScrollMax = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d canvas is required");
    this.ctx = ctx;
    this.canvas.width = logicalWidth;
    this.canvas.height = logicalHeight;
    this.staticCanvas = document.createElement("canvas");
    this.staticCanvas.width = logicalWidth;
    this.staticCanvas.height = logicalHeight;
    const staticCtx = this.staticCanvas.getContext("2d");
    if (!staticCtx) throw new Error("2d canvas is required");
    this.staticCtx = staticCtx;
    this.roomBackdrop = new Image();
    this.roomBackdrop.onload = () => {
      this.roomBackdropLoaded = true;
      this.drawStaticLayer();
      if (this.lastRendered) this.draw(this.lastRendered.state, this.lastRendered.scenario);
    };
    this.roomBackdrop.src = officeMonitorBackdropUrl;
    this.drawStaticLayer();
  }

  scrollMetricsPanel(deltaY: number) {
    if (this.metricsScrollMax <= 0) return false;
    const next = clamp(this.metricsScrollY + deltaY, 0, this.metricsScrollMax);
    if (next === this.metricsScrollY) return false;
    this.metricsScrollY = next;
    if (this.lastRendered) this.draw(this.lastRendered.state, this.lastRendered.scenario);
    return true;
  }

  draw(state: GameRenderState, scenario?: ScenarioDefinition) {
    this.lastRendered = scenario ? { state, scenario } : { state };
    const ctx = this.ctx;
    ctx.save();
    try {
      ctx.setTransform(this.canvas.width / logicalWidth, 0, 0, this.canvas.height / logicalHeight, 0, 0);
      ctx.clearRect(0, 0, logicalWidth, logicalHeight);
      ctx.drawImage(this.staticCanvas, 0, 0);
      this.drawHeader(state);
      for (const monitor of monitorLayouts) {
        this.withMonitorPose(monitor, () => {
          this.drawMonitor(monitor.x, monitor.y, monitor.width, monitor.height, monitor.title, (content) => {
            if (monitor.id === "metrics") this.drawMetricsPanel(state.monitors.left, content.height);
            else if (monitor.id === "terminal") this.drawCenterPanel(state, content.width);
            else this.drawRightPanel(state, scenario);
          });
        });
      }
      this.drawCenterToolTabs(state);
      this.drawMonitorMagnifyIcons();
      this.drawAlerts(state);
      if (state.warning && state.warning.flashMs > 0) this.drawCommandWarning(state.warning);
      if (showWorldPanel(state.session.difficulty) && state.world.redBullFlyingMs > 0) {
        this.drawRedBullFlying(state.world.redBullFlyingMs);
      }
      this.drawNavigationOverlay(state, scenario);
      this.drawInputDock(state);
      this.drawNotifications(state);
      if (state.world.expandedMonitor) this.drawExpandedMonitorOverlay(state, scenario);
      this.drawCursor(state);
    } finally {
      ctx.restore();
    }
  }

  private drawStaticLayer() {
    const previous = this.ctx;
    this.ctx = this.staticCtx;
    try {
      this.ctx.clearRect(0, 0, logicalWidth, logicalHeight);
      this.drawRoom();
      for (const monitor of monitorLayouts) {
        this.withMonitorPose(monitor, () => {
          this.drawMonitorFrame(monitor.x, monitor.y, monitor.width, monitor.height, monitor.title);
        });
      }
    } finally {
      this.ctx = previous;
    }
  }

  private drawRoom() {
    this.ctx.fillStyle = palette.bgRoomBottom;
    this.ctx.fillRect(0, 0, logicalWidth, logicalHeight);

    if (this.roomBackdropLoaded) {
      drawCoverImage(this.ctx, this.roomBackdrop, 0, 0, logicalWidth, 840);
      this.ctx.fillStyle = "rgba(5, 6, 9, 0.38)";
      this.ctx.fillRect(0, 0, logicalWidth, 840);
    } else {
      this.ctx.fillStyle = palette.bgRoomTop;
      this.ctx.fillRect(0, 0, logicalWidth, 840);
    }

    this.ctx.fillStyle = palette.bgDesk;
    this.ctx.fillRect(0, 840, logicalWidth, 240);
    this.ctx.fillStyle = "rgba(255, 255, 255, 0.035)";
    this.ctx.fillRect(0, 838, logicalWidth, 2);
  }

  private withMonitorPose(monitor: (typeof monitorLayouts)[number], draw: () => void) {
    const pose = monitorPoses[monitor.id];
    if (pose.scaleX === 1) {
      draw();
      return;
    }

    const centerX = monitor.x + monitor.width / 2;
    const centerY = monitor.y + monitor.height / 2 + 36;
    this.ctx.save();
    this.ctx.translate(centerX, centerY);
    this.ctx.scale(pose.scaleX, 1);
    this.ctx.translate(-centerX, -centerY);
    draw();
    this.ctx.restore();
  }

  private drawHeader(state: GameRenderState) {
    this.ctx.fillStyle = palette.textPrimary;
    this.ctx.font = uiFont(32);
    this.ctx.fillText(state.session.scenarioTitle, 70, 70);
    this.ctx.font = uiFont(24);
    this.ctx.fillStyle = palette.textSecondary;
    this.ctx.fillText(
      `${formatDifficulty(state.session.difficulty)} / ${formatTime(state.clock.elapsedMs)} / ${formatTime(state.clock.timeLimitMs)} / ${state.clock.speed}x`,
      70,
      108
    );
    this.ctx.fillStyle = palette.textClock;
    this.ctx.font = monoFont(26, "bold");
    this.ctx.fillText(formatNarrativeClock(state.world.narrativeHour), 1280, 70);
    this.ctx.fillStyle = state.recording.saveEnabled
      ? state.recording.status === "recording"
        ? palette.statusRecording
        : palette.textMuted
      : palette.textMuted;
    this.ctx.beginPath();
    this.ctx.arc(1770, 70, 12, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.fillStyle = palette.textPrimary;
    this.ctx.font = uiFont(24);
    this.ctx.fillText(formatRecordingStatus(state.recording.status, state.recording.saveEnabled), 1792, 78);
  }

  private drawNotifications(state: GameRenderState) {
    const unread = unreadNotificationCount(state);
    const bell = notificationBellRegion;
    const pulsing = state.notifications.pulseMs > 0;

    if (pulsing) {
      const ringOpacity = Math.min(0.55, state.notifications.pulseMs / 2400);
      this.ctx.strokeStyle = `rgba(248, 113, 113, ${ringOpacity})`;
      this.ctx.lineWidth = 3;
      this.ctx.beginPath();
      this.ctx.arc(bell.x + bell.width / 2, bell.y + bell.height / 2, bell.width * 0.62, 0, Math.PI * 2);
      this.ctx.stroke();
    }

    this.ctx.fillStyle = pulsing ? palette.bgButtonDanger : palette.bgCard;
    roundRect(this.ctx, bell.x, bell.y, bell.width, bell.height, 10);
    this.ctx.fill();
    this.ctx.strokeStyle = unread > 0 ? palette.borderUnread : palette.textMuted;
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    this.drawBellGlyph(bell.x + bell.width / 2, bell.y + bell.height / 2 - 2, unread > 0 || pulsing);

    if (unread > 0) {
      const badge = String(Math.min(unread, 9));
      const badgeWidth = badge.length > 1 ? 28 : 22;
      this.ctx.fillStyle = palette.statusCritical;
      roundRect(this.ctx, bell.x + bell.width - badgeWidth + 4, bell.y - 4, badgeWidth, 22, 11);
      this.ctx.fill();
      this.ctx.fillStyle = palette.textBadge;
      this.ctx.font = uiFont(14, "bold");
      this.ctx.fillText(badge, bell.x + bell.width - badgeWidth + 11, bell.y + 12);
    }

    if (state.notifications.panelOpen) {
      this.drawNotificationPanel(state);
    }
  }

  private drawBellGlyph(cx: number, cy: number, active: boolean) {
    this.ctx.save();
    this.ctx.translate(cx, cy);
    this.ctx.fillStyle = active ? palette.textWarningFg : palette.textSecondary;
    this.ctx.strokeStyle = active ? palette.textWarningFg : palette.textSecondary;
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(-14, 4);
    this.ctx.quadraticCurveTo(-14, -16, 0, -18);
    this.ctx.quadraticCurveTo(14, -16, 14, 4);
    this.ctx.lineTo(16, 8);
    this.ctx.lineTo(-16, 8);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.beginPath();
    this.ctx.arc(0, 12, 4, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  private drawNotificationPanel(state: GameRenderState) {
    const panel = notificationPanelRegion;
    this.ctx.fillStyle = palette.bgOverlay;
    roundRect(this.ctx, panel.x, panel.y, panel.width, panel.height, 12);
    this.ctx.fill();
    this.ctx.strokeStyle = palette.borderDefault;
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    this.ctx.fillStyle = palette.textPrimary;
    this.ctx.font = uiFont(18);
    this.ctx.fillText("通知", panel.x + 18, panel.y + 30);
    this.ctx.fillStyle = palette.textSecondary;
    this.ctx.font = uiFont(14);
    this.ctx.fillText("障害アラート / Slack", panel.x + 18, panel.y + 50);

    const items = [
      ...state.monitors.left.alerts.map((alert) => ({
        kind: "alert" as const,
        atMs: alert.atMs,
        alert
      })),
      ...mergedSlackMessages(state).map((message) => ({
        kind: "slack" as const,
        atMs: message.atMs,
        message
      }))
    ].sort((left, right) => right.atMs - left.atMs);

    if (items.length === 0) {
      this.ctx.fillStyle = palette.textMuted;
      this.ctx.font = uiFont(16);
      this.ctx.fillText("通知はまだありません", panel.x + 18, panel.y + 90);
      return;
    }

    let y = panel.y + 72;
    for (const item of items.slice(0, 7)) {
      if (item.kind === "alert") {
        const unread = !state.notifications.readAlertIds.includes(item.alert.id);
        const color = severityColor(item.alert.severity);
        this.ctx.fillStyle = unread ? palette.bgCard : palette.bgCardDark;
        roundRect(this.ctx, panel.x + 12, y, panel.width - 24, 54, 8);
        this.ctx.fill();
        if (unread) {
          this.ctx.strokeStyle = color;
          this.ctx.lineWidth = 2;
          this.ctx.stroke();
        }
        this.ctx.fillStyle = color;
        this.ctx.beginPath();
        this.ctx.arc(panel.x + 26, y + 27, 5, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillStyle = palette.textPrimary;
        this.ctx.font = monoFont(14, "bold");
        this.ctx.fillText(item.alert.severity.toUpperCase(), panel.x + 40, y + 22);
        this.ctx.fillStyle = palette.textSecondary;
        this.ctx.font = uiFont(14);
        wrapText(this.ctx, item.alert.message, panel.x + 40, y + 40, panel.width - 56, 18, 2);
        y += 62;
        continue;
      }

      const unread = !state.seenSlackIds.includes(item.message.id);
      this.ctx.fillStyle = unread ? palette.bgCard : palette.bgCardDark;
      roundRect(this.ctx, panel.x + 12, y, panel.width - 24, 54, 8);
      this.ctx.fill();
      if (unread) {
        this.ctx.strokeStyle = palette.textLink;
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
      }
      this.ctx.fillStyle = palette.textLink;
      this.ctx.beginPath();
      this.ctx.arc(panel.x + 26, y + 27, 5, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.fillStyle = palette.textPrimary;
      this.ctx.font = monoFont(14, "bold");
      this.ctx.fillText("SLACK", panel.x + 40, y + 22);
      this.ctx.fillStyle = palette.textSecondary;
      this.ctx.font = uiFont(14);
      wrapText(
        this.ctx,
        `${item.message.from}: ${item.message.body}`,
        panel.x + 40,
        y + 40,
        panel.width - 56,
        18,
        2
      );
      y += 62;
    }
  }

  private drawMonitor(
    x: number,
    y: number,
    width: number,
    height: number,
    _title: string,
    drawContent: (content: { width: number; height: number }) => void,
    options: { contentScale?: number } = {}
  ) {
    const contentX = x + 22;
    const contentY = y + 64;
    const contentWidth = width - 44;
    const contentHeight = height - 80;
    const scale =
      options.contentScale ??
      Math.min(contentWidth / monitorContentWidth, contentHeight / monitorContentHeight);

    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(contentX, contentY, contentWidth, contentHeight);
    this.ctx.clip();
    this.ctx.translate(contentX, contentY);
    if (scale !== 1) this.ctx.scale(scale, scale);
    drawContent({ width: contentWidth / scale, height: contentHeight / scale });
    this.ctx.restore();
  }

  private drawMonitorMagnifyIcons() {
    for (const monitor of monitorLayouts) {
      const region = monitorMagnifyRegions.find((item) => item.id === monitor.id);
      if (!region) continue;
      this.withMonitorPose(monitor, () => {
        drawMagnifyIcon(this.ctx, region.x + 10, region.y + 10, 24);
      });
    }
  }

  private drawExpandedMonitorOverlay(
    state: GameRenderState,
    scenario?: import("@incident/shared").ScenarioDefinition
  ) {
    const monitorId = state.world.expandedMonitor;
    if (!monitorId) return;

    const monitor = monitorLayouts.find((item) => item.id === monitorId);
    if (!monitor) return;

    this.ctx.fillStyle = "rgba(2, 6, 23, 0.78)";
    this.ctx.fillRect(0, 0, logicalWidth, logicalHeight);

    const layout = expandedMonitorLayout;
    this.drawMonitorFrame(layout.x, layout.y, layout.width, layout.height, monitor.title, { stand: false });
    this.drawMonitor(layout.x, layout.y, layout.width, layout.height, monitor.title, (content) => {
      if (monitorId === "metrics") this.drawMetricsPanel(state.monitors.left, content.height);
      else if (monitorId === "terminal") this.drawCenterPanel(state, content.width);
      else this.drawRightPanel(state, scenario);
    });

    this.ctx.fillStyle = palette.textMuted;
    this.ctx.font = uiFont(14);
    this.ctx.fillText("背景をクリックで閉じる", layout.x + layout.width - 168, layout.y + 28);
  }

  private drawMonitorFrame(
    x: number,
    y: number,
    width: number,
    height: number,
    title: string,
    options: { stand?: boolean } = {}
  ) {
    if (options.stand ?? true) {
      this.drawMonitorStand(x, y, width, height);
    }

    this.ctx.fillStyle = palette.bgMonitor;
    roundRect(this.ctx, x - 16, y - 16, width + 32, height + 32, 8);
    this.ctx.fill();
    this.ctx.fillStyle = palette.bgTerminal;
    roundRect(this.ctx, x, y, width, height, 6);
    this.ctx.fill();
    this.ctx.strokeStyle = palette.borderMuted;
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    this.ctx.fillStyle = palette.textLink;
    this.ctx.font = monoFont(18);
    this.ctx.fillText(title, x + 22, y + 36);
  }

  private drawMonitorStand(x: number, y: number, width: number, height: number) {
    const frameBottom = y + height + 16;
    const centerX = x + width / 2;
    const postWidth = 34;
    const postHeight = 54;
    const postTop = frameBottom - 1;
    const baseTop = postTop + postHeight - 3;
    const baseWidth = 164;
    const baseHeight = 18;

    this.ctx.save();

    this.ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
    roundRect(this.ctx, centerX - baseWidth / 2 + 12, baseTop + 10, baseWidth - 24, 10, 5);
    this.ctx.fill();

    this.ctx.fillStyle = palette.bgMonitor;
    roundRect(this.ctx, centerX - postWidth / 2, postTop, postWidth, postHeight, 3);
    this.ctx.fill();
    this.ctx.strokeStyle = palette.borderMuted;
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    this.ctx.fillStyle = palette.bgMonitor;
    roundRect(this.ctx, centerX - baseWidth / 2, baseTop, baseWidth, baseHeight, 4);
    this.ctx.fill();
    this.ctx.strokeStyle = palette.borderMuted;
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    this.ctx.restore();
  }

  private drawMetricsPanel(left: GameRenderState["monitors"]["left"], viewportHeight = monitorContentHeight) {
    const { metrics, metricsHistory, metricsSource } = left;
    const health = summarizeMetricsHealth(metrics);
    const panelWidth = 496;
    const cardHeight = 88;
    const cardGap = 12;
    const rowStride = cardHeight + cardGap;
    const sectionGap = 16;

    this.drawMetricsHealthBanner(health, metricsSource, panelWidth);

    type MetricCardSpec = {
      label: string;
      value: number;
      suffix: string;
      max: number;
      color: string;
      pickHistory: (snapshot: MetricsSnapshot) => number;
    };

    const sections: Array<{ title: string; cards: MetricCardSpec[] }> = [
      {
        title: "RESOURCES",
        cards: [
          {
            label: "CPU",
            value: metrics.cpu,
            suffix: "%",
            max: 100,
            color: toneColor(metricTone(metrics.cpu, 70, 85)),
            pickHistory: (snapshot) => snapshot.cpu
          },
          {
            label: "Memory",
            value: metrics.memory,
            suffix: "%",
            max: 100,
            color: toneColor(metricTone(metrics.memory, 75, 90)),
            pickHistory: (snapshot) => snapshot.memory
          },
          {
            label: "Disk",
            value: metrics.disk,
            suffix: "%",
            max: 100,
            color: toneColor(metricTone(metrics.disk, 80, 92)),
            pickHistory: (snapshot) => snapshot.disk
          }
        ]
      },
      {
        title: "TRAFFIC",
        cards: [
          {
            label: "HTTP 5xx",
            value: Math.round(metrics.http5xxRate * 100),
            suffix: "%",
            max: 100,
            color: toneColor(metrics.http5xxRate > 0 ? "critical" : "healthy"),
            pickHistory: (snapshot) => Math.round(snapshot.http5xxRate * 100)
          },
          {
            label: "Latency p95",
            value: metrics.latencyP95Ms,
            suffix: "ms",
            max: 2000,
            color: toneColor(metricTone(metrics.latencyP95Ms, 800, 1500)),
            pickHistory: (snapshot) => snapshot.latencyP95Ms
          },
          {
            label: "RPS",
            value: metrics.rps,
            suffix: "",
            max: 80,
            color: palette.accentPurple,
            pickHistory: (snapshot) => snapshot.rps
          }
        ]
      },
      {
        title: "DATASTORE",
        cards: [
          {
            label: "DB Conn",
            value: metrics.dbConnections,
            suffix: "",
            max: 40,
            color: palette.accentPink,
            pickHistory: (snapshot) => snapshot.dbConnections
          },
          {
            label: "Queue",
            value: metrics.queueDepth,
            suffix: "",
            max: 40,
            color: toneColor(metricTone(metrics.queueDepth, 12, 24)),
            pickHistory: (snapshot) => snapshot.queueDepth
          }
        ]
      }
    ];

    const scrollViewportHeight = Math.max(0, viewportHeight - METRICS_SCROLL_TOP);
    let contentHeight = 0;
    for (const section of sections) {
      const rows = Math.ceil(section.cards.length / 2);
      contentHeight += 18 + rows * rowStride + sectionGap;
    }
    contentHeight = Math.max(0, contentHeight - sectionGap);
    this.metricsScrollMax = Math.max(0, contentHeight - scrollViewportHeight);
    this.metricsScrollY = clamp(this.metricsScrollY, 0, this.metricsScrollMax);

    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(0, METRICS_SCROLL_TOP, panelWidth, scrollViewportHeight);
    this.ctx.clip();
    this.ctx.translate(0, METRICS_SCROLL_TOP - this.metricsScrollY);

    let y = 0;
    for (const section of sections) {
      this.ctx.fillStyle = palette.textMuted;
      this.ctx.font = monoFont(14);
      this.ctx.fillText(section.title, 0, y);
      y += 18;

      section.cards.forEach((card, index) => {
        const column = index % 2;
        const row = Math.floor(index / 2);
        const cardX = column * 252;
        const cardY = y + row * rowStride;
        const historyValues = metricsHistory.map(card.pickHistory);
        this.drawMetricCard(cardX, cardY, 236, cardHeight, {
          label: card.label,
          value: card.value,
          suffix: card.suffix,
          max: card.max,
          color: card.color,
          historyValues
        });
      });

      const rows = Math.ceil(section.cards.length / 2);
      y += rows * rowStride + sectionGap;
    }
    this.ctx.restore();
    this.drawMetricsScrollbar(panelWidth, METRICS_SCROLL_TOP, scrollViewportHeight, contentHeight);
  }

  private drawMetricsHealthBanner(
    health: MetricsHealthSummary,
    source: MetricsSource,
    panelWidth: number
  ) {
    this.ctx.fillStyle = palette.bgCardDark;
    roundRect(this.ctx, 0, 0, panelWidth, 40, 8);
    this.ctx.fill();

    this.ctx.fillStyle = health.color;
    this.ctx.beginPath();
    this.ctx.arc(14, 20, 6, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.fillStyle = palette.textPrimary;
    this.ctx.font = uiFont(16);
    this.ctx.fillText("SERVICE HEALTH", 28, 18);

    const badge = health.label;
    const sourceLabel = source === "live" ? "LIVE" : source === "loading" ? "SYNC" : "OFFLINE";
    const sourceColor = source === "live" ? palette.statusLive : source === "loading" ? palette.statusLoading : palette.statusError;
    this.ctx.font = monoFont(14);
    const badgeWidth = this.ctx.measureText(badge).width + 20;
    const sourceWidth = this.ctx.measureText(sourceLabel).width;
    const badgeX = panelWidth - badgeWidth - 10;
    const sourceX = badgeX - 10 - sourceWidth;
    const dotX = sourceX - 12;

    this.ctx.fillStyle = palette.textSecondary;
    this.ctx.font = monoFont(14);
    const detailMaxWidth = Math.max(72, dotX - 30);
    this.ctx.fillText(truncateToWidth(this.ctx, health.detail, detailMaxWidth), 28, 33);

    this.ctx.fillStyle = palette.bgInput;
    roundRect(this.ctx, badgeX, 8, badgeWidth, 24, 6);
    this.ctx.fill();
    this.ctx.fillStyle = health.color;
    this.ctx.font = monoFont(14);
    this.ctx.fillText(badge, badgeX + 10, 24);

    this.ctx.fillStyle = sourceColor;
    this.ctx.beginPath();
    this.ctx.arc(dotX, 20, 4, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.fillStyle = palette.textSecondary;
    this.ctx.font = monoFont(14);
    this.ctx.fillText(sourceLabel, sourceX, 23);
  }

  private drawMetricCard(
    x: number,
    y: number,
    width: number,
    height: number,
    card: {
      label: string;
      value: number;
      suffix: string;
      max: number;
      color: string;
      historyValues: number[];
    }
  ) {
    this.ctx.fillStyle = palette.bgPanel;
    roundRect(this.ctx, x, y, width, height, 8);
    this.ctx.fill();
    this.ctx.strokeStyle = palette.borderPanel;
    this.ctx.lineWidth = 1;
    this.ctx.stroke();

    this.ctx.fillStyle = palette.textSecondary;
    this.ctx.font = monoFont(14);
    this.ctx.fillText(card.label, x + 12, y + 18);

    this.ctx.fillStyle = palette.textPrimary;
    this.ctx.font = monoFont(22, "bold");
    this.ctx.fillText(`${card.value}${card.suffix}`, x + 12, y + 44);

    drawSparkline(
      this.ctx,
      x + 12,
      y + height - 31,
      width - 24,
      22,
      card.historyValues.length > 0 ? card.historyValues : [card.value],
      card.color,
      card.max
    );
  }

  private drawMetricsScrollbar(panelWidth: number, top: number, viewportHeight: number, contentHeight: number) {
    if (this.metricsScrollMax <= 0 || viewportHeight <= 0 || contentHeight <= 0) return;
    const trackX = panelWidth - 7;
    const trackY = top + 2;
    const trackHeight = viewportHeight - 4;
    const thumbHeight = Math.max(28, Math.round((viewportHeight / contentHeight) * trackHeight));
    const thumbY = trackY + Math.round((this.metricsScrollY / this.metricsScrollMax) * (trackHeight - thumbHeight));

    this.ctx.fillStyle = "rgba(148, 163, 184, 0.16)";
    roundRect(this.ctx, trackX, trackY, 4, trackHeight, 2);
    this.ctx.fill();
    this.ctx.fillStyle = "rgba(148, 163, 184, 0.58)";
    roundRect(this.ctx, trackX, thumbY, 4, thumbHeight, 2);
    this.ctx.fill();
  }

  private drawCenterPanel(state: GameRenderState, contentWidth = terminalContentWidth) {
    if (state.monitors.center.activeTool === "editor") {
      this.drawEditorPanel(state.monitors.center.editor, contentWidth);
      return;
    }
    this.drawTerminal(state, contentWidth);
  }

  private drawTerminal(state: GameRenderState, contentWidth = terminalContentWidth) {
    const terminal = state.monitors.center.terminal;
    const contentHeight = 540;
    const lineHeight = 22;
    this.ctx.font = monoFont(18);
    const cellWidth = this.ctx.measureText("M").width;
    const visualLines = this.layoutTerminalLines(terminal.lines);
    const cursorVisualLine = findTerminalCursorVisualLine(visualLines, terminal.cursor.y, terminal.cursor.x);
    const effectiveCursorLine = cursorVisualLine >= 0 ? cursorVisualLine : Math.max(0, visualLines.length - 1);
    const maxLines = Math.floor(contentHeight / lineHeight);
    const startLine =
      visualLines.length <= maxLines
        ? 0
        : Math.min(
            Math.max(0, effectiveCursorLine - maxLines + 1),
            visualLines.length - maxLines
          );
    const visibleLines = visualLines.slice(startLine, startLine + maxLines);
    const textBlockHeight = visibleLines.length * lineHeight;
    const baseY = Math.max(20, contentHeight - textBlockHeight);

    this.ctx.fillStyle = palette.textTerminal;
    visibleLines.forEach((line, index) => {
      const y = baseY + index * lineHeight;
      let x = 0;
      for (const span of line.spans) {
        this.ctx.fillStyle = span.color ?? palette.textTerminal;
        this.ctx.font = monoFont(18, span.bold ? "bold" : span.dim ? "lighter" : "normal");
        this.ctx.fillText(span.text, x, y);
        x += this.ctx.measureText(span.text).width;
      }
    });

    const cursorLine = effectiveCursorLine - startLine;
    if (terminal.cursor.visible && cursorLine >= 0 && cursorLine < visibleLines.length) {
      const line = visibleLines[cursorLine];
      if (!line) return;
      this.ctx.font = monoFont(18);
      const cursorX = Math.max(0, terminal.cursor.x - line.startColumn) * cellWidth;
      this.ctx.fillStyle = palette.textTerminal;
      this.ctx.fillRect(cursorX, baseY + cursorLine * lineHeight - 16, Math.max(2, cellWidth * 0.6), 20);
    }
  }

  private drawEditorPanel(editor: GameRenderState["monitors"]["center"]["editor"], contentWidth = terminalContentWidth) {
    const headerHeight = 54;
    this.ctx.fillStyle = palette.bgCardDark;
    roundRect(this.ctx, 0, 0, contentWidth, headerHeight, 6);
    this.ctx.fill();

    this.ctx.fillStyle = palette.textMuted;
    this.ctx.font = monoFont(13);
    this.ctx.fillText("FILES", 12, 18);
    this.ctx.fillStyle = editor.dirty ? palette.textWarningFg : editor.status === "error" ? palette.statusCritical : palette.textTerminalMuted;
    this.ctx.font = uiFont(15, "bold");
    const status = editor.status === "saving" ? "SAVING" : editor.dirty ? "UNSAVED" : editor.status === "error" ? "ERROR" : "SAVED";
    this.ctx.fillText(status, contentWidth - 90, 18);

    this.ctx.fillStyle = palette.textPrimary;
    this.ctx.font = monoFont(16, "bold");
    const currentPath = editor.currentPath ?? editor.files[0]?.path ?? "/workspace";
    this.ctx.fillText(shortenPath(currentPath, 54), 12, 42);

    const fileListTop = headerHeight + 12;
    const fileListWidth = 142;
    this.ctx.fillStyle = palette.bgPanelDark;
    roundRect(this.ctx, 0, fileListTop, fileListWidth, 470, 6);
    this.ctx.fill();
    this.ctx.font = monoFont(13);
    let fileY = fileListTop + 24;
    for (const file of editor.files.slice(0, 14)) {
      const active = file.path === editor.currentPath;
      if (active) {
        this.ctx.fillStyle = palette.bgButtonSecondary;
        roundRect(this.ctx, 6, fileY - 16, fileListWidth - 12, 24, 4);
        this.ctx.fill();
      }
      this.ctx.fillStyle = active ? palette.textPrimary : palette.textSecondary;
      this.ctx.fillText(shortenPath(file.path.replace("/workspace/", ""), 18), 12, fileY);
      fileY += 28;
    }

    const editorX = fileListWidth + 14;
    const editorY = fileListTop;
    const editorWidth = contentWidth - editorX;
    const editorHeight = 470;
    this.ctx.fillStyle = palette.bgTerminal;
    roundRect(this.ctx, editorX, editorY, editorWidth, editorHeight, 6);
    this.ctx.fill();
    this.ctx.strokeStyle = editor.status === "error" ? palette.statusCritical : palette.borderDefault;
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    if (editor.status === "loading") {
      this.ctx.fillStyle = palette.textMuted;
      this.ctx.font = uiFont(17);
      this.ctx.fillText("読み込み中...", editorX + 16, editorY + 34);
      return;
    }
    if (editor.status === "error" && editor.error) {
      this.ctx.fillStyle = palette.statusCritical;
      this.ctx.font = uiFont(16, "bold");
      wrapText(this.ctx, editor.error, editorX + 16, editorY + 34, editorWidth - 32, 22, 4);
    }

    this.ctx.font = monoFont(15);
    const lineHeight = 21;
    const lines = editor.content.split("\n");
    const maxLines = Math.floor((editorHeight - 24) / lineHeight);
    const cursorLine = Math.max(1, editor.cursor.line);
    const start = Math.max(0, Math.min(Math.max(0, lines.length - maxLines), cursorLine - maxLines));
    for (let index = 0; index < Math.min(maxLines, lines.length - start); index += 1) {
      const lineNumber = start + index + 1;
      const y = editorY + 24 + index * lineHeight;
      this.ctx.fillStyle = palette.textMuted;
      this.ctx.fillText(String(lineNumber).padStart(3, " "), editorX + 10, y);
      this.ctx.fillStyle = palette.textTerminal;
      this.ctx.fillText((lines[start + index] ?? "").slice(0, 42), editorX + 52, y);
    }
  }

  private drawCenterToolTabs(state: GameRenderState) {
    const monitor = monitorLayouts.find((item) => item.id === "terminal")!;
    const tabs = centerToolTabRegions();
    for (const tab of tabs) {
      const active = state.monitors.center.activeTool === tab.id;
      this.ctx.fillStyle = active ? palette.bgButtonPrimary : palette.bgTerminal;
      roundRect(this.ctx, tab.x, tab.y, tab.width, tab.height, 5);
      this.ctx.fill();
      this.ctx.strokeStyle = active ? palette.borderFocus : palette.borderMuted;
      this.ctx.lineWidth = 2;
      this.ctx.stroke();
      this.ctx.fillStyle = active ? palette.textPrimary : palette.textLink;
      this.ctx.font = monoFont(18);
      centeredText(this.ctx, tab.label, tab.x, tab.y + 1, tab.width, tab.height);
    }
    const editor = state.monitors.center.editor;
    if (editor.dirty) {
      const editorTab = tabs.find((item) => item.id === "editor");
      if (editorTab) {
        this.ctx.fillStyle = palette.statusCritical;
        this.ctx.beginPath();
        this.ctx.arc(editorTab.x + editorTab.width - 10, editorTab.y + 9, 5, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }
    this.ctx.fillStyle = palette.textMuted;
    this.ctx.font = uiFont(13);
    this.ctx.fillText("TAB", monitor.x + 22, monitor.y - 2);
  }

  private layoutTerminalLines(lines: string[]): TerminalVisualLine[] {
    const visualLines: TerminalVisualLine[] = [];
    for (let sourceIndex = 0; sourceIndex < lines.length; sourceIndex += 1) {
      const cached = this.getCachedTerminalLine(lines[sourceIndex] ?? "");
      visualLines.push(mirrorTerminalVisualLine(cached.spans, cached.plain, sourceIndex));
    }
    return visualLines.length > 0 ? visualLines : [emptyTerminalVisualLine(0)];
  }

  private getCachedTerminalLine(line: string) {
    const source = line.slice(0, 120);
    const cached = this.terminalLineCache.get(source);
    if (cached) return cached;
    const parsed = {
      spans: parseAnsiLine(source),
      plain: stripAnsi(source)
    };
    this.terminalLineCache.set(source, parsed);
    if (this.terminalLineCache.size > 500) {
      const oldest = this.terminalLineCache.keys().next().value;
      if (oldest !== undefined) this.terminalLineCache.delete(oldest);
    }
    return parsed;
  }

  private drawRightPanel(state: GameRenderState, scenario?: import("@incident/shared").ScenarioDefinition) {
    const expanded = state.world.expandedMonitor === "runbook";
    const activePanelTab = state.monitors.right.activePanelTab ?? "runbook";
    const runbooks = scenario?.runbooks ?? (state.monitors.right.activeRunbook ? [state.monitors.right.activeRunbook] : []);
    const layout = rightPanelLayout(state.session.difficulty, activePanelTab, runbooks.length > 0);

    if (layout.worldHeight > 0) this.drawWorldPanel(state.world);

    this.drawPrimaryPanelTabs(state, layout.primaryTop);

    if (activePanelTab === "runbook") {
      this.drawRunbookDocumentTabs(state, runbooks, layout.secondaryTop);
      const titleTop = layout.contentTop;
      const bodyTop = titleTop + 36;
      const maxRunbookLines = Math.max(10, Math.floor((monitorContentHeight - bodyTop - 16) / 24));
      this.ctx.fillStyle = palette.textPrimary;
      this.ctx.font = uiFont(22);
      this.ctx.fillText(state.monitors.right.activeRunbook?.title ?? "Runbook", 0, titleTop);
      this.ctx.font = uiFont(17);
      wrapText(this.ctx, state.monitors.right.activeRunbook?.body ?? "", 0, bodyTop, 470, 24, maxRunbookLines);
      return;
    }

    this.ctx.fillStyle = palette.textPrimary;
    this.ctx.font = uiFont(20);
    this.ctx.fillText("Slack", 0, layout.slackMessagesTop);
    this.ctx.font = uiFont(16);
    const messageLineHeight = 22;
    const maxSlackLines = Math.max(4, Math.floor((layout.slackMessagesBottom - layout.slackMessagesTop - 24) / messageLineHeight));
    let y = layout.slackMessagesTop + 30;
    let drawnLines = 0;
    for (const message of mergedSlackMessages(state).slice(-12)) {
      if (drawnLines >= maxSlackLines) break;
      const prefix = message.from === "あなた" ? "▸ " : "";
      const color = message.from === "あなた" ? palette.textLink : palette.textPrimary;
      this.ctx.fillStyle = color;
      const nextY = wrapText(this.ctx, `${prefix}${message.from}: ${message.body}`, 0, y, 470, messageLineHeight, 3);
      drawnLines += Math.max(1, Math.round((nextY - y) / messageLineHeight));
      y = nextY + 8;
    }

    this.drawSlackCompose(state, layout.composeTop);
  }

  private drawPrimaryPanelTabs(state: GameRenderState, top: number) {
    const activePanelTab = state.monitors.right.activePanelTab ?? "runbook";
    const unreadSlack = mergedSlackMessages(state).some((message) => !state.seenSlackIds.includes(message.id));
    this.ctx.font = uiFont(16);
    let tabX = 0;
    for (const tab of RIGHT_PANEL_PRIMARY_TABS) {
      const active = activePanelTab === tab.id;
      this.ctx.fillStyle = active ? palette.bgCard : palette.bgCardActive;
      roundRect(this.ctx, tabX, top, tab.width, RIGHT_PANEL_PRIMARY_TAB_HEIGHT, 6);
      this.ctx.fill();
      this.ctx.fillStyle = active ? palette.textPrimary : palette.textMuted;
      this.ctx.fillText(tab.label, tabX + RUNBOOK_TAB_PAD_X, top + 26);
      if (tab.id === "slack" && unreadSlack && !active) {
        this.ctx.fillStyle = palette.statusCritical;
        this.ctx.beginPath();
        this.ctx.arc(tabX + tab.width - 12, top + 12, 5, 0, Math.PI * 2);
        this.ctx.fill();
      }
      tabX += tab.width + RUNBOOK_TAB_GAP;
    }
  }

  private drawRunbookDocumentTabs(
    state: GameRenderState,
    runbooks: import("@incident/shared").RunbookDefinition[],
    top: number
  ) {
    this.ctx.font = uiFont(16);
    let tabX = 0;
    for (let index = 0; index < runbooks.length; index += 1) {
      const runbook = runbooks[index];
      if (!runbook) continue;
      const active = index === state.monitors.right.activeRunbookIndex;
      const width = measureRunbookTabWidth(runbook.title, (title) => this.ctx.measureText(title).width);
      this.ctx.fillStyle = active ? palette.bgCard : palette.bgCardActive;
      roundRect(this.ctx, tabX, top, width, RIGHT_PANEL_SECONDARY_TAB_HEIGHT, 6);
      this.ctx.fill();
      this.ctx.fillStyle = active ? palette.textPrimary : palette.textMuted;
      this.ctx.fillText(runbook.title, tabX + RUNBOOK_TAB_PAD_X, top + 26);
      tabX += width + RUNBOOK_TAB_GAP;
    }
  }

  private drawWorldPanel(world: GameRenderState["world"]) {
    this.ctx.fillStyle = palette.textMuted;
    this.ctx.font = monoFont(14);
    this.ctx.fillText("SECURITY FEEDS", 0, 12);

    this.drawCctvFeed(0, 20, 228, 88, "JANITOR CAM", world.janitorCameraActive);
    this.drawCctvFeed(242, 20, 228, 88, "FRIDGE CAM", world.fridgeCameraActive);

    this.ctx.fillStyle = palette.textSecondary;
    this.ctx.font = monoFont(14);
    this.ctx.fillText("RED BULL", 0, 126);
    this.ctx.fillStyle = palette.bgCard;
    roundRect(this.ctx, 0, 132, 470, 14, 4);
    this.ctx.fill();
    const fillWidth = (470 * Math.max(0, Math.min(100, world.redBullPercent))) / 100;
    this.ctx.fillStyle = world.redBullPercent <= 15 ? palette.statusCritical : palette.statusError;
    roundRect(this.ctx, 0, 132, Math.max(4, fillWidth), 14, 4);
    this.ctx.fill();
    this.ctx.fillStyle = palette.textPrimary;
    this.ctx.font = monoFont(14, "bold");
    this.ctx.fillText(`${Math.round(world.redBullPercent)}%`, 438, 124);
  }

  private drawCctvFeed(x: number, y: number, width: number, height: number, label: string, active: boolean) {
    this.ctx.fillStyle = active ? palette.bgSlackActive : palette.bgSlackIdle;
    roundRect(this.ctx, x, y, width, height, 4);
    this.ctx.fill();
    this.ctx.strokeStyle = active ? palette.borderSlackActive : palette.borderDefault;
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    if (active) {
      this.ctx.fillStyle = "rgba(34, 197, 94, 0.08)";
      for (let row = 0; row < height; row += 4) {
        this.ctx.fillRect(x + 2, y + row, width - 4, 2);
      }
      this.ctx.fillStyle = palette.accentGreenDark;
      this.ctx.font = monoFont(14);
      this.ctx.fillText("REC", x + 8, y + 16);
      this.ctx.fillStyle = palette.accentGreen;
      this.ctx.font = uiFont(14);
      this.ctx.fillText(label === "JANITOR CAM" ? "廊下 — 静止" : "冷蔵庫 — OK", x + 8, y + height - 10);
    } else {
      this.ctx.fillStyle = palette.textMuted;
      this.ctx.font = monoFont(14);
      this.ctx.fillText("NO SIGNAL", x + width / 2 - 38, y + height / 2 + 4);
    }

    this.ctx.fillStyle = active ? palette.textTerminalMuted : palette.textMuted;
    this.ctx.font = monoFont(14);
    this.ctx.fillText(label, x + 8, y + height + 14);
  }

  private drawSlackCompose(state: GameRenderState, boxY = 484) {
    const active = state.slackCompose.active;
    this.ctx.fillStyle = active ? palette.bgDevtoolsActive : palette.bgDevtoolsIdle;
    roundRect(this.ctx, 0, boxY, 470, 44, 6);
    this.ctx.fill();
    this.ctx.strokeStyle = active ? palette.accentBlue : palette.borderDefault;
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    this.ctx.fillStyle = active ? palette.textLink : palette.textMuted;
    this.ctx.font = uiFont(16);
    const draft = state.slackCompose.draft;
    const placeholder = "状況を報告... (クリックして入力)";
    const text = draft.length > 0 ? draft : placeholder;
    this.ctx.fillText(text.slice(0, 42), 12, boxY + 28);

    if (active && draft.length > 0) {
      this.ctx.fillStyle = palette.accentGreen;
      roundRect(this.ctx, 404, boxY + 8, 56, 28, 4);
      this.ctx.fill();
      this.ctx.fillStyle = palette.accentGreenBg;
      this.ctx.font = uiFont(14, "bold");
      this.ctx.fillText("送信", 416, boxY + 27);
    }
  }

  private drawCommandWarning(warning: { message: string; flashMs: number }) {
    const opacity = Math.min(1, warning.flashMs / 800);
    const box = { x: 70, y: 118, width: logicalWidth - 140, height: 52 };
    this.ctx.fillStyle = `rgba(127, 29, 29, ${0.92 * opacity})`;
    roundRect(this.ctx, box.x, box.y, box.width, box.height, 8);
    this.ctx.fill();
    this.ctx.strokeStyle = `rgba(248, 113, 113, ${opacity})`;
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    this.ctx.fillStyle = `rgba(254, 226, 226, ${opacity})`;
    this.ctx.font = uiFont(20, "bold");
    this.ctx.fillText(warning.message, box.x + 16, box.y + 34);
  }

  private drawRedBullFlying(remainingMs: number) {
    const duration = 2800;
    const progress = 1 - remainingMs / duration;
    const x = -80 + progress * (logicalWidth + 160);
    const y = 280 + Math.sin(progress * Math.PI * 3) * 120;

    this.ctx.fillStyle = palette.bgOverlayLight;
    this.ctx.fillRect(0, 0, logicalWidth, logicalHeight);

    this.ctx.save();
    this.ctx.translate(x, y);
    this.ctx.rotate(-0.35 + progress * 0.7);
    this.ctx.fillStyle = palette.bgButtonPrimary;
    roundRect(this.ctx, 0, 0, 48, 96, 6);
    this.ctx.fill();
    this.ctx.fillStyle = palette.statusError;
    roundRect(this.ctx, 4, 8, 40, 28, 4);
    this.ctx.fill();
    this.ctx.fillStyle = palette.textPrimary;
    this.ctx.font = uiFont(14, "bold");
    this.ctx.fillText("RB", 14, 26);
    this.ctx.fillStyle = palette.textLink;
    this.ctx.font = uiFont(22, "bold");
    this.ctx.fillText("翼が生えた!", 56, 48);
    this.ctx.restore();
  }

  private drawNavigationOverlay(state: GameRenderState, scenario?: import("@incident/shared").ScenarioDefinition) {
    const step = scenario?.navigationSteps?.find((item) => item.id === state.navigation.activeStepId);
    if (!step || state.session.difficulty !== "beginner") return;

    const box = navigationOverlayRect;
    this.ctx.fillStyle = palette.bgOverlay;
    roundRect(this.ctx, box.x, box.y, box.width, box.height, 10);
    this.ctx.fill();
    this.ctx.strokeStyle = palette.borderFocus;
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    this.ctx.fillStyle = palette.borderFocus;
    this.ctx.font = uiFont(14);
    this.ctx.fillText("NAV", box.x + 16, box.y + 28);
    this.ctx.fillStyle = palette.textPrimary;
    this.ctx.font = uiFont(18);
    wrapText(this.ctx, step.hint, box.x + 16, box.y + 52, box.width - 32, 24, 3);
    if (step.suggestedCommand) {
      this.ctx.fillStyle = palette.textSecondary;
      this.ctx.font = monoFont(14);
      this.ctx.fillText(`例: ${step.suggestedCommand}`, box.x + 16, box.y + box.height - 24);
    }
  }

  private drawAlerts(state: GameRenderState) {
    const alert = state.monitors.left.alerts[state.monitors.left.alerts.length - 1];
    if (!alert) return;
    this.ctx.fillStyle = "rgba(239, 68, 68, 0.92)";
    roundRect(this.ctx, 70, 778, 1780, 48, 8);
    this.ctx.fill();
    this.ctx.fillStyle = palette.textBadge;
    this.ctx.font = uiFont(22);
    this.ctx.fillText(alert.message, 104, 808);
  }

  private drawInputDock(state: GameRenderState) {
    const input = inputDockRects.input;
    const button = inputDockRects.button;
    const enabled = state.session.status === "running";
    const focused = state.commandInputFocused;
    const typed = extractTypedCommand(state.monitors.center.terminal.commandDraft);
    const caretVisible = enabled && focused && Math.floor(performance.now() / 530) % 2 === 0;

    this.ctx.fillStyle = palette.bgPanelDark;
    this.ctx.fillRect(0, 850, logicalWidth, 170);

    this.ctx.fillStyle = palette.textMuted;
    this.ctx.font = monoFont(14);
    this.ctx.fillText("INPUT", input.x, input.y - 10);

    this.ctx.fillStyle = palette.bgTerminal;
    roundRect(this.ctx, input.x, input.y, input.width, input.height, 8);
    this.ctx.fill();
    this.ctx.strokeStyle = enabled && focused ? palette.borderFocus : enabled ? palette.borderDefault : palette.bgCard;
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    const inputTextY = input.y + Math.round(input.height / 2) + 8;
    this.ctx.font = monoFont(22);
    const textStartX = input.x + 20;
    if (typed) {
      this.ctx.fillStyle = palette.textTerminal;
      this.ctx.fillText(typed, textStartX, inputTextY);
    } else if (!focused) {
      this.ctx.fillStyle = palette.textMuted;
      this.ctx.fillText(enabled ? "コマンドを入力…" : "セッション開始後に入力できます", textStartX, inputTextY);
    }
    if (caretVisible) {
      const caretX = typed ? inputCaretX(this.ctx, typed, textStartX) : textStartX;
      this.ctx.fillStyle = palette.textTerminal;
      this.ctx.fillRect(caretX, inputTextY - 20, 2, 24);
    }

    this.ctx.fillStyle = enabled ? palette.bgInput : palette.bgCardDark;
    roundRect(this.ctx, button.x, button.y, button.width, button.height, 8);
    this.ctx.fill();
    this.ctx.strokeStyle = palette.borderDefault;
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    this.ctx.fillStyle = enabled ? palette.textPrimary : palette.textSecondary;
    this.ctx.font = uiFont(24);
    centeredText(this.ctx, "復旧完了", button.x, button.y + 2, button.width, button.height);

    const retire = inputDockRects.retire;
    this.ctx.fillStyle = enabled ? palette.bgButtonDanger : palette.bgButtonDangerDisabled;
    roundRect(this.ctx, retire.x, retire.y, retire.width, retire.height, 8);
    this.ctx.fill();
    this.ctx.strokeStyle = palette.borderDanger;
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    this.ctx.fillStyle = enabled ? palette.textWarningFg : palette.textSecondary;
    this.ctx.font = uiFont(22);
    centeredText(this.ctx, "リタイア", retire.x, retire.y + 2, retire.width, retire.height);
  }

  private drawCursor(state: GameRenderState) {
    if (!state.cursor.visible) return;
    this.ctx.fillStyle = palette.textPrimary;
    this.ctx.beginPath();
    this.ctx.moveTo(state.cursor.x, state.cursor.y);
    this.ctx.lineTo(state.cursor.x + 20, state.cursor.y + 44);
    this.ctx.lineTo(state.cursor.x + 32, state.cursor.y + 28);
    this.ctx.closePath();
    this.ctx.fill();
  }
}

type TerminalVisualLine = {
  sourceIndex: number;
  startColumn: number;
  endColumn: number;
  plain: string;
  spans: AnsiSpan[];
};

export const notificationBellRegion = { x: 1508, y: 34, width: 52, height: 52 } as const;

export const notificationPanelRegion = { x: 1188, y: 92, width: 372, height: 420 } as const;

export const inputDockRects = {
  input: { x: 70, y: 878, width: 1280, height: 96 },
  retire: { x: 1370, y: 878, width: 140, height: 96 },
  button: { x: 1530, y: 878, width: 160, height: 96 }
} as const;

export const navigationOverlayRect = { x: 720, y: 860, width: 480, height: 120 } as const;

export function centerToolTabRegions() {
  const monitor = monitorLayouts.find((item) => item.id === "terminal")!;
  const y = monitor.y + 10;
  const firstX = monitor.x + 22;
  return [
    { id: "terminal" as const, label: "TERMINAL", x: firstX, y, width: CENTER_TOOL_TAB_WIDTH, height: CENTER_TOOL_TAB_HEIGHT },
    {
      id: "editor" as const,
      label: "EDITOR",
      x: firstX + CENTER_TOOL_TAB_WIDTH + CENTER_TOOL_TAB_GAP,
      y,
      width: CENTER_TOOL_TAB_WIDTH,
      height: CENTER_TOOL_TAB_HEIGHT
    }
  ];
}

export function centerToolAt(x: number, y: number): "terminal" | "editor" | null {
  for (const tab of centerToolTabRegions()) {
    if (containsCanvasPoint(tab, x, y)) return tab.id;
  }
  return null;
}

export function centerEditorOverlayRegion(expanded = false) {
  const monitor = expanded ? expandedMonitorLayout : monitorLayouts.find((item) => item.id === "terminal")!;
  const content = monitorContentRegion(monitor);
  const scale = Math.min(content.width / monitorContentWidth, content.height / monitorContentHeight);
  const editorX = 156;
  const editorY = 66;
  return {
    x: content.x + editorX * scale,
    y: content.y + editorY * scale,
    width: (content.width / scale - editorX) * scale,
    height: 470 * scale
  };
}

export function metricsPanelScrollRegion(expanded = false) {
  const monitor = expanded ? expandedMonitorLayout : monitorLayouts.find((item) => item.id === "metrics")!;
  const content = monitorContentRegion(monitor);
  const scale = Math.min(content.width / monitorContentWidth, content.height / monitorContentHeight);
  return {
    x: content.x,
    y: content.y + METRICS_SCROLL_TOP * scale,
    width: content.width,
    height: Math.max(0, content.height - METRICS_SCROLL_TOP * scale)
  };
}

export const runbookTabRegion = (difficulty: GameRenderState["session"]["difficulty"]) => {
  const layout = rightPanelLayout(difficulty, "runbook", true);
  return {
    x: runbookContentX,
    y: runbookContentY + layout.secondaryTop - RUNBOOK_TAB_HIT_PAD,
    width: 516,
    height: RIGHT_PANEL_SECONDARY_TAB_HEIGHT + RUNBOOK_TAB_HIT_PAD * 2
  };
};

function slackComposeScreenRegion(
  difficulty: GameRenderState["session"]["difficulty"],
  activePanelTab: RightPanelTab,
  expandedMonitor: MonitorId | null | undefined
) {
  if (activePanelTab !== "slack") return null;
  const layout = rightPanelLayout(difficulty, "slack", false);
  const content = runbookContentTransform(expandedMonitor === "runbook");
  return {
    x: content.x,
    y: content.y + layout.composeTop * content.scale,
    width: 470 * content.scale,
    height: RIGHT_PANEL_COMPOSE_HEIGHT * content.scale
  };
}

export const slackComposeRegion = (
  difficulty: GameRenderState["session"]["difficulty"],
  activePanelTab: RightPanelTab = "slack",
  expandedMonitor: MonitorId | null = null
) => slackComposeScreenRegion(difficulty, activePanelTab, expandedMonitor) ?? { x: 0, y: -1000, width: 0, height: 0 };

export const slackSendButtonRegion = (
  difficulty: GameRenderState["session"]["difficulty"],
  activePanelTab: RightPanelTab = "slack",
  expandedMonitor: MonitorId | null = null
) => {
  const compose = slackComposeScreenRegion(difficulty, activePanelTab, expandedMonitor);
  if (!compose) return { x: 0, y: -1000, width: 0, height: 0 };
  return {
    x: compose.x + 404 * compose.width / 470,
    y: compose.y + 8 * compose.height / RIGHT_PANEL_COMPOSE_HEIGHT,
    width: 56 * compose.width / 470,
    height: 28 * compose.height / RIGHT_PANEL_COMPOSE_HEIGHT
  };
};

export function monitorMagnifyAt(x: number, y: number): MonitorId | null {
  for (const region of monitorMagnifyRegions) {
    if (containsCanvasPoint(region, x, y)) return region.id;
  }
  return null;
}

export function slackComposeAt(
  x: number,
  y: number,
  difficulty: GameRenderState["session"]["difficulty"],
  activePanelTab: RightPanelTab = "slack",
  expandedMonitor: MonitorId | null = null
) {
  const composeRegion = slackComposeScreenRegion(difficulty, activePanelTab, expandedMonitor);
  if (!composeRegion || !containsCanvasPoint(composeRegion, x, y)) return null;
  const sendRegion = slackSendButtonRegion(difficulty, activePanelTab, expandedMonitor);
  if (containsCanvasPoint(sendRegion, x, y)) return "send" as const;
  return "compose" as const;
}

export function rightPanelPrimaryTabAt(
  x: number,
  y: number,
  difficulty: GameRenderState["session"]["difficulty"],
  expandedMonitor?: MonitorId | null
): RightPanelTab | null {
  if (expandedMonitor && expandedMonitor !== "runbook") return null;

  const layout = rightPanelLayout(difficulty, "runbook", true);
  const content = runbookContentTransform(expandedMonitor === "runbook");
  const localY = (y - content.y) / content.scale;
  if (
    localY < layout.primaryTop - RUNBOOK_TAB_HIT_PAD ||
    localY > layout.primaryTop + RIGHT_PANEL_PRIMARY_TAB_HEIGHT + RUNBOOK_TAB_HIT_PAD
  ) {
    return null;
  }

  let tabX = 0;
  for (const tab of RIGHT_PANEL_PRIMARY_TABS) {
    const hitLeft = content.x + tabX * content.scale - RUNBOOK_TAB_HIT_PAD * content.scale;
    const hitWidth = (tab.width + RUNBOOK_TAB_HIT_PAD * 2) * content.scale;
    if (x >= hitLeft && x <= hitLeft + hitWidth) return tab.id;
    tabX += tab.width + RUNBOOK_TAB_GAP;
  }
  return null;
}

export function runbookTabAt(
  x: number,
  y: number,
  difficulty: GameRenderState["session"]["difficulty"],
  runbookCount: number,
  titles: string[],
  expandedMonitor?: MonitorId | null,
  activePanelTab: RightPanelTab = "runbook"
) {
  if (runbookCount === 0 || activePanelTab !== "runbook") return -1;
  if (expandedMonitor && expandedMonitor !== "runbook") return -1;

  const layout = rightPanelLayout(difficulty, "runbook", true);
  const content = runbookContentTransform(expandedMonitor === "runbook");
  const localY = (y - content.y) / content.scale;
  if (
    localY < layout.secondaryTop - RUNBOOK_TAB_HIT_PAD ||
    localY > layout.secondaryTop + RIGHT_PANEL_SECONDARY_TAB_HEIGHT + RUNBOOK_TAB_HIT_PAD
  ) {
    return -1;
  }

  let tabX = 0;
  for (let index = 0; index < runbookCount; index += 1) {
    const width = measureRunbookTabWidth(titles[index] ?? "");
    const hitLeft = content.x + tabX * content.scale - RUNBOOK_TAB_HIT_PAD * content.scale;
    const hitWidth = (width + RUNBOOK_TAB_HIT_PAD * 2) * content.scale;
    if (x >= hitLeft && x <= hitLeft + hitWidth) return index;
    tabX += width + RUNBOOK_TAB_GAP;
  }
  return -1;
}

function shortenPath(path: string, maxChars: number) {
  if (path.length <= maxChars) return path;
  return `...${path.slice(-(maxChars - 3))}`;
}

function containsCanvasPoint(rect: { x: number; y: number; width: number; height: number }, x: number, y: number) {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function drawSparkline(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  values: number[],
  color: string,
  scaleMax: number
) {
  if (width <= 0 || height <= 0 || values.length === 0) return;

  const peak = Math.max(scaleMax, ...values, 1);
  const points = values.map((value, index) => ({
    x: values.length === 1 ? x + width / 2 : x + (index / (values.length - 1)) * width,
    y: y + height - (Math.max(0, value) / peak) * (height - 2) - 1
  }));
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();

  ctx.fillStyle = palette.bgCard;
  ctx.fillRect(x, y, width, height);

  if (points.length === 1) {
    ctx.strokeStyle = withAlpha(color, 0.35);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, first.y);
    ctx.lineTo(x + width, first.y);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(first.x, first.y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(first.x, y + height);
  for (const point of points) ctx.lineTo(point.x, point.y);
  ctx.lineTo(last.x, y + height);
  ctx.closePath();
  ctx.fillStyle = withAlpha(color, 0.18);
  ctx.fill();

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (!point) continue;
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
  ctx.restore();
}

function withAlpha(color: string, alpha: number) {
  if (color.startsWith("#") && (color.length === 7 || color.length === 4)) {
    const hex = color.length === 4
      ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
      : color;
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const right = x + width;
  const bottom = y + height;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(right - radius, y);
  ctx.quadraticCurveTo(right, y, right, y + radius);
  ctx.lineTo(right, bottom - radius);
  ctx.quadraticCurveTo(right, bottom, right - radius, bottom);
  ctx.lineTo(x + radius, bottom);
  ctx.quadraticCurveTo(x, bottom, x, bottom - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource & { width: number; height: number },
  x: number,
  y: number,
  width: number,
  height: number
) {
  const imageRatio = image.width / image.height;
  const targetRatio = width / height;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = image.width;
  let sourceHeight = image.height;

  if (imageRatio > targetRatio) {
    sourceWidth = sourceHeight * targetRatio;
    sourceX = (image.width - sourceWidth) / 2;
  } else {
    sourceHeight = sourceWidth / targetRatio;
    sourceY = (image.height - sourceHeight) / 2;
  }

  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function normalizeMultilineText(text: string) {
  return text.replace(/\\n/g, "\n");
}

function wrapCharacters(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  let line = "";
  for (const char of text) {
    const candidate = `${line}${char}`;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = char;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines = Number.POSITIVE_INFINITY
) {
  let drawn = 0;

  for (const paragraph of normalizeMultilineText(text).split("\n")) {
    if (drawn >= maxLines) return y;
    if (!paragraph.trim()) {
      y += lineHeight;
      drawn += 1;
      continue;
    }

    const listMatch = paragraph.trim().match(/^(\d+\.\s*)([\s\S]*)$/);
    if (listMatch) {
      const prefix = listMatch[1] ?? "";
      const body = listMatch[2] ?? "";
      const prefixWidth = ctx.measureText(prefix).width;
      const bodyWidth = Math.max(48, maxWidth - prefixWidth);
      const bodyLines = wrapCharacters(ctx, body, bodyWidth);

      for (let index = 0; index < bodyLines.length; index += 1) {
        if (drawn >= maxLines) return y;
        const segment = bodyLines[index] ?? "";
        if (index === 0) {
          ctx.fillText(`${prefix}${segment}`, x, y);
        } else {
          ctx.fillText(segment, x + prefixWidth, y);
        }
        y += lineHeight;
        drawn += 1;
      }
      continue;
    }

    const words = paragraph.includes(" ") ? paragraph.trim().split(/\s+/) : Array.from(paragraph.trim());
    const separator = paragraph.includes(" ") ? " " : "";
    let line = "";

    for (const word of words) {
      const candidate = line ? `${line}${separator}${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        ctx.fillText(line, x, y);
        y += lineHeight;
        drawn += 1;
        if (drawn >= maxLines) return y;
        line = word;
      } else {
        line = candidate;
      }
    }

    if (line) {
      ctx.fillText(line, x, y);
      y += lineHeight;
      drawn += 1;
    }
  }

  return y;
}

function drawMagnifyIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.save();
  ctx.fillStyle = palette.bgOverlayLight;
  roundRect(ctx, x - 2, y - 2, size + 4, size + 4, 4);
  ctx.fill();
  ctx.strokeStyle = palette.textSecondary;
  ctx.lineWidth = 1.5;
  const lensRadius = size * 0.34;
  const lensX = x + size * 0.38;
  const lensY = y + size * 0.38;
  ctx.beginPath();
  ctx.arc(lensX, lensY, lensRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(lensX + lensRadius * 0.72, lensY + lensRadius * 0.72);
  ctx.lineTo(x + size - 2, y + size - 2);
  ctx.stroke();
  ctx.restore();
}

function mirrorTerminalVisualLine(spans: AnsiSpan[], plain: string, sourceIndex: number): TerminalVisualLine {
  return {
    sourceIndex,
    startColumn: 0,
    endColumn: plain.length,
    plain,
    spans
  };
}

function findTerminalCursorVisualLine(lines: TerminalVisualLine[], sourceIndex: number, cursorColumn: number) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line || line.sourceIndex !== sourceIndex) continue;
    if (cursorColumn >= line.startColumn && cursorColumn <= line.endColumn) return index;
  }
  return -1;
}

function emptyTerminalVisualLine(sourceIndex: number): TerminalVisualLine {
  return { sourceIndex, startColumn: 0, endColumn: 0, plain: "", spans: [{ text: "" }] };
}

function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "…";
  let trimmed = text;
  while (trimmed.length > 0 && ctx.measureText(`${trimmed}${ellipsis}`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed ? `${trimmed}${ellipsis}` : ellipsis;
}

function centeredText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, height: number) {
  const metrics = ctx.measureText(text);
  ctx.fillText(text, x + (width - metrics.width) / 2, y + height / 2 + 10);
}

function formatTime(ms: number) {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60).toString().padStart(2, "0");
  const seconds = (total % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatNarrativeClock(narrativeHour: number) {
  const totalMinutes = Math.floor(narrativeHour * 60);
  const hours = Math.floor(totalMinutes / 60).toString().padStart(2, "0");
  const minutes = (totalMinutes % 60).toString().padStart(2, "0");
  return `深夜 ${hours}:${minutes}`;
}

function formatRecordingStatus(status: GameRenderState["recording"]["status"], saveEnabled: boolean) {
  if (!saveEnabled) return "LOG ONLY";
  switch (status) {
    case "recording":
      return "REC";
    case "initializing":
      return "STARTING";
    case "stopping":
    case "finalizing":
      return "SAVING";
    case "ready":
      return "SAVED";
    case "recording_error":
    case "unsupported_browser":
    case "finalization_failed":
      return "REC ERROR";
    case "upload_degraded":
      return "UPLOAD LAG";
    case "consent_required":
      return "CONSENT";
    case "idle":
      return "IDLE";
  }
}

function formatDifficulty(difficulty: GameRenderState["session"]["difficulty"]) {
  if (difficulty === "beginner") return "初級";
  if (difficulty === "intermediate") return "中級";
  return "上級";
}

function formatTerminalInputText(command: string, maxChars = 96) {
  if (command.length <= maxChars) return command;
  return command.slice(-maxChars);
}

function extractTypedCommand(command: string, maxChars = 96) {
  const promptEnd = command.lastIndexOf("# ");
  const typed = promptEnd >= 0 ? command.slice(promptEnd + 2) : command;
  return formatTerminalInputText(typed, maxChars);
}

function inputCaretX(ctx: CanvasRenderingContext2D, text: string, startX: number) {
  const trailingWhitespace = text.match(/[ \t]+$/u)?.[0] ?? "";
  const visibleText = trailingWhitespace ? text.slice(0, -trailingWhitespace.length) : text;
  const metrics = visibleText ? ctx.measureText(visibleText) : undefined;
  const visibleRight = metrics
    ? typeof metrics.actualBoundingBoxRight === "number"
      ? metrics.actualBoundingBoxRight
      : metrics.width
    : 0;
  const whitespaceWidth = trailingWhitespace ? ctx.measureText(trailingWhitespace).width : 0;
  return startX + visibleRight + whitespaceWidth + 2;
}

type MetricsHealthSummary = {
  label: string;
  detail: string;
  color: string;
  level: MetricTone;
};

function metricTone(value: number, warnAt: number, criticalAt: number): MetricTone {
  if (value >= criticalAt) return "critical";
  if (value >= warnAt) return "warn";
  return "healthy";
}

function summarizeMetricsHealth(metrics: MetricsSnapshot): MetricsHealthSummary {
  const issues: string[] = [];
  let level: MetricTone = "healthy";

  const raise = (tone: MetricTone, message: string) => {
    issues.push(message);
    if (tone === "critical") level = "critical";
    else if (tone === "warn" && level !== "critical") level = "warn";
  };

  raise(metricTone(metrics.cpu, 70, 85), "CPU elevated");
  raise(metricTone(metrics.memory, 75, 90), "Memory pressure");
  raise(metricTone(metrics.disk, 80, 92), "Disk pressure");
  if (metrics.http5xxRate > 0) raise("critical", "HTTP 5xx detected");
  raise(metricTone(metrics.latencyP95Ms, 800, 1500), "Latency spike");
  raise(metricTone(metrics.queueDepth, 12, 24), "Queue backlog");

  if (level === "healthy") {
    return {
      level,
      label: "HEALTHY",
      detail: "All monitored signals within SLO",
      color: toneColor("healthy")
    };
  }

  if (level === "warn") {
    return {
      level,
      label: "DEGRADED",
      detail: issues.slice(0, 2).join(" · "),
      color: toneColor("warn")
    };
  }

  return {
    level,
    label: "CRITICAL",
    detail: issues.slice(0, 2).join(" · "),
    color: toneColor("critical")
  };
}
