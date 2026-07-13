export const gamePalette = {
  bgRoomTop: '#0c130d',
  bgRoomBottom: '#040604',
  bgDesk: '#060a07',
  bgPanel: '#070c08',
  bgPanelDark: '#030503',
  bgOverlay: 'rgba(6, 10, 7, 0.97)',
  bgOverlayLight: 'rgba(6, 10, 7, 0.72)',
  bgTerminal: '#030503',
  bgCard: '#0c130d',
  bgCardDark: '#050805',
  bgCardActive: '#101c13',
  bgInput: '#030503',
  bgWarning: 'rgba(58, 21, 21, 0.92)',
  bgChatActive: '#101c13',
  bgChatIdle: '#0b0f0b',
  bgDevtoolsActive: '#101c13',
  bgDevtoolsIdle: '#070c08',
  bgButtonPrimary: '#7cfc9a',
  bgButtonSecondary: 'transparent',
  bgButtonDanger: 'transparent',
  bgButtonDangerDisabled: '#1f1313',
  bgMonitor: '#0c130d',

  textPrimary: '#d8f3dc',
  textSecondary: '#8aa892',
  textMuted: '#5e7a66',
  textDim: '#5e7a66',
  textTerminal: '#b7f2c3',
  textTerminalMuted: '#7cfc9a',
  textOnPrimary: '#050705',
  textOnAccent: '#050705',
  textLink: '#7cfc9a',
  textWarning: '#ffcf5c',
  textWarningFg: '#ff9a9a',
  textClock: '#ffcf5c',
  textBadge: '#d8f3dc',
  /** Dark maroon text drawn directly on the solid alert-band red. */
  textOnDangerStrong: '#3a0808',
  textOnDangerBody: '#2b0505',

  borderDefault: '#2c5e38',
  borderMuted: '#15291a',
  borderPanel: '#15291a',
  borderFocus: '#7cfc9a',
  borderChatActive: '#7cfc9a',
  borderDanger: '#ff6b6b',
  borderUnread: '#ff6b6b',

  accentGreen: '#7cfc9a',
  accentGreenDark: '#2c5e38',
  accentGreenBg: '#101c13',
  accentBlue: '#7cfc9a',
  accentCyan: '#7cfc9a',
  accentPurple: '#b7f2c3',
  accentPink: '#8aa892',

  statusHealthy: '#7cfc9a',
  statusWarn: '#ffcf5c',
  statusCritical: '#ff6b6b',
  statusInfo: '#8aa892',
  statusRecording: '#ff3b30',
  statusOffline: '#5e7a66',
  statusLive: '#7cfc9a',
  statusLoading: '#ffcf5c',
  statusError: '#ff6b6b',

  metricHealthy: '#7cfc9a',
  metricWarn: '#ffcf5c',
  metricCritical: '#ff6b6b',
} as const;

export type {MetricTone} from '../../pure/paletteHelpers.js';
export {toneColor, severityColor} from '../../pure/paletteHelpers.js';

/** Minimum font size for canvas text (WCAG AAA readability). */
export const fontFloor = 16;

export const gameFonts = {
  ui: "'IBM Plex Sans JP', system-ui, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  display: "'DotGothic16', monospace",
} as const;

export function uiFont(
  size: number,
  weight: 'normal' | 'bold' = 'normal'
): string {
  return `${weight === 'bold' ? 'bold ' : ''}${String(Math.max(size, fontFloor))}px ${gameFonts.ui}`;
}

export function monoFont(
  size: number,
  weight: 'normal' | 'bold' | 'lighter' = 'normal'
): string {
  const prefix =
    weight === 'bold' ? 'bold ' : weight === 'lighter' ? 'lighter ' : '';
  return `${prefix}${String(Math.max(size, fontFloor))}px ${gameFonts.mono}`;
}

export function displayFont(
  size: number,
  weight: 'normal' | 'bold' = 'normal'
): string {
  return `${weight === 'bold' ? 'bold ' : ''}${String(Math.max(size, fontFloor))}px ${gameFonts.display}`;
}
