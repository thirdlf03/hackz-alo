/**
 * Builds the deterministic "次の一手" card shown for next_step-intent
 * questions ("次何したらいい?" etc.). Runbook progress state is the sole
 * source of truth here — no model output is consulted — since Gemini Nano
 * has no reliable way to avoid fabricating a command that isn't actually in
 * the runbook (see AiAssistPanel.tsx ask()).
 *
 * Pure functions only: no DOM, no effects.
 */

import type {
  RunbookStepDefinition,
  RunbookStepEvidence,
  RunbookStepStatus,
} from '@incident/shared';

export type RunbookNextStepCard =
  | {
      kind: 'step';
      /** 1-based display index (matches the numbered Runbook step list). */
      index: number;
      total: number;
      instruction: string;
      command?: string;
      /** Number of steps whose status is 'done'. */
      doneCount: number;
      /** Whether the current step already has evidence (a matching command
       * was found in the terminal history). */
      alreadyExecuted: boolean;
    }
  | {kind: 'all_done'; total: number};

/**
 * `resolved` is the output of resolveStepStatuses() (runbookSteps.ts).
 * Returns undefined when there are no steps at all (the caller should fall
 * back to asking the model). Returns {kind: 'all_done'} when every step is
 * done/skipped. The "next step to do" is the first entry whose status is
 * neither 'done' nor 'skipped' — this includes 'current', 'pending', and
 * 'failed' (a step can be manually marked 'failed' from the Runbook panel,
 * in which case it still needs attention and must not be treated as if the
 * whole runbook were complete).
 */
export function buildRunbookNextStepCard(
  resolved: Array<{
    step: RunbookStepDefinition;
    status: RunbookStepStatus;
    evidence?: RunbookStepEvidence;
  }>
): RunbookNextStepCard | undefined {
  if (resolved.length === 0) return undefined;

  const total = resolved.length;
  const doneCount = resolved.filter((entry) => entry.status === 'done').length;
  const currentIndex = resolved.findIndex(
    (entry) => entry.status !== 'done' && entry.status !== 'skipped'
  );

  if (currentIndex === -1) return {kind: 'all_done', total};

  const current = resolved[currentIndex];
  if (!current) return {kind: 'all_done', total};

  return {
    kind: 'step',
    index: currentIndex + 1,
    total,
    instruction: current.step.instruction,
    ...(current.step.command ? {command: current.step.command} : {}),
    doneCount,
    alreadyExecuted: current.evidence !== undefined,
  };
}
