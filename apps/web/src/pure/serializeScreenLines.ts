import type {GameRenderState} from '@incident/shared';
import {stripAnsi} from './ansi.js';
import {formatMetricValue, summarizeMetricsHealth} from './canvasFormat.js';
import type {CanvasViewModel} from './canvasViewModel.js';
import {buildMetricSections} from './metricsSections.js';

/** Matches the AI Assist grounding fixtures' "TERMINAL: <line>" tail convention. */
const TERMINAL_TAIL_LINE_COUNT = 30;
/** Matches the AI Assist grounding fixtures' "EDITOR: <line>" head convention. */
const EDITOR_HEAD_LINE_COUNT = 30;

/**
 * Metric card labels are not expected to contain ":" or "->" (assistGrounding
 * treats a leading "label:" as a strippable prefix and "->" as a command
 * chain marker), but this defensively removes them so an unexpected label
 * never gets misread as either by the grounding validator.
 */
function sanitizeCardLabel(label: string): string {
  return label.replaceAll(':', '').replaceAll('->', '').trim();
}

/**
 * Serializes the literal on-screen text of the game canvas into flat lines,
 * in the same convention as the AI Assist benchmark fixtures
 * (scripts/fixtures/ai-assist-scenario-cases.json `canvas.lines`), so the
 * assistant's answer can be cross-checked against exactly what a player
 * could see. Pure function: no DOM, no effects.
 */
export function serializeScreenLines(
  state: GameRenderState,
  viewModel: CanvasViewModel
): string[] {
  const lines: string[] = [];

  const pushLine = (line: string) => {
    if (line.length === 0) return;
    lines.push(line);
  };
  const pushPrefixed = (prefix: string, content: string) => {
    if (content.length === 0) return;
    lines.push(`${prefix}${content}`);
  };

  const {metrics, edgeRttMs, edgeRttHistory} = state.monitors.left;
  pushLine(`SERVICE HEALTH   ${summarizeMetricsHealth(metrics).label}`);

  for (const section of buildMetricSections({
    metrics,
    edgeRttMs,
    edgeRttHistory,
  })) {
    for (const card of section.cards) {
      pushLine(
        `${sanitizeCardLabel(card.label).toUpperCase()}   ${formatMetricValue(card.value, card.suffix)}`
      );
    }
  }

  for (const item of viewModel.notificationPanelItems) {
    if (item.kind === 'alert') {
      pushPrefixed('ALERT: ', item.alert.message);
    } else {
      pushPrefixed('CHAT: ', `${item.message.from}: ${item.message.body}`);
    }
  }

  const {center} = state.monitors;
  if (center.activeTool === 'terminal') {
    for (const line of center.terminal.lines.slice(-TERMINAL_TAIL_LINE_COUNT)) {
      pushPrefixed('TERMINAL: ', stripAnsi(line));
    }
  } else {
    for (const line of center.editor.content
      .split('\n')
      .slice(0, EDITOR_HEAD_LINE_COUNT)) {
      pushPrefixed('EDITOR: ', line);
    }
  }

  const {right} = state.monitors;
  if (right.activePanelTab === 'runbook') {
    if (right.activeRunbook) {
      pushPrefixed('RUNBOOK: ', right.activeRunbook.title);
      for (const line of right.activeRunbook.body.split('\n')) {
        pushPrefixed('RUNBOOK: ', line);
      }
    }
  } else {
    for (const message of viewModel.recentChatMessages) {
      pushPrefixed('CHAT: ', `${message.from}: ${message.body}`);
    }
  }

  return lines;
}
