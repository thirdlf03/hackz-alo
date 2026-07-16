/**
 * Finalizes a completed AI Assist answer into a display-safe shape: strips
 * the "次の一手" section out of the prose, and decides what to do with the
 * suggested command by combining two independent, ordered checks:
 *
 *  1. groundAssistNextStep()'s verdict (ok/repaired/rejected/unverified) —
 *     is the command actually on screen?
 *  2. classifyCommandSafety()'s verdict (ok/confirm/blocked) — is the
 *     command dangerous, regardless of whether it's grounded?
 *
 * (2) always wins over (1): a prompt-injected chat line can hand the model a
 * real, on-screen `rm -rf /workspace` and grounding will happily say "ok" —
 * dangerous commands must never reach the user un-flagged just because they
 * were literally visible somewhere on screen.
 *
 * Pure functions only: no DOM, no effects.
 */

import {
  classifyCommandSafety,
  type CommandSafetyResult,
} from './commandSafety.js';
import {
  normalizeForGrounding,
  type GroundingResult,
} from './assistGrounding.js';

export type AssistNextStepVerdict =
  | 'ok'
  | 'repair_candidate'
  | 'rejected'
  | 'danger_blocked'
  | 'danger_confirm'
  | 'redundant'
  | 'unverified'
  | 'request_context';

/** A single entry of the terminal's recent command history, used to detect a
 * re-suggested "次の一手" that was already executed (see isRecentlyExecuted). */
export interface RecentAssistCommand {
  command: string;
  at: number;
}

export interface FinalizedAssistNextStepCommand {
  command: string;
  verdict: Exclude<AssistNextStepVerdict, 'request_context'>;
  reason?: string;
  repairSuggestion?: string;
}

/** The model declined to guess and instead reported what it would need to
 * see to answer (see the "不足:" contract in ASSIST_SYSTEM_PROMPT). There is
 * no command here, so none of the command-oriented checks (danger/redundant/
 * grounding) apply. */
export interface FinalizedAssistNextStepRequestContext {
  verdict: 'request_context';
  requestedInfo: string;
}

export type FinalizedAssistNextStep =
  | FinalizedAssistNextStepCommand
  | FinalizedAssistNextStepRequestContext;

export interface FinalizedAssistAnswer {
  prose: string;
  nextStep?: FinalizedAssistNextStep;
}

const NEXT_STEP_MARKER = '次の一手';
const EVIDENCE_MARKER = '根拠';
const REDUNDANT_REASON = '直近に実行済みのコマンドです';
/** The model's "次の一手" contract: when it can't ground an answer, it writes
 * "不足: <知りたい情報>" instead of fabricating a command. This is checked
 * before any command extraction/safety/grounding logic, since there is no
 * command to classify. */
const REQUEST_CONTEXT_MARKER = '不足';

const SAFETY_SEVERITY: Record<CommandSafetyResult['level'], number> = {
  ok: 0,
  confirm: 1,
  blocked: 2,
};

export function finalizeAssistAnswer(
  answer: string,
  grounding: GroundingResult,
  recentCommands?: RecentAssistCommand[]
): FinalizedAssistAnswer {
  const prose = extractProse(answer);

  if (grounding.status === 'no_next_step' || !grounding.nextStep) {
    return {prose};
  }

  // grounding.nextStep still carries the leading "次の一手" marker (see
  // extractNextStepText in assistGrounding.ts); strip it here so every
  // FinalizedAssistNextStepCommand.command is a bare, display-ready command
  // with no marker to duplicate the UI's own "次の一手:" / "参考コマンド:"
  // labels (see AiAssistPanel.tsx) or leak into the copy-to-clipboard text.
  const command = stripNextStepMarker(grounding.nextStep);

  // "不足: ..." is not a command: skip danger/redundant/grounding checks
  // entirely and surface the requested info instead. This must run before
  // command extraction (the checks below) since there is nothing to extract.
  const requestedInfo = extractRequestedInfo(command);
  if (requestedInfo !== undefined) {
    return {prose, nextStep: {verdict: 'request_context', requestedInfo}};
  }

  // Classify both the original and (if repaired) the pre-repair command:
  // a fake chat line can hide a dangerous instruction in either form.
  const safety = worstCommandSafety(
    grounding.repairedNextStep
      ? [command, grounding.repairedNextStep]
      : [command]
  );

  if (safety.level === 'blocked') {
    return {
      prose,
      nextStep: safety.reason
        ? {command, verdict: 'danger_blocked', reason: safety.reason}
        : {command, verdict: 'danger_blocked'},
    };
  }
  if (safety.level === 'confirm') {
    return {
      prose,
      nextStep: safety.reason
        ? {command, verdict: 'danger_confirm', reason: safety.reason}
        : {command, verdict: 'danger_confirm'},
    };
  }

  // Danger always wins over redundant (handled above); redundant in turn
  // wins over every grounding-derived verdict below (ok/repaired/rejected/
  // unverified) — a command that's grounded but already executed must still
  // be downgraded, since re-running it is what the model keeps getting wrong.
  if (isRecentlyExecuted(command, recentCommands)) {
    return {
      prose,
      nextStep: {command, verdict: 'redundant', reason: REDUNDANT_REASON},
    };
  }

  switch (grounding.status) {
    case 'repaired':
      return {
        prose,
        nextStep: grounding.repairedNextStep
          ? {
              command,
              verdict: 'repair_candidate',
              repairSuggestion: grounding.repairedNextStep,
            }
          : {command, verdict: 'repair_candidate'},
      };
    case 'rejected':
      return {
        prose,
        nextStep: grounding.reason
          ? {command, verdict: 'rejected', reason: grounding.reason}
          : {command, verdict: 'rejected'},
      };
    case 'unverified':
      return {
        prose,
        nextStep: grounding.reason
          ? {command, verdict: 'unverified', reason: grounding.reason}
          : {command, verdict: 'unverified'},
      };
    case 'ok':
      return {
        prose,
        nextStep: {command, verdict: 'ok'},
      };
  }
}

