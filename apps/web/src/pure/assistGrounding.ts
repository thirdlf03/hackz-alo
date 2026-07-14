/**
 * Deterministic grounding validator for the AI Assist "next step" answer.
 * Cross-checks the assistant's suggested command(s) against the literal
 * on-screen text, so a hallucinated command (e.g. `kubectl ...` when the
 * game never showed kubectl) can be rejected instead of trusted, and a
 * truncated-but-real command (e.g. a path cut mid-word) can be repaired by
 * looking up the complete token on screen.
 *
 * Pure functions only: no DOM, no effects.
 */

export interface GroundingResult {
  status: 'ok' | 'repaired' | 'rejected' | 'unverified' | 'no_next_step';
  nextStep?: string;
  repairedNextStep?: string;
  reason?: string;
}

const NEXT_STEP_MARKER = '次の一手';
const EVIDENCE_MARKER = '根拠';
/** Command candidates must be contiguous ASCII printable characters (0x21-0x7E). */
const ASCII_TOKEN_PATTERN = /[!-~]{4,}/g;
/** A candidate is accepted as "repaired" only if the edit distance is small. */
const REPAIR_DISTANCE_RATIO = 0.2;
/** Leading screen-line label, e.g. "chat:", "runbook:", "next:" (single level, not recursive). */
const LABEL_PREFIX_PATTERN = /^(\S+):\s*/;
/** A next-step with no command candidate must cover this much of a line (or vice versa) to count as copied from it. */
const LINE_COPY_COVERAGE_RATIO = 0.7;

/**
 * Normalizes full-width/half-width spacing, run-together whitespace,
 * backtick variants, and arrow glyph variants ("→" vs "->") so that
 * screen text and assistant answers compare equal regardless of those
 * surface differences.
 */
export function normalizeForGrounding(text: string): string {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase('ja')
    .replace(/→/g, '->')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts the "次の一手" section of a normalized answer, up to the next
 * "根拠" marker (or the end of the text if there is none). Mirrors
 * extractNextStepSection() in scripts/lib/ai-assist-eval.mjs.
 */
export function extractNextStepText(answer: string): string {
  const normalized = normalizeForGrounding(answer);
  const marker = normalizeForGrounding(NEXT_STEP_MARKER);
  const start = normalized.indexOf(marker);
  if (start < 0) return '';
  const evidenceMarker = normalizeForGrounding(EVIDENCE_MARKER);
  const evidenceIndex = normalized.indexOf(
    evidenceMarker,
    start + marker.length
  );
  const end = evidenceIndex >= 0 ? evidenceIndex : normalized.length;
  return normalized.slice(start, end);
}

/**
 * Validates the assistant's "次の一手" against the literal screen text and,
 * where possible, repairs it. Two independent repair strategies apply, in
 * priority order:
 *  1. Per-candidate verification/repair (see evaluateCandidates()): a
 *     fabricated command (not on screen and not a near-miss of anything on
 *     screen) is rejected outright, regardless of the chain check below.
 *  2. NEXT-chain completion (see findChainCompletion()): even when every
 *     extracted candidate is individually verifiable, the model sometimes
 *     copies only the first step of an on-screen "A -> B" command chain and
 *     drops the confirmation step. When that happens the ok/repaired result
 *     from step 1 is upgraded to 'repaired' with the full chain restored.
 */
export function groundAssistNextStep(
  answer: string,
  screenLines: string[]
): GroundingResult {
  const nextStep = extractNextStepText(answer);
  if (!nextStep) return {status: 'no_next_step'};

  const normalizedLines = screenLines.map((line) =>
    normalizeForGrounding(line)
  );
  const screenText = normalizedLines.join('\n');
  const candidateResult = evaluateCandidates(
    nextStep,
    screenText,
    normalizedLines
  );

  if (
    candidateResult.status === 'rejected' ||
    candidateResult.status === 'unverified'
  ) {
    return {
      status: candidateResult.status,
      nextStep,
      reason: candidateResult.reason,
    };
  }

  const chainCompletion = findChainCompletion(nextStep, normalizedLines);
  if (chainCompletion) {
    return {
      status: 'repaired',
      nextStep,
      repairedNextStep: chainCompletion,
      reason: 'next-chain-completed',
    };
  }

  if (candidateResult.status === 'repaired') {
    return {
      status: 'repaired',
      nextStep,
      repairedNextStep: candidateResult.repairedNextStep,
    };
  }
  return candidateResult.reason
    ? {status: 'ok', nextStep, reason: candidateResult.reason}
    : {status: 'ok', nextStep};
}

type CandidateResult =
  | {status: 'ok'; reason?: string}
  | {status: 'repaired'; repairedNextStep: string}
  | {status: 'rejected'; reason: string}
  | {status: 'unverified'; reason: string};

/** Per-candidate verification against the screen text (rule (b)-(e) of the design). */
function evaluateCandidates(
  nextStep: string,
  screenText: string,
  normalizedLines: string[]
): CandidateResult {
  const candidates = extractCommandCandidates(nextStep);

  if (candidates.length === 0) {
    return evaluateLineCopy(nextStep, normalizedLines);
  }

  let repairedText = nextStep;
  let repairedAny = false;
  const rejectedCandidates: string[] = [];

  for (const candidate of candidates) {
    if (screenText.includes(candidate)) continue;
    const match = findBestWindow(candidate, screenText);
    if (match && match.distance <= candidate.length * REPAIR_DISTANCE_RATIO) {
      const expanded = expandToken(screenText, match.start);
      repairedText = repairedText.replace(candidate, expanded);
      repairedAny = true;
    } else {
      rejectedCandidates.push(candidate);
    }
  }

  if (rejectedCandidates.length > 0) {
    return {
      status: 'rejected',
      reason: `unverifiable command: ${rejectedCandidates.join(', ')}`,
    };
  }
  return repairedAny
    ? {status: 'repaired', repairedNextStep: repairedText}
    : {status: 'ok'};
}

function extractCommandCandidates(text: string): string[] {
  const matches = text.match(ASCII_TOKEN_PATTERN) ?? [];
  return [...new Set(matches)];
}

/**
 * A next-step with no ASCII command candidate is not automatically
 * trustworthy: it can be a legitimate instruction copied from an on-screen
 * line (e.g. a RUNBOOK line telling the operator what to check next), but it
 * can also be a fragmentary paraphrase not grounded in any particular line
 * ("DBを再起動する" next to a much longer RUNBOOK sentence), or a chat
 * message's prose promoted to "next step" verbatim (a chat line is a
 * colleague's remark, not an instruction). Only a substantial copy (>=70%
 * coverage either way, see isSubstantialLineCopy()) of a non-CHAT line is
 * trusted as 'ok'; everything else is 'unverified'.
 */
function evaluateLineCopy(
  nextStep: string,
  normalizedLines: string[]
): CandidateResult {
  let matchedChatLine = false;
  for (const line of normalizedLines) {
    if (line.length === 0) continue;
    if (!isSubstantialLineCopy(nextStep, stripLabel(line))) continue;
    if (lineLabel(line) === 'chat') {
      matchedChatLine = true;
      continue;
    }
    return {status: 'ok', reason: 'line-copy'};
  }
  return matchedChatLine
    ? {status: 'unverified', reason: 'chat-prose'}
    : {status: 'unverified', reason: 'no-grounded-command'};
}

function isSubstantialLineCopy(nextStep: string, lineContent: string): boolean {
  if (nextStep.length === 0 || lineContent.length === 0) return false;
  const common = longestCommonSubstringLength(nextStep, lineContent);
  return (
    common / lineContent.length >= LINE_COPY_COVERAGE_RATIO ||
    common / nextStep.length >= LINE_COPY_COVERAGE_RATIO
  );
}

function lineLabel(line: string): string | undefined {
  return line.match(LABEL_PREFIX_PATTERN)?.[1];
}

function stripLabel(line: string): string {
  return line.replace(LABEL_PREFIX_PATTERN, '');
}

/** Longest contiguous common run of characters between two strings. */
function longestCommonSubstringLength(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  let previous: number[] = Array.from({length: b.length + 1}, () => 0);
  let best = 0;
  for (let i = 1; i <= a.length; i += 1) {
    const current: number[] = Array.from({length: b.length + 1}, () => 0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a.charAt(i - 1) === b.charAt(j - 1)) {
        const value = (previous[j - 1] ?? 0) + 1;
        current[j] = value;
        if (value > best) best = value;
      }
    }
    previous = current;
  }
  return best;
}

