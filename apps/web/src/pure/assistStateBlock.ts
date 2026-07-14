/**
 * Builds a short "【現在の状態】" text block that is prepended to the AI Assist
 * question, alongside the screenshot (the screenshot remains the primary
 * evidence; this block only adds a few structured facts the model would
 * otherwise have to re-derive from the image). Capped to
 * MAX_STATE_BLOCK_LINES lines: Gemini Nano's grounding degrades on long
 * text inputs, so this stays terse by construction rather than by convention.
 */

/** Hard cap on the number of lines in the state block (including the header). */
export const MAX_STATE_BLOCK_LINES = 6;

export interface AssistStateRecoveryCheck {
  allOk: boolean;
  checks: Array<{label: string; ok: boolean}>;
}

export interface AssistStateCommandHistoryEntry {
  at: number;
  command: string;
}

export interface AssistStateCurrentStep {
  /** 1-based display index (matches the numbered Runbook step list). */
  index: number;
  instruction: string;
}

export interface AssistStateLastExchange {
  question: string;
  /** The next-step command shown to the player, if any was adopted. */
  suggestion?: string;
}

export interface AssistStateBlockInput {
  recoveryLastCheck?: AssistStateRecoveryCheck;
  commandHistory?: AssistStateCommandHistoryEntry[];
  currentStep?: AssistStateCurrentStep;
  lastExchange?: AssistStateLastExchange;
  /** Reference time for relative-time formatting; defaults to Date.now(). */
  now?: number;
}

const RECENT_COMMAND_COUNT = 2;
const RELATIVE_TIME_JUST_NOW_MS = 60_000;

/**
 * Returns undefined when none of the four inputs carry data (no block is
 * sent). Otherwise always includes the success-condition line ("未確認" when
 * recoveryLastCheck is absent) and omits the other lines individually when
 * their data is missing.
 */
export function buildAssistStateBlock(
  input: AssistStateBlockInput
): string | undefined {
  const hasAnyData =
    input.recoveryLastCheck !== undefined ||
    (input.commandHistory !== undefined && input.commandHistory.length > 0) ||
    input.currentStep !== undefined ||
    input.lastExchange !== undefined;
  if (!hasAnyData) return undefined;

  const now = input.now ?? Date.now();
  const lines: string[] = ['【現在の状態】'];
  lines.push(formatSuccessConditionLine(input.recoveryLastCheck));
  if (input.commandHistory && input.commandHistory.length > 0) {
    lines.push(formatRecentCommandsLine(input.commandHistory, now));
  }
  if (input.currentStep) {
    lines.push(
      `現在の手順: ${String(input.currentStep.index)}. ${input.currentStep.instruction}`
    );
  }
  if (input.lastExchange) {
    lines.push(formatLastExchangeLine(input.lastExchange));
  }

  return lines.slice(0, MAX_STATE_BLOCK_LINES).join('\n');
}

function formatSuccessConditionLine(
  check: AssistStateRecoveryCheck | undefined
): string {
  if (!check) return '成功条件: 未確認';
  const total = check.checks.length;
  const doneCount = check.checks.filter((c) => c.ok).length;
  const unmet = check.checks.filter((c) => !c.ok).map((c) => c.label);
  const base = `成功条件: ${String(doneCount)}/${String(total)} 達成`;
  if (unmet.length === 0) return base;
  return `${base}(未達: ${unmet.join('、')})`;
}

function formatRecentCommandsLine(
  history: AssistStateCommandHistoryEntry[],
  now: number
): string {
  const recent = history.slice(-RECENT_COMMAND_COUNT);
  const parts = recent.map(
    (entry) => `${entry.command}(${formatRelativeTime(entry.at, now)})`
  );
  return `直近の操作: ${parts.join('/ ')}`;
}

function formatRelativeTime(at: number, now: number): string {
  const diffMs = Math.max(0, now - at);
  if (diffMs < RELATIVE_TIME_JUST_NOW_MS) return 'たった今';
  const minutes = Math.floor(diffMs / RELATIVE_TIME_JUST_NOW_MS);
  return `${String(minutes)}分前`;
}

function formatLastExchangeLine(exchange: AssistStateLastExchange): string {
  if (exchange.suggestion) {
    return `直前のやりとり: Q「${exchange.question}」→ 提案「${exchange.suggestion}」`;
  }
  return `直前のやりとり: Q「${exchange.question}」`;
}
