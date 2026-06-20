import type { GameRenderState, MetricsSnapshot, MetricsSource } from "@incident/shared";
import { mergedSlackMessages } from "../state/gameState.js";

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

  draw(state: GameRenderState, scenario?: import("@incident/shared").ScenarioDefinition) {
    const ctx = this.ctx;
    ctx.save();
    try {
      ctx.setTransform(this.canvas.width / logicalWidth, 0, 0, this.canvas.height / logicalHeight, 0, 0);
      ctx.clearRect(0, 0, logicalWidth, logicalHeight);
      this.drawRoom();
      this.drawHeader(state);
      this.drawNotifications(state);
      this.drawMonitor(70, 140, 540, 620, "METRICS", () => this.drawMetricsPanel(state.monitors.left));
      this.drawMonitor(690, 140, 540, 620, "TERMINAL", () => this.drawTerminal(state));
      this.drawMonitor(1310, 140, 540, 620, "RUNBOOK / SLACK", () => this.drawRightPanel(state, scenario));
      this.drawAlerts(state);
      if (state.alertFlashMs > 0) this.drawAlertFlash(state.alertFlashMs);
      this.drawNavigationOverlay(state, scenario);
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
    this.ctx.fillStyle = state.recording.saveEnabled
      ? state.recording.status === "recording"
        ? "#ff3b30"
        : "#64748b"
      : "#64748b";
    this.ctx.beginPath();
    this.ctx.arc(1770, 70, 12, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.fillStyle = "#e6edf3";
    this.ctx.font = "24px system-ui, sans-serif";
    this.ctx.fillText(formatRecordingStatus(state.recording.status, state.recording.saveEnabled), 1792, 78);
  }

  private drawNotifications(state: GameRenderState) {
    const unread = state.monitors.left.alerts.filter(
      (alert) => !state.notifications.readAlertIds.includes(alert.id)
    ).length;
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

    this.ctx.fillStyle = pulsing ? "#7f1d1d" : "#1e293b";
    roundRect(this.ctx, bell.x, bell.y, bell.width, bell.height, 10);
    this.ctx.fill();
    this.ctx.strokeStyle = unread > 0 ? "#f87171" : "#475569";
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    this.drawBellGlyph(bell.x + bell.width / 2, bell.y + bell.height / 2 - 2, unread > 0 || pulsing);

    if (unread > 0) {
      const badge = String(Math.min(unread, 9));
      const badgeWidth = badge.length > 1 ? 28 : 22;
      this.ctx.fillStyle = "#ef4444";
      roundRect(this.ctx, bell.x + bell.width - badgeWidth + 4, bell.y - 4, badgeWidth, 22, 11);
      this.ctx.fill();
      this.ctx.fillStyle = "#fff";
      this.ctx.font = "bold 13px system-ui, sans-serif";
      this.ctx.fillText(badge, bell.x + bell.width - badgeWidth + 11, bell.y + 12);
    }

    if (state.notifications.panelOpen) {
      this.drawNotificationPanel(state);
    }
  }

  private drawBellGlyph(cx: number, cy: number, active: boolean) {
    this.ctx.save();
    this.ctx.translate(cx, cy);
    this.ctx.fillStyle = active ? "#fecaca" : "#cbd5e1";
    this.ctx.strokeStyle = active ? "#fecaca" : "#cbd5e1";
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
    this.ctx.fillStyle = "rgba(15, 23, 42, 0.97)";
    roundRect(this.ctx, panel.x, panel.y, panel.width, panel.height, 12);
    this.ctx.fill();
    this.ctx.strokeStyle = "#334155";
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    this.ctx.fillStyle = "#e2e8f0";
    this.ctx.font = "18px system-ui, sans-serif";
    this.ctx.fillText("通知", panel.x + 18, panel.y + 30);
    this.ctx.fillStyle = "#94a3b8";
    this.ctx.font = "13px system-ui, sans-serif";
    this.ctx.fillText("障害アラート", panel.x + 18, panel.y + 50);

    const alerts = [...state.monitors.left.alerts].reverse();
    if (alerts.length === 0) {
      this.ctx.fillStyle = "#64748b";
      this.ctx.font = "15px system-ui, sans-serif";
      this.ctx.fillText("通知はまだありません", panel.x + 18, panel.y + 90);
      return;
    }

    let y = panel.y + 72;
    for (const alert of alerts.slice(0, 6)) {
      const unread = !state.notifications.readAlertIds.includes(alert.id);
      const color = severityColor(alert.severity);
      this.ctx.fillStyle = unread ? "#1e293b" : "#111827";
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
      this.ctx.fillStyle = "#f8fafc";
      this.ctx.font = "bold 12px ui-monospace, SFMono-Regular, Menlo, monospace";
      this.ctx.fillText(alert.severity.toUpperCase(), panel.x + 40, y + 22);
      this.ctx.fillStyle = "#cbd5e1";
      this.ctx.font = "14px system-ui, sans-serif";
      wrapText(this.ctx, alert.message, panel.x + 40, y + 40, panel.width - 56, 18, 2);
      y += 62;
    }
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

    if (left.metricsHistory.length > 1) {
      this.drawSparkline(0, 44, panelWidth, 28, left.metricsHistory.map((item) => item.http5xxRate * 100), "#f87171");
    }

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
    const devtools = state.monitors.center.devtools;
    if (devtools?.visible) {
      this.drawDevtoolsPanel(devtools);
      return;
    }

    const terminal = state.monitors.center.terminal;
    this.ctx.fillStyle = "#64748b";
    this.ctx.font = "12px system-ui, sans-serif";
    this.ctx.fillText("DevTools", 400, 18);
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

  private drawRightPanel(state: GameRenderState, scenario?: import("@incident/shared").ScenarioDefinition) {
    const runbooks = scenario?.runbooks ?? (state.monitors.right.activeRunbook ? [state.monitors.right.activeRunbook] : []);
    let tabX = 0;
    for (let index = 0; index < runbooks.length; index += 1) {
      const runbook = runbooks[index];
      if (!runbook) continue;
      const active = index === state.monitors.right.activeRunbookIndex;
      this.ctx.fillStyle = active ? "#1e293b" : "#0f172a";
      const width = Math.min(150, this.ctx.measureText(runbook.title).width + 24);
      roundRect(this.ctx, tabX, 0, width, 28, 4);
      this.ctx.fill();
      this.ctx.fillStyle = active ? "#e2e8f0" : "#64748b";
      this.ctx.font = "13px system-ui, sans-serif";
      this.ctx.fillText(runbook.title.slice(0, 14), tabX + 8, 18);
      tabX += width + 6;
    }

    this.ctx.fillStyle = "#e2e8f0";
    this.ctx.font = "22px system-ui, sans-serif";
    this.ctx.fillText(state.monitors.right.activeRunbook?.title ?? "Runbook", 0, 54);
    this.ctx.font = "17px system-ui, sans-serif";
    const body = state.monitors.right.activeRunbook?.body ?? "";
    wrapText(this.ctx, body, 0, 88, 470, 24, 11);
    this.ctx.fillStyle = "#f8fafc";
    this.ctx.font = "20px system-ui, sans-serif";
    this.ctx.fillText("Slack", 0, 390);
    this.ctx.font = "16px system-ui, sans-serif";
    let y = 420;
    for (const message of mergedSlackMessages(state).slice(-4)) {
      const prefix = message.from === "あなた" ? "▸ " : "";
      const color = message.from === "あなた" ? "#93c5fd" : "#e2e8f0";
      this.ctx.fillStyle = color;
      y = wrapText(this.ctx, `${prefix}${message.from}: ${message.body}`, 0, y, 470, 22, 2) + 8;
    }

    this.drawSlackCompose(state);
  }

  private drawSlackCompose(state: GameRenderState) {
    const boxY = 484;
    const active = state.slackCompose.active;
    this.ctx.fillStyle = active ? "#1e3a5f" : "#0f172a";
    roundRect(this.ctx, 0, boxY, 470, 44, 6);
    this.ctx.fill();
    this.ctx.strokeStyle = active ? "#3b82f6" : "#334155";
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    this.ctx.fillStyle = active ? "#dbeafe" : "#64748b";
    this.ctx.font = "15px system-ui, sans-serif";
    const draft = state.slackCompose.draft;
    const placeholder = "状況を報告... (クリックして入力)";
    const text = draft.length > 0 ? draft : placeholder;
    this.ctx.fillText(text.slice(0, 42), 12, boxY + 28);

    if (active && draft.length > 0) {
      this.ctx.fillStyle = "#22c55e";
      roundRect(this.ctx, 404, boxY + 8, 56, 28, 4);
      this.ctx.fill();
      this.ctx.fillStyle = "#052e16";
      this.ctx.font = "bold 13px system-ui, sans-serif";
      this.ctx.fillText("送信", 416, boxY + 27);
    }
  }

  private drawDevtoolsPanel(devtools: NonNullable<GameRenderState["monitors"]["center"]["devtools"]>) {
    const tabs: Array<{ id: typeof devtools.tab; label: string }> = [
      { id: "network", label: "Network" },
      { id: "console", label: "Console" },
      { id: "storage", label: "Storage" }
    ];
    let tabX = 0;
    for (const tab of tabs) {
      const active = tab.id === devtools.tab;
      this.ctx.fillStyle = active ? "#1d4ed8" : "#1e293b";
      roundRect(this.ctx, tabX, 0, 108, 28, 4);
      this.ctx.fill();
      this.ctx.fillStyle = "#e2e8f0";
      this.ctx.font = "13px system-ui, sans-serif";
      this.ctx.fillText(tab.label, tabX + 10, 18);
      tabX += 114;
    }

    this.ctx.fillStyle = "#cbd5e1";
    this.ctx.font = "15px ui-monospace, SFMono-Regular, Menlo, monospace";
    let y = 48;
    if (devtools.tab === "network") {
      for (const line of devtools.networkLines.slice(-14)) {
        this.ctx.fillText(`${line.at} ${line.method} ${line.path} ${line.status}`, 0, y);
        y += 20;
      }
    } else if (devtools.tab === "console") {
      for (const line of devtools.consoleLines.slice(-14)) {
        this.ctx.fillText(line.slice(0, 68), 0, y);
        y += 20;
      }
    } else {
      for (const entry of devtools.storageEntries.slice(-10)) {
        this.ctx.fillText(`${entry.key}: ${entry.value.slice(0, 48)}`, 0, y);
        y += 22;
      }
    }
  }

  private drawAlertFlash(remainingMs: number) {
    const opacity = Math.min(0.35, remainingMs / 1200);
    this.ctx.fillStyle = `rgba(239, 68, 68, ${opacity})`;
    this.ctx.fillRect(0, 0, logicalWidth, logicalHeight);
  }

  private drawNavigationOverlay(state: GameRenderState, scenario?: import("@incident/shared").ScenarioDefinition) {
    const step = scenario?.navigationSteps?.find((item) => item.id === state.navigation.activeStepId);
    if (!step || state.session.difficulty !== "beginner") return;

    const box = navigationOverlayRect;
    this.ctx.fillStyle = "rgba(15, 23, 42, 0.94)";
    roundRect(this.ctx, box.x, box.y, box.width, box.height, 10);
    this.ctx.fill();
    this.ctx.strokeStyle = "#38bdf8";
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    this.ctx.fillStyle = "#38bdf8";
    this.ctx.font = "14px system-ui, sans-serif";
    this.ctx.fillText("NAV", box.x + 16, box.y + 28);
    this.ctx.fillStyle = "#e2e8f0";
    this.ctx.font = "18px system-ui, sans-serif";
    wrapText(this.ctx, step.hint, box.x + 16, box.y + 52, box.width - 32, 24, 3);
    if (step.suggestedCommand) {
      this.ctx.fillStyle = "#94a3b8";
      this.ctx.font = "14px ui-monospace, SFMono-Regular, Menlo, monospace";
      this.ctx.fillText(`例: ${step.suggestedCommand}`, box.x + 16, box.y + box.height - 24);
    }
  }

  private drawSparkline(x: number, y: number, width: number, height: number, values: number[], color: string) {
    if (values.length < 2) return;
    const max = Math.max(...values, 1);
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    values.forEach((value, index) => {
      const px = x + (index / (values.length - 1)) * width;
      const py = y + height - (value / max) * height;
      if (index === 0) this.ctx.moveTo(px, py);
      else this.ctx.lineTo(px, py);
    });
    this.ctx.stroke();
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
    this.ctx.font = "24px system-ui, sans-serif";
    centeredText(this.ctx, "復旧完了", button.x, button.y + 2, button.width, button.height);

    const retire = inputDockRects.retire;
    this.ctx.fillStyle = enabled ? "#3f1d1d" : "#1f1313";
    roundRect(this.ctx, retire.x, retire.y, retire.width, retire.height, 8);
    this.ctx.fill();
    this.ctx.strokeStyle = "#7f1d1d";
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    this.ctx.fillStyle = enabled ? "#fecaca" : "#94a3b8";
    this.ctx.font = "22px system-ui, sans-serif";
    centeredText(this.ctx, "リタイア", retire.x, retire.y + 2, retire.width, retire.height);
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

export const notificationBellRegion = { x: 1508, y: 34, width: 52, height: 52 } as const;

export const notificationPanelRegion = { x: 1188, y: 92, width: 372, height: 420 } as const;

export const inputDockRects = {
  input: { x: 70, y: 878, width: 1280, height: 96 },
  retire: { x: 1370, y: 878, width: 140, height: 96 },
  button: { x: 1530, y: 878, width: 160, height: 96 }
} as const;

export const navigationOverlayRect = { x: 720, y: 860, width: 480, height: 120 } as const;

export const runbookTabRegion = { x: 1332, y: 204, width: 516, height: 36 } as const;

export const devtoolsToggleRegion = { x: 712, y: 204, width: 120, height: 28 } as const;

export const slackComposeRegion = { x: 1332, y: 688, width: 496, height: 48 } as const;

export const slackSendButtonRegion = { x: 1736, y: 696, width: 56, height: 28 } as const;

export const devtoolsTabRegion = { x: 712, y: 236, width: 516, height: 28 } as const;

export function slackComposeAt(x: number, y: number) {
  if (!containsCanvasPoint(slackComposeRegion, x, y)) return null;
  if (containsCanvasPoint(slackSendButtonRegion, x, y)) return "send" as const;
  return "compose" as const;
}

export function runbookTabAt(x: number, y: number, runbookCount: number, titles: string[]) {
  if (!containsCanvasPoint(runbookTabRegion, x, y) || runbookCount === 0) return -1;
  let tabX = runbookTabRegion.x;
  const localY = y - runbookTabRegion.y;
  if (localY < 0 || localY > 28) return -1;
  for (let index = 0; index < runbookCount; index += 1) {
    const title = titles[index] ?? "";
    const width = Math.min(150, title.length * 9 + 24);
    if (x >= tabX && x <= tabX + width) return index;
    tabX += width + 6;
  }
  return -1;
}

export function devtoolsTabAt(x: number, y: number): "network" | "console" | "storage" | null {
  if (!containsCanvasPoint(devtoolsTabRegion, x, y)) return null;
  const localX = x - (devtoolsTabRegion.x + 22);
  if (localX < 108) return "network";
  if (localX < 222) return "console";
  if (localX < 336) return "storage";
  return null;
}

function containsCanvasPoint(rect: { x: number; y: number; width: number; height: number }, x: number, y: number) {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
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

function severityColor(severity: "info" | "warning" | "critical") {
  if (severity === "critical") return "#ef4444";
  if (severity === "warning") return "#f59e0b";
  return "#38bdf8";
}
