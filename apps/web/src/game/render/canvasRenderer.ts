import type { GameRenderState, MetricsSnapshot, MetricsSource } from "@incident/shared";

const logicalWidth = 1920;
const logicalHeight = 1080;

export class CanvasRenderer {
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d canvas is required");
    this.ctx = ctx;
    this.canvas.width = logicalWidth;
    this.canvas.height = logicalHeight;
  }

  draw(state: GameRenderState) {
    const ctx = this.ctx;
    ctx.save();
    try {
      ctx.setTransform(this.canvas.width / logicalWidth, 0, 0, this.canvas.height / logicalHeight, 0, 0);
      ctx.clearRect(0, 0, logicalWidth, logicalHeight);
      this.drawRoom();
      this.drawHeader(state);
      this.drawMonitor(70, 140, 540, 620, "METRICS", () => this.drawMetricsPanel(state.monitors.left));
      this.drawMonitor(690, 140, 540, 620, "TERMINAL", () => this.drawTerminal(state));
      this.drawMonitor(1310, 140, 540, 620, "RUNBOOK / SLACK", () => this.drawRightPanel(state));
      this.drawAlerts(state);
      this.drawInputDock(state);
      this.drawClickEffects(state);
      this.drawCursor(state);
    } finally {
      ctx.restore();
    }
  }

  private drawRoom() {
    const gradient = this.ctx.createLinearGradient(0, 0, 0, logicalHeight);
    gradient.addColorStop(0, "#111318");
    gradient.addColorStop(1, "#050609");
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, logicalWidth, logicalHeight);
    this.ctx.fillStyle = "#171b21";
    this.ctx.fillRect(0, 840, logicalWidth, 240);
  }

  private drawHeader(state: GameRenderState) {
    this.ctx.fillStyle = "#e6edf3";
    this.ctx.font = "32px system-ui, sans-serif";
    this.ctx.fillText(state.session.scenarioTitle, 70, 70);
    this.ctx.font = "22px system-ui, sans-serif";
    this.ctx.fillStyle = "#9fb0c0";
    this.ctx.fillText(
      `${formatDifficulty(state.session.difficulty)} / ${formatTime(state.clock.elapsedMs)} / ${formatTime(state.clock.timeLimitMs)} / ${state.clock.speed}x`,
      70,
      108
    );
    this.ctx.fillStyle = state.recording.status === "recording" ? "#ff3b30" : "#64748b";
    this.ctx.beginPath();
    this.ctx.arc(1770, 70, 12, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.fillStyle = "#e6edf3";
    this.ctx.font = "24px system-ui, sans-serif";
    this.ctx.fillText(formatRecordingStatus(state.recording.status), 1792, 78);
  }

  private drawMonitor(x: number, y: number, width: number, height: number, title: string, drawContent: () => void) {
    const contentX = x + 22;
    const contentY = y + 64;
    const contentWidth = width - 44;
    const contentHeight = height - 80;

    this.ctx.fillStyle = "#252b35";
    roundRect(this.ctx, x - 16, y - 16, width + 32, height + 32, 8);
    this.ctx.fill();
    this.ctx.fillStyle = "#05070a";
    roundRect(this.ctx, x, y, width, height, 6);
    this.ctx.fill();
    this.ctx.strokeStyle = "#3d4654";
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    this.ctx.fillStyle = "#89a4c7";
    this.ctx.font = "18px ui-monospace, SFMono-Regular, Menlo, monospace";
    this.ctx.fillText(title, x + 22, y + 36);

    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(contentX, contentY, contentWidth, contentHeight);
    this.ctx.clip();
    this.ctx.translate(contentX, contentY);
    drawContent();
    this.ctx.restore();
  }

  private drawMetricsPanel(left: GameRenderState["monitors"]["left"]) {
    const { metrics, metricsSource } = left;
    const health = summarizeMetricsHealth(metrics);
    const panelWidth = 496;
    const cardHeight = 72;
    const cardGap = 10;
    const rowStride = cardHeight + cardGap;

    this.drawMetricsHealthBanner(health, metricsSource, panelWidth);

    const sections: Array<{
      title: string;
      cards: Array<{
        label: string;
        value: number;
        suffix: string;
        max: number;
        color: string;
      }>;
    }> = [
      {
        title: "RESOURCES",
        cards: [
          {
            label: "CPU",
            value: metrics.cpu,
            suffix: "%",
            max: 100,
            color: toneColor(metricTone(metrics.cpu, 70, 85))
          },
          {
            label: "Memory",
            value: metrics.memory,
            suffix: "%",
            max: 100,
            color: toneColor(metricTone(metrics.memory, 75, 90))
          },
          {
            label: "Disk",
            value: metrics.disk,
            suffix: "%",
            max: 100,
            color: toneColor(metricTone(metrics.disk, 80, 92))
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
            color: toneColor(metrics.http5xxRate > 0 ? "critical" : "healthy")
          },
          {
            label: "Latency p95",
            value: metrics.latencyP95Ms,
            suffix: "ms",
            max: 2000,
            color: toneColor(metricTone(metrics.latencyP95Ms, 800, 1500))
          },
          {
            label: "RPS",
            value: metrics.rps,
            suffix: "",
            max: 80,
            color: "#a78bfa"
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
            color: "#f472b6"
          },
          {
            label: "Queue",
            value: metrics.queueDepth,
            suffix: "",
            max: 40,
            color: toneColor(metricTone(metrics.queueDepth, 12, 24))
          }
        ]
      }
    ];

    let y = 50;
    for (const section of sections) {
      this.ctx.fillStyle = "#64748b";
      this.ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
      this.ctx.fillText(section.title, 0, y);
      y += 14;

      section.cards.forEach((card, index) => {
        const column = index % 2;
        const row = Math.floor(index / 2);
        const cardX = column * 252;
        const cardY = y + row * rowStride;
        this.drawMetricCard(cardX, cardY, 236, cardHeight, card);
      });

      const rows = Math.ceil(section.cards.length / 2);
      y += rows * rowStride + 8;
    }
  }

  private drawMetricsHealthBanner(
    health: MetricsHealthSummary,
    source: MetricsSource,
    panelWidth: number
  ) {
    this.ctx.fillStyle = "#111827";
    roundRect(this.ctx, 0, 0, panelWidth, 40, 8);
    this.ctx.fill();

    this.ctx.fillStyle = health.color;
    this.ctx.beginPath();
    this.ctx.arc(14, 20, 6, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.fillStyle = "#e2e8f0";
    this.ctx.font = "15px system-ui, sans-serif";
    this.ctx.fillText("SERVICE HEALTH", 28, 18);
    this.ctx.fillStyle = "#94a3b8";
    this.ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    this.ctx.fillText(health.detail, 28, 33);

    const badge = health.label;
    const badgeWidth = this.ctx.measureText(badge).width + 20;
    this.ctx.fillStyle = "#1f2937";
    roundRect(this.ctx, panelWidth - badgeWidth - 10, 8, badgeWidth, 24, 6);
    this.ctx.fill();
    this.ctx.fillStyle = health.color;
    this.ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    this.ctx.fillText(badge, panelWidth - badgeWidth + 2, 24);

    const sourceLabel = source === "live" ? "LIVE" : source === "loading" ? "SYNC" : "OFFLINE";
    const sourceColor = source === "live" ? "#22c55e" : source === "loading" ? "#f59e0b" : "#ef4444";
    this.ctx.fillStyle = sourceColor;
    this.ctx.beginPath();
    this.ctx.arc(panelWidth - badgeWidth - 24, 20, 4, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.fillStyle = "#cbd5e1";
    this.ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    this.ctx.fillText(sourceLabel, panelWidth - badgeWidth - 42, 23);
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
    }
  ) {
    this.ctx.fillStyle = "#0b1119";
    roundRect(this.ctx, x, y, width, height, 8);
    this.ctx.fill();
    this.ctx.strokeStyle = "#243041";
    this.ctx.lineWidth = 1;
    this.ctx.stroke();

    this.ctx.fillStyle = "#94a3b8";
    this.ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    this.ctx.fillText(card.label, x + 10, y + 16);

    this.ctx.fillStyle = "#f8fafc";
    this.ctx.font = "bold 20px ui-monospace, SFMono-Regular, Menlo, monospace";
    this.ctx.fillText(`${card.value}${card.suffix}`, x + 10, y + 38);

    const barX = x + 10;
    const barY = y + 48;
    const barWidth = width - 20;
    const ratio = Math.max(0, Math.min(1, card.value / card.max));
    this.ctx.fillStyle = "#1e293b";
    this.ctx.fillRect(barX, barY, barWidth, 6);
    this.ctx.fillStyle = card.color;
    this.ctx.fillRect(barX, barY, barWidth * ratio, 6);
  }

  private drawTerminal(state: GameRenderState) {
    const terminal = state.monitors.center.terminal;
    const contentHeight = 540;
    const lineHeight = 22;
    const maxLines = Math.floor(contentHeight / lineHeight);
    const startLine =
      terminal.lines.length <= maxLines
        ? 0
        : Math.min(
            Math.max(0, terminal.cursor.y - maxLines + 1),
            terminal.lines.length - maxLines
          );
    const visibleLines = terminal.lines.slice(startLine, startLine + maxLines);
    const textBlockHeight = visibleLines.length * lineHeight;
    const baseY = Math.max(20, contentHeight - textBlockHeight);

    this.ctx.fillStyle = "#d1fae5";
    this.ctx.font = "18px ui-monospace, SFMono-Regular, Menlo, monospace";
    visibleLines.forEach((line, index) => {
      this.ctx.fillText(line.trimEnd().slice(0, 72), 0, baseY + index * lineHeight);
    });

    const cursorLine = terminal.cursor.y - startLine;
    if (terminal.cursor.visible && cursorLine >= 0 && cursorLine < visibleLines.length) {
      const line = (visibleLines[cursorLine] ?? "").trimEnd();
      const cursorX = this.ctx.measureText(line.slice(0, terminal.cursor.x)).width;
      this.ctx.fillRect(cursorX, baseY + cursorLine * lineHeight - 16, 10, 20);
    }
  }

  private drawRightPanel(state: GameRenderState) {
    this.ctx.fillStyle = "#e2e8f0";
    this.ctx.font = "22px system-ui, sans-serif";
    this.ctx.fillText(state.monitors.right.activeRunbook?.title ?? "Runbook", 0, 24);
    this.ctx.font = "17px system-ui, sans-serif";
    const body = state.monitors.right.activeRunbook?.body ?? "";
    wrapText(this.ctx, body, 0, 58, 470, 24, 13);
    this.ctx.fillStyle = "#f8fafc";
    this.ctx.font = "20px system-ui, sans-serif";
    this.ctx.fillText("Slack", 0, 390);
    this.ctx.font = "16px system-ui, sans-serif";
    let y = 420;
    for (const message of state.monitors.right.slackMessages.slice(-4)) {
      y = wrapText(this.ctx, `${message.from}: ${message.body}`, 0, y, 470, 22, 2) + 8;
    }
  }

  private drawAlerts(state: GameRenderState) {
    const alert = state.monitors.left.alerts[state.monitors.left.alerts.length - 1];
    if (!alert) return;
    this.ctx.fillStyle = "rgba(239, 68, 68, 0.92)";
    roundRect(this.ctx, 70, 778, 1780, 48, 8);
    this.ctx.fill();
    this.ctx.fillStyle = "#fff";
    this.ctx.font = "22px system-ui, sans-serif";
    this.ctx.fillText(alert.message, 104, 808);
  }

  private drawInputDock(state: GameRenderState) {
    const input = inputDockRects.input;
    const button = inputDockRects.button;
    const enabled = state.session.status === "running";
    const typed = extractTypedCommand(state.monitors.center.terminal.commandDraft);

    this.ctx.fillStyle = "#090d14";
    this.ctx.fillRect(0, 850, logicalWidth, 170);

    this.ctx.fillStyle = "#64748b";
    this.ctx.font = "14px ui-monospace, SFMono-Regular, Menlo, monospace";
    this.ctx.fillText("INPUT", input.x, input.y - 10);

    this.ctx.fillStyle = "#020617";
    roundRect(this.ctx, input.x, input.y, input.width, input.height, 8);
    this.ctx.fill();
    this.ctx.strokeStyle = enabled ? "#334155" : "#1e293b";
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    const inputTextY = input.y + Math.round(input.height / 2) + 8;
    this.ctx.font = "22px ui-monospace, SFMono-Regular, Menlo, monospace";
    if (typed) {
      this.ctx.fillStyle = "#d1fae5";
      this.ctx.fillText(typed, input.x + 20, inputTextY);
      if (enabled) {
        const textWidth = this.ctx.measureText(typed).width;
        this.ctx.fillRect(input.x + 20 + textWidth + 4, inputTextY - 22, 10, 28);
      }
    } else {
      this.ctx.fillStyle = "#475569";
      this.ctx.fillText(enabled ? "コマンドを入力…" : "セッション開始後に入力できます", input.x + 20, inputTextY);
    }

    this.ctx.fillStyle = enabled ? "#1f2937" : "#111827";
    roundRect(this.ctx, button.x, button.y, button.width, button.height, 8);
    this.ctx.fill();
    this.ctx.strokeStyle = "#334155";
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    this.ctx.fillStyle = enabled ? "#f8fafc" : "#94a3b8";
    this.ctx.font = "28px system-ui, sans-serif";
    centeredText(this.ctx, "復旧完了", button.x, button.y + 2, button.width, button.height);
  }

  private drawClickEffects(state: GameRenderState) {
    for (const effect of state.clickEffects) {
      const opacity = Math.max(0, 1 - effect.ageMs / 600);
      this.ctx.strokeStyle = `rgba(94, 234, 212, ${opacity})`;
      this.ctx.lineWidth = 4;
      this.ctx.beginPath();
      this.ctx.arc(effect.x, effect.y, 16 + effect.ageMs / 18, 0, Math.PI * 2);
      this.ctx.stroke();
    }
  }

  private drawCursor(state: GameRenderState) {
    if (!state.cursor.visible) return;
    this.ctx.fillStyle = "#ffffff";
    this.ctx.beginPath();
    this.ctx.moveTo(state.cursor.x, state.cursor.y);
    this.ctx.lineTo(state.cursor.x + 20, state.cursor.y + 44);
    this.ctx.lineTo(state.cursor.x + 32, state.cursor.y + 28);
    this.ctx.closePath();
    this.ctx.fill();
  }
}

export const inputDockRects = {
  input: { x: 70, y: 878, width: 1580, height: 96 },
  button: { x: 1670, y: 878, width: 180, height: 96 }
} as const;

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

  for (const paragraph of text.split("\n")) {
    if (drawn >= maxLines) return y;
    if (!paragraph.trim()) {
      y += lineHeight;
      drawn += 1;
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

function formatRecordingStatus(status: GameRenderState["recording"]["status"]) {
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
  const trimmed = command.trimEnd();
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(-maxChars);
}

function extractTypedCommand(command: string, maxChars = 96) {
  const trimmed = command.trimEnd();
  const promptEnd = trimmed.lastIndexOf("# ");
  const typed = promptEnd >= 0 ? trimmed.slice(promptEnd + 2) : trimmed;
  return formatTerminalInputText(typed, maxChars);
}

type MetricTone = "healthy" | "warn" | "critical";

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

function toneColor(tone: MetricTone) {
  if (tone === "critical") return "#ef4444";
  if (tone === "warn") return "#f59e0b";
  return "#22c55e";
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
      color: "#22c55e"
    };
  }

  if (level === "warn") {
    return {
      level,
      label: "DEGRADED",
      detail: issues.slice(0, 2).join(" · "),
      color: "#f59e0b"
    };
  }

  return {
    level,
    label: "CRITICAL",
    detail: issues.slice(0, 2).join(" · "),
    color: "#ef4444"
  };
}
