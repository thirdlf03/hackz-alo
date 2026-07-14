/**
 * Deterministic intent classifier for the AI Assist question box. Used to
 * short-circuit "did we already recover?" questions before they reach the
 * model: Gemini Nano has no reliable way to tell "the runbook's next step is
 * already done" from screen text alone, so those questions are routed to the
 * dry-run recovery-check endpoint instead (see AiAssistPanel.tsx ask()).
 *
 * Pure functions only: no DOM, no effects.
 */

export type AssistIntent = 'completion' | 'why' | 'next_step' | 'other';

/** "終わった?"/"直った?" etc.: asking whether recovery is already complete. */
const COMPLETION_KEYWORDS = [
  '復旧した',
  '終わった',
  '完了',
  '直った',
  '解決した',
  'もう大丈夫',
];

/** "なぜ"/"原因は" etc.: asking for a reason/explanation, not an action. */
const WHY_KEYWORDS = ['なぜ', 'なんで', 'どうして', '原因', '仕組み'];

/** "次は"/"どうすれば" etc.: asking what to do next. */
const NEXT_STEP_KEYWORDS = ['次', 'どうすれば', '何をすれば'];

function normalizeQuestion(question: string): string {
  return question.normalize('NFKC').trim();
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

/**
 * Classifies a free-form question into one of four intents. "why" is
 * checked before "completion" so that a question like "なんで直ったの?"
 * (asking for the reason behind a recovery, not whether it happened) is not
 * misrouted to the completion short-circuit.
 */
export function detectAssistIntent(question: string): AssistIntent {
  const normalized = normalizeQuestion(question);
  if (!normalized) return 'other';
  if (includesAny(normalized, WHY_KEYWORDS)) return 'why';
  if (includesAny(normalized, COMPLETION_KEYWORDS)) return 'completion';
  if (includesAny(normalized, NEXT_STEP_KEYWORDS)) return 'next_step';
  return 'other';
}
