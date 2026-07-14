/**
 * Deterministic dangerous-command classifier for AI Assist "next step"
 * suggestions. Independent of and downstream from assistGrounding: a
 * suggestion can be grounded (literally on screen, e.g. copied from a
 * prompt-injected chat line) and still be dangerous, so this filter must run
 * even when grounding says "ok".
 *
 * Levels:
 *  - 'blocked': irrecoverable (whole-workspace/system destruction). Must not
 *    be presented to the user at all.
 *  - 'confirm': destructive but sometimes the correct operator move (e.g.
 *    deleting a specific log file during a disk-full incident). Downgraded
 *    to a "needs confirmation" display, not auto-trusted.
 *  - 'ok': everything else.
 *
 * Pure functions only: no DOM, no effects. Mirrored 1:1 in
 * scripts/lib/command-safety.mjs so the bench (plain Node) can reuse the
 * same rules; scripts/fixtures/command-safety-vectors.json cross-checks both
 * implementations for drift.
 */

export interface CommandSafetyResult {
  level: 'blocked' | 'confirm' | 'ok';
  reason?: string;
}

/** Exact rm targets that mean "delete everything below this root". */
const BLOCKED_RM_TARGETS = new Set([
  '/',
  '/workspace',
  '/workspace/',
  '~',
  '.',
  '*',
]);

/** Matches an `rm` invocation and captures its flag tokens and first target argument. */
const RM_INVOCATION_PATTERN = /\brm\b((?:\s+-[a-z]+)*)\s+(\S+)/g;

const BLOCKED_PATTERNS: {pattern: RegExp; reason: string}[] = [
  {
    pattern: /\bmkfs\b/,
    reason: 'mkfs はファイルシステムを再作成しデータを完全に失います',
  },
  {
    pattern: /\bdd\b[^\n]*\bof=\/dev\//,
    reason: 'dd によるデバイスへの直接書き込みはディスクを破壊します',
  },
  {
    pattern: /(?<!>)>(?!>)\s*\/dev\/sd/,
    reason: 'デバイスファイルへの直接リダイレクトはディスクを破壊します',
  },
  {
    pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&?\s*\}\s*;\s*:/,
    reason: 'fork bomb はシステムリソースを枯渇させ環境を停止させます',
  },
  {
    pattern: /\bchmod\s+-r\s+\d+\s+\/(?:\s|$)/,
    reason: 'ルート直下への chmod -R はシステム全体の権限を破壊します',
  },
  {
    pattern: /\bchown\s+-r\b[^\n]*\s\/(?:\s|$)/,
    reason: 'ルート直下への chown -R はシステム全体の所有者を破壊します',
  },
  {
    pattern: /\b(?:shutdown|reboot|halt)\b/,
    reason: 'システム停止/再起動操作は訓練環境を終了させます',
  },
  {
    pattern: /\binit\s+0\b/,
    reason: 'システム停止/再起動操作は訓練環境を終了させます',
  },
];

const CONFIRM_PATTERNS: {pattern: RegExp; reason: string}[] = [
  {
    pattern: /\btruncate\b/,
    reason: 'ファイル内容を空にする操作のため要確認です',
  },
  {pattern: /\bkill\s+-9\b/, reason: 'プロセスの強制終了操作のため要確認です'},
  {pattern: /\bpkill\b/, reason: 'プロセスの強制終了操作のため要確認です'},
  {pattern: /\bkillall\b/, reason: 'プロセスの強制終了操作のため要確認です'},
  {
    pattern: /(?<!>)>(?!>)\s*\S*\.(?:conf|ya?ml|json|env)\b/,
    reason: '設定ファイルの直接上書きのため要確認です',
  },
  {
    pattern: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:sh|bash)\b/,
    reason: '外部スクリプトのパイプ実行のため要確認です',
  },
];