/**
 * Finds "A -> B [-> C ...]" command chains among the (already normalized)
 * screen lines. A leading label prefix (e.g. "next:", "terminal:") is
 * stripped, but chains are not limited to any particular prefix.
 */
function extractChains(normalizedLines: string[]): string[][] {
  const chains: string[][] = [];
  for (const line of normalizedLines) {
    if (!line.includes('->')) continue;
    const elements = stripLabel(line)
      .split('->')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (elements.length >= 2) chains.push(elements);
  }
  return chains;
}

/**
 * If the next-step answer contains only the first element of an on-screen
 * chain and is missing a later element, returns the full chain (joined with
 * " -> ") to repair it with. Returns undefined when no chain applies, or
 * when the whole chain is already present.
 */
function findChainCompletion(
  nextStep: string,
  normalizedLines: string[]
): string | undefined {
  for (const elements of extractChains(normalizedLines)) {
    const [first, ...rest] = elements;
    if (
      first !== undefined &&
      first.length > 0 &&
      nextStep.includes(first) &&
      rest.some((element) => !nextStep.includes(element))
    ) {
      return elements.join(' -> ');
    }
  }
  return undefined;
}

function findBestWindow(
  candidate: string,
  text: string
): {distance: number; start: number} | undefined {
  const len = candidate.length;
  if (len === 0 || text.length < len) return undefined;
  let bestDistance = Infinity;
  let bestStart = -1;
  for (let start = 0; start + len <= text.length; start += 1) {
    const window = text.slice(start, start + len);
    const distance = editDistance(candidate, window);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestStart = start;
      if (distance === 0) break;
    }
  }
  return bestStart >= 0
    ? {distance: bestDistance, start: bestStart}
    : undefined;
}

/** Expands a matched offset outward to the enclosing whitespace-delimited token. */
function expandToken(text: string, start: number): string {
  let begin = start;
  while (begin > 0 && !/\s/.test(text.charAt(begin - 1))) begin -= 1;
  let end = start;
  while (end < text.length && !/\s/.test(text.charAt(end))) end += 1;
  return text.slice(begin, end);
}

/** Small Levenshtein distance; candidates are short (<=~120 chars). */
function editDistance(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  let previous: number[] = Array.from({length: m + 1}, (_, index) => index);
  for (let i = 1; i <= n; i += 1) {
    const current: number[] = Array.from({length: m + 1}, () => 0);
    current[0] = i;
    for (let j = 1; j <= m; j += 1) {
      const substitutionCost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      const deletion = previous[j] ?? 0;
      const insertion = current[j - 1] ?? 0;
      const substitution = previous[j - 1] ?? 0;
      current[j] =
        substitutionCost === 0
          ? substitution
          : 1 + Math.min(deletion, insertion, substitution);
    }
    previous = current;
  }
  return previous[m] ?? 0;
}
