import type { GameRenderState, MetricsSnapshot } from "@incident/shared";

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
      this.drawMonitor(70, 160, 540, 650, "METRICS", () => this.drawMetrics(state.monitors.left.metrics));
      this.drawMonitor(690, 130, 540, 720, "TERMINAL", () => this.drawTerminal(state));
      this.drawMonitor(1310, 160, 540, 650, "RUNBOOK / SLACK", () => this.drawRightPanel(state));
      this.drawAlerts(state);
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
    this.ctx.fillRect(0, 880, logicalWidth, 200);
  }

  private drawHeader(state: GameRenderState) {
    this.ctx.fillStyle = "#e6edf3";
    this.ctx.font = "32px system-ui, sans-serif";
    this.ctx.fillText(state.session.scenarioTitle, 70, 70);
    this.ctx.font = "22px system-ui, sans-serif";
    this.ctx.fillStyle = "#9fb0c0";
    this.ctx.fillText(`${state.session.difficulty} / ${formatTime(state.clock.elapsedMs)} / ${formatTime(state.clock.timeLimitMs)}`, 70, 108);
    this.ctx.fillStyle = state.recording.status === "recording" ? "#ff3b30" : "#64748b";
    this.ctx.beginPath();
    this.ctx.arc(1770, 70, 12, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.fillStyle = "#e6edf3";
    this.ctx.font = "24px system-ui, sans-serif";
    this.ctx.fillText(formatRecordingStatus(state.recording.status), 1792, 78);
  }

  private drawMonitor(x: number, y: number, width: number, height: number, title: string, drawContent: () => void) {
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
    this.ctx.translate(x + 22, y + 64);
    drawContent();
    this.ctx.restore();
  }

  private drawMetrics(metrics: MetricsSnapshot) {
    const rows = [
      { label: "CPU", value: metrics.cpu, suffix: "%", color: "#f59e0b", max: 100 },
      { label: "Memory", value: metrics.memory, suffix: "%", color: "#38bdf8", max: 100 },
      { label: "Disk", value: metrics.disk, suffix: "%", color: metrics.disk > 90 ? "#ef4444" : "#22c55e", max: 100 },
      {
        label: "HTTP 5xx",
        value: Math.round(metrics.http5xxRate * 100),
        suffix: "%",
        color: metrics.http5xxRate > 0 ? "#ef4444" : "#22c55e",
        max: 100
      },
      {
        label: "Latency p95",
        value: metrics.latencyP95Ms,
        suffix: "ms",
        color: metrics.latencyP95Ms > 1000 ? "#ef4444" : "#22c55e",
        max: 2000
      },
      { label: "RPS", value: metrics.rps, suffix: "", color: "#a78bfa", max: 80 },
      { label: "DB Conn", value: metrics.dbConnections, suffix: "", color: "#f472b6", max: 40 },
      { label: "Queue", value: metrics.queueDepth, suffix: "", color: "#facc15", max: 40 }
    ];

    rows.forEach(({ label, value, suffix, color, max }, index) => {
      const y = 26 + index * 62;
      this.ctx.fillStyle = "#cbd5e1";
      this.ctx.font = "20px ui-monospace, SFMono-Regular, Menlo, monospace";
      this.ctx.fillText(label, 0, y);
      this.ctx.fillStyle = "#1f2937";
      this.ctx.fillRect(170, y - 20, 260, 18);
      this.ctx.fillStyle = color;
      this.ctx.fillRect(170, y - 20, Math.min(260, Math.max(0, (Number(value) / max) * 260)), 18);
      this.ctx.fillStyle = "#e2e8f0";
      this.ctx.fillText(`${value}${suffix}`, 445, y);
    });
  }

  private drawTerminal(state: GameRenderState) {
    const terminal = state.monitors.center.terminal;
    const visibleLines = terminal.lines.slice(-27);
    const firstVisibleLine = Math.max(0, terminal.lines.length - visibleLines.length);

    this.ctx.fillStyle = "#d1fae5";
    this.ctx.font = "18px ui-monospace, SFMono-Regular, Menlo, monospace";
    visibleLines.forEach((line, index) => {
      this.ctx.fillText(line.slice(0, 72), 0, 28 + index * 22);
    });

    const cursorLine = terminal.cursor.y - firstVisibleLine;
    if (terminal.cursor.visible && cursorLine >= 0 && cursorLine < visibleLines.length) {
      const line = visibleLines[cursorLine] ?? "";
      const cursorX = this.ctx.measureText(line.slice(0, terminal.cursor.x)).width;
      this.ctx.fillRect(cursorX, 12 + cursorLine * 22, 10, 20);
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
    this.ctx.fillText("Slack", 0, 420);
    this.ctx.font = "16px system-ui, sans-serif";
    let y = 454;
    for (const message of state.monitors.right.slackMessages.slice(-4)) {
      y = wrapText(this.ctx, `${message.from}: ${message.body}`, 0, y, 470, 22, 2) + 8;
    }
  }

  private drawAlerts(state: GameRenderState) {
    const alert = state.monitors.left.alerts[state.monitors.left.alerts.length - 1];
    if (!alert) return;
    this.ctx.fillStyle = "rgba(239, 68, 68, 0.92)";
    roundRect(this.ctx, 550, 920, 820, 70, 8);
    this.ctx.fill();
    this.ctx.fillStyle = "#fff";
    this.ctx.font = "24px system-ui, sans-serif";
    this.ctx.fillText(alert.message, 584, 964);
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
