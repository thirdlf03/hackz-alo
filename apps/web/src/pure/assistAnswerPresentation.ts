/**
 * Decides how a finalized AI Assist answer should be laid out, based on the
 * question's deterministic intent (see assistIntent.ts) and the finalized
 * answer's grounding/safety verdict (see assistAnswerPipeline.ts).
 *
 * Motivation: Gemini Nano always appends a "次の一手" even to "why" questions
 * ("なぜ再起動で直るの?"), whose actual value is the explanatory prose, not
 * the command. Prompt-side attempts to suppress this were unreliable, so the
 * split is made deterministically here instead: for a "why" question with a
 * safely-grounded ("ok") command, the command is demoted to a small
 * reference line under the explanation. Every other verdict (danger/
 * redundant/rejected/unverified/repair_candidate/request_context) keeps its
 * existing alert-style display regardless of intent — safety-relevant UI
 * must never change based on why the user asked.
 *
 * Pure function only: no DOM, no effects.
 */

import type {AssistIntent} from './assistIntent.js';
import type {
  AssistNextStepVerdict,
  FinalizedAssistAnswer,
} from './assistAnswerPipeline.js';

/** "why_explanation": the prose is the primary content, and any grounded
 * command is at most a subordinate reference. "next_step": the existing
 * command-first display (unchanged from before this split existed). */
export type AssistAnswerPresentationMode = 'why_explanation' | 'next_step';

/** How (if at all) the finalized nextStep's command text should be rendered:
 * "primary" mirrors the pre-existing NextStepDisplay behavior, "reference"
 * is the new small "参考コマンド: ..." line, and "hidden" means there is no
 * command to show (no_next_step). */
export type AssistNextStepDisplayAs = 'primary' | 'reference' | 'hidden';

export interface AssistAnswerPresentation {
  mode: AssistAnswerPresentationMode;
  showCommandAs: AssistNextStepDisplayAs;
}

export function resolveAnswerPresentation(
  intent: AssistIntent,
  finalized: FinalizedAssistAnswer
): AssistAnswerPresentation {
  if (intent !== 'why') {
    return {
      mode: 'next_step',
      showCommandAs: finalized.nextStep ? 'primary' : 'hidden',
    };
  }
  if (!finalized.nextStep) {
    return {mode: 'why_explanation', showCommandAs: 'hidden'};
  }
  if (finalized.nextStep.verdict === 'ok') {
    return {mode: 'why_explanation', showCommandAs: 'reference'};
  }
  // danger_blocked/danger_confirm/redundant/rejected/unverified/
  // repair_candidate/request_context: keep the existing alert/note display,
  // unaffected by intent.
  return {mode: 'next_step', showCommandAs: 'primary'};
}

/** Verdicts whose displayed command may be offered a "コピー" (copy to
 * clipboard) affordance: a safely-grounded command ('ok') or one merely
 * flagged for manual confirmation ('danger_confirm'). Every other verdict
 * that still shows a command (repair_candidate/unverified) — and every
 * verdict that hides its command outright (danger_blocked/rejected/
 * redundant) — must not be copyable, since those are either not vetted or
 * deliberately suppressed. */
const COPYABLE_NEXT_STEP_VERDICTS: ReadonlySet<AssistNextStepVerdict> = new Set(
  ['ok', 'danger_confirm']
);

export function canCopyAssistCommand(verdict: AssistNextStepVerdict): boolean {
  return COPYABLE_NEXT_STEP_VERDICTS.has(verdict);
}
