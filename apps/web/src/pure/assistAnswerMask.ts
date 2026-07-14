/**
 * Splits a partial (still-streaming) AI Assist answer into the prose that's
 * safe to show immediately and a flag telling the UI to show a placeholder
 * instead of the raw command. Without this, a dangerous command streams to
 * the screen character-by-character and can be read/copied before the
 * verdict badge (computed only once the full answer + grounding check are
 * done, see assistAnswerPipeline.ts) has a chance to warn about it.
 *
 * Marker detection mirrors assistGrounding's extractNextStepText (same
 * marker constants, case/width-insensitive), except here the *original*
 * text is sliced (not the normalized copy) since the result is rendered
 * as-is rather than compared.
 *
 * Pure functions only: no DOM, no effects.
 */

export interface MaskedAssistAnswer {
  visible: string;
  maskedPending: boolean;
}

const NEXT_STEP_MARKER = '次の一手';
const EVIDENCE_MARKER = '根拠';

/**
 * NFKC + lowercase only (no whitespace collapsing/trimming), so that indices
 * into the normalized text line up 1:1 with indices into the original text
 * for the fixed, punctuation-free marker strings this module looks for.
 */
function normalizeForMarkerSearch(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('ja');
}

export function splitAnswerForMasking(
  partialAnswer: string
): MaskedAssistAnswer {
  const normalized = normalizeForMarkerSearch(partialAnswer);
  const nextStepMarker = normalizeForMarkerSearch(NEXT_STEP_MARKER);
  const nextStepIndex = normalized.indexOf(nextStepMarker);

  if (nextStepIndex < 0) {
    return {visible: partialAnswer, maskedPending: false};
  }

  const before = partialAnswer.slice(0, nextStepIndex);
  const evidenceMarker = normalizeForMarkerSearch(EVIDENCE_MARKER);
  const evidenceIndex = normalized.indexOf(
    evidenceMarker,
    nextStepIndex + nextStepMarker.length
  );

  if (evidenceIndex < 0) {
    return {visible: before, maskedPending: true};
  }

  const after = partialAnswer.slice(evidenceIndex);
  return {visible: `${before}${after}`, maskedPending: true};
}