/**
 * True when the next-step command (normalized: NFKC, backticks stripped,
 * whitespace collapsed, lowercased — via normalizeForGrounding) exactly
 * matches one of the recently executed terminal commands. `command` is
 * already marker-free by the time it reaches here (finalizeAssistAnswer
 * strips the leading "次の一手" marker up front via stripNextStepMarker), so
 * this only needs to normalize before comparing against a bare shell command
 * from commandHistory.
 */
function isRecentlyExecuted(
  command: string,
  recentCommands: RecentAssistCommand[] | undefined
): boolean {
  if (!recentCommands || recentCommands.length === 0) return false;
  const normalizedCommand = normalizeForGrounding(command);
  if (!normalizedCommand) return false;
  return recentCommands.some(
    (entry) => normalizeForGrounding(entry.command) === normalizedCommand
  );
}

/** Strips a leading "次の一手" marker (and its following separator, e.g. ": ")
 * from a next-step string, if present. */
function stripNextStepMarker(text: string): string {
  const index = text.indexOf(NEXT_STEP_MARKER);
  if (index < 0) return text;
  return text.slice(index + NEXT_STEP_MARKER.length).replace(/^[:：]\s*/, '');
}

/**
 * Returns the requested-info text when the next-step command (after
 * stripping the "次の一手" marker) starts with "不足:" — the model's declared
 * contract for "I can't ground an answer" — and undefined otherwise (e.g.
 * "不足" appearing later in the text does not count).
 */
function extractRequestedInfo(command: string): string | undefined {
  const stripped = stripNextStepMarker(command);
  if (!stripped.startsWith(REQUEST_CONTEXT_MARKER)) return undefined;
  const afterMarker = stripped.slice(REQUEST_CONTEXT_MARKER.length);
  if (!/^[:：]/.test(afterMarker)) return undefined;
  return afterMarker.replace(/^[:：]\s*/, '').trim();
}

function worstCommandSafety(commands: string[]): CommandSafetyResult {
  let worst: CommandSafetyResult = {level: 'ok'};
  for (const command of commands) {
    const result = classifyCommandSafety(command);
    if (SAFETY_SEVERITY[result.level] > SAFETY_SEVERITY[worst.level]) {
      worst = result;
    }
  }
  return worst;
}

/**
 * Removes the "次の一手: ..." section from the answer, keeping any preface
 * before it and the "根拠: ..." section (if present) after it. The command
 * itself is rendered separately (see finalizeAssistAnswer's nextStep), with
 * its own safety-aware display logic.
 */
function extractProse(answer: string): string {
  const nextStepIndex = answer.indexOf(NEXT_STEP_MARKER);
  if (nextStepIndex < 0) return answer.trim();
  const evidenceIndex = answer.indexOf(
    EVIDENCE_MARKER,
    nextStepIndex + NEXT_STEP_MARKER.length
  );
  const before = answer.slice(0, nextStepIndex);
  const after = evidenceIndex >= 0 ? answer.slice(evidenceIndex) : '';
  return `${before}${after}`.trim();
}
