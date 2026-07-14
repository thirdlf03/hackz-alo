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
import type {GroundingResult} from './assistGrounding.js';

export type AssistNextStepVerdict =
  | 'ok'
  | 'repair_candidate'
  | 'rejected'
  | 'danger_blocked'
  | 'danger_confirm'
  | 'unverified';

export interface FinalizedAssistNextStep {
  command: string;
  verdict: AssistNextStepVerdict;
  reason?: string;
  repairSuggestion?: string;
}

export interface FinalizedAssistAnswer {
  prose: string;
  nextStep?: FinalizedAssistNextStep;
}

const NEXT_STEP_MARKER = '次の一手';
const EVIDENCE_MARKER = '根拠';

const SAFETY_SEVERITY: Record<CommandSafetyResult['level'], number> = {
  ok: 0,
  confirm: 1,
  blocked: 2,
};

export function finalizeAssistAnswer(
  answer: string,
  grounding: GroundingResult
): FinalizedAssistAnswer {
  const prose = extractProse(answer);

  if (grounding.status === 'no_next_step' || !grounding.nextStep) {
    return {prose};
  }

  const command = grounding.nextStep;
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