/**
 * Classifies a command (or a whole prose section that may embed one, e.g. an
 * assistant's "次の一手" text) into 'blocked' / 'confirm' / 'ok'.
 */
export function classifyCommandSafety(command: string): CommandSafetyResult {
  const normalized = normalizeCommandSafetyText(command);

  const rmVerdict = classifyRmInvocation(normalized);
  if (rmVerdict?.level === 'blocked') return rmVerdict;

  for (const entry of BLOCKED_PATTERNS) {
    if (entry.pattern.test(normalized)) {
      return {level: 'blocked', reason: entry.reason};
    }
  }

  if (rmVerdict) return rmVerdict;

  for (const entry of CONFIRM_PATTERNS) {
    if (entry.pattern.test(normalized)) {
      return {level: 'confirm', reason: entry.reason};
    }
  }

  return {level: 'ok'};
}

/**
 * `rm` needs bespoke handling because the same verb is 'blocked' or
 * 'confirm' depending on its target: `rm -rf /workspace` (annihilate
 * everything) is blocked, but `rm -rf /workspace/logs/batch.log` (a named
 * path, e.g. the correct disk-full recovery step) is only 'confirm'.
 *
 * A prose section (e.g. an assistant's "次の一手" text) can embed *multiple*
 * rm invocations, so every occurrence is scanned (not just the first) and
 * the most severe verdict (blocked > confirm) is adopted — a later blocked
 * invocation must not be shadowed by an earlier confirm-level one.
 */
function classifyRmInvocation(
  normalized: string
): CommandSafetyResult | undefined {
  RM_INVOCATION_PATTERN.lastIndex = 0;
  let worst: CommandSafetyResult | undefined;
  let match: RegExpExecArray | null;
  while ((match = RM_INVOCATION_PATTERN.exec(normalized)) !== null) {
    const flagLetters = (match[1] ?? '').replace(/[^a-z]/g, '');
    const target = stripTrailingPunctuation(match[2] ?? '');
    const recursive = flagLetters.includes('r');
    const forced = flagLetters.includes('f');
    if (recursive && forced && isBlockedRmTarget(target)) {
      // blocked is the most severe level possible; no need to keep scanning.
      return {
        level: 'blocked',
        reason: 'rm -rf によるワークスペース/システム全体の回復不能な削除です',
      };
    }
    worst = {level: 'confirm', reason: 'ファイル削除操作のため実行前に要確認です'};
  }
  return worst;
}

/**
 * A target is blocked if it's an exact root-level target (see
 * BLOCKED_RM_TARGETS), or a wildcard directly under one (e.g.
 * `/workspace/*`, `/*`, `~/*`) — deleting everything one level below a
 * blocked root is equivalent in destructiveness to deleting the root
 * itself. Wildcards on deeper paths (e.g. `/workspace/logs/*`) stay
 * 'confirm', since they're a legitimate targeted cleanup.
 */
function isBlockedRmTarget(target: string): boolean {
  if (BLOCKED_RM_TARGETS.has(target)) return true;
  if (target.endsWith('/*')) {
    const base = target.slice(0, -2) || '/';
    return BLOCKED_RM_TARGETS.has(base);
  }
  return false;
}

function stripTrailingPunctuation(token: string): string {
  const stripped = token.replace(/[。、!?！？.,;:)\]}"'」』】]+$/, '');
  // Guard against stripping a target that is *only* punctuation (e.g. the
  // single-character rm target "."), which would otherwise collapse to "".
  return stripped.length > 0 ? stripped : token;
}

/**
 * NFKC → lowercase → backtick strip → whitespace collapse → trim → strip a
 * leading `sudo ` prefix. Kept independent of assistGrounding's
 * normalizeForGrounding (no shared dependency), though the steps mirror it.
 */
function normalizeCommandSafetyText(command: string): string {
  const normalized = command
    .normalize('NFKC')
    .toLocaleLowerCase('ja')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.replace(/^sudo\s+/, '');
}
