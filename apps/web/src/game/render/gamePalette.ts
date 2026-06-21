export const gamePalette = {
  bgRoomTop: "#111318",
  bgRoomBottom: "#050609",
  bgDesk: "#171b21",
  bgPanel: "#0b1119",
  bgPanelDark: "#05070a",
  bgOverlay: "rgba(15, 23, 42, 0.97)",
  bgOverlayLight: "rgba(15, 23, 42, 0.72)",
  bgTerminal: "#05070a",
  bgCard: "#1e293b",
  bgCardDark: "#111827",
  bgCardActive: "#0f172a",
  bgInput: "#1f2937",
  bgWarning: "rgba(127, 29, 29, 0.92)",
  bgSlackActive: "#0a1a0f",
  bgSlackIdle: "#0b0f14",
  bgDevtoolsActive: "#1e3a5f",
  bgDevtoolsIdle: "#0f172a",
  bgButtonPrimary: "#1d4ed8",
  bgButtonSecondary: "#1e293b",
  bgButtonDanger: "#3f1d1d",
  bgButtonDangerDisabled: "#1f1313",
  bgMonitor: "#252b35",

  textPrimary: "#f0f4f8",
  textSecondary: "#c5d0dc",
  textMuted: "#9aa8b8",
  textDim: "#b0bcc8",
  textTerminal: "#d1fae5",
  textTerminalMuted: "#a8f5c4",
  textOnPrimary: "#f0f4f8",
  textOnAccent: "#041410",
  textLink: "#9ecbff",
  textWarning: "#ffe08a",
  textWarningFg: "#fecaca",
  textClock: "#fbbf24",
  textBadge: "#ffffff",

  borderDefault: "#334155",
  borderMuted: "#3d4654",
  borderPanel: "#243041",
  borderFocus: "#5ec8ff",
  borderSlackActive: "#22c55e",
  borderDanger: "#7f1d1d",
  borderUnread: "#f87171",

  accentGreen: "#4ade80",
  accentGreenDark: "#166534",
  accentGreenBg: "#052e16",
  accentBlue: "#3b82f6",
  accentCyan: "#38bdf8",
  accentPurple: "#c4b5fd",
  accentPink: "#f9a8d4",

  statusHealthy: "#4ade80",
  statusWarn: "#fbbf24",
  statusCritical: "#f87171",
  statusInfo: "#5ec8ff",
  statusRecording: "#ff3b30",
  statusOffline: "#9aa8b8",
  statusLive: "#4ade80",
  statusLoading: "#fbbf24",
  statusError: "#f87171",

  metricHealthy: "#4ade80",
  metricWarn: "#fbbf24",
  metricCritical: "#f87171"
} as const;

export type MetricTone = "healthy" | "warn" | "critical";

export function toneColor(tone: MetricTone): string {
  if (tone === "critical") return gamePalette.metricCritical;
  if (tone === "warn") return gamePalette.metricWarn;
  return gamePalette.metricHealthy;
}

export function severityColor(severity: "info" | "warning" | "critical"): string {
  if (severity === "critical") return gamePalette.statusCritical;
  if (severity === "warning") return gamePalette.statusWarn;
  return gamePalette.statusInfo;
}

/** Minimum font size for canvas text (WCAG AAA readability). */
export const fontFloor = 16;

export const gameFonts = {
  ui: "system-ui, sans-serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace"
} as const;

export function uiFont(size: number, weight: "normal" | "bold" = "normal"): string {
  return `${weight === "bold" ? "bold " : ""}${Math.max(size, fontFloor)}px ${gameFonts.ui}`;
}

export function monoFont(size: number, weight: "normal" | "bold" | "lighter" = "normal"): string {
  const prefix = weight === "bold" ? "bold " : weight === "lighter" ? "lighter " : "";
  return `${prefix}${Math.max(size, fontFloor)}px ${gameFonts.mono}`;
}
