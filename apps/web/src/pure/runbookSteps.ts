import type {
  GameRenderState,
  RunbookStepDefinition,
  RunbookStepEvidence,
  RunbookStepStatus,
} from '@incident/shared';
import {normalizeMultilineText} from './canvasMath.js';

const NUMBERED_LINE = /^\s*\d+[.)]\s+(.*)$/;

/** 行内の ASCII コマンドらしき語で始まるトークン列を抜き出すための最初の一語判定。 */
const COMMAND_START_TOKEN = /^[A-Za-z][A-Za-z0-9_.-]*$/;

/** 単語単体でも「コマンド」として抽出してよい既知のバイナリ名。 */
const KNOWN_COMMAND_NAMES = new Set([
  'df',
  'du',
  'curl',
  'tail',
  'head',
  'cat',
  'ps',
  'pgrep',
  'pkill',
  'grep',
  'kill',
  'yamactl',
  'kodama',
  'cp',
  'mv',
  'rm',
  'diff',
  'sed',
  'vim',
  'ls',
  'wc',
  'mount',
  'systemctl',
  'journalctl',
  'top',
  'free',
  'netstat',
  'ss',
  'dig',
  'ping',
  'nslookup',
  'kubectl',
  'echo',
]);

/**
 * `body` の番号付き行(`1.` / `1)` 等)を手順として分割する。番号行に続く
 * 非番号行は同じ手順の続き(改行やインデント継続)として instruction に連結する。
 * `overrideSteps` が渡された場合はパースせずそれをそのまま返す
 * (RunbookDefinition.steps によるオーバーライド)。
 */
export function parseRunbookSteps(
  body: string,
  overrideSteps?: RunbookStepDefinition[]
): RunbookStepDefinition[] {
  if (overrideSteps && overrideSteps.length > 0) return overrideSteps;

  const lines = normalizeMultilineText(body).split('\n');
  const steps: RunbookStepDefinition[] = [];
  let currentLines: string[] | undefined;

  const flush = () => {
    if (currentLines === undefined) return;
    const instruction = currentLines.join(' ').trim();
    if (instruction) {
      const command = extractStepCommand(instruction);
      steps.push({
        id: `step-${String(steps.length + 1)}`,
        instruction,
        ...(command ? {command} : {}),
      });
    }
    currentLines = undefined;
  };

  for (const rawLine of lines) {
    const match = NUMBERED_LINE.exec(rawLine);
    if (match) {
      flush();
      currentLines = [(match[1] ?? '').trim()];
      continue;
    }
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (currentLines !== undefined) {
      currentLines.push(trimmed);
    }
  }
  flush();

  return steps;
}

function extractStepCommand(instruction: string): string | undefined {
  const asciiRuns = instruction.match(/[!-~]+(?:[ \t]+[!-~]+)*/g);
  if (!asciiRuns) return undefined;

  for (const rawRun of asciiRuns) {
    const trimmed = trimOuterPunctuation(rawRun);
    if (!trimmed) continue;
    const words = trimmed.split(/\s+/);
    const first = words[0] ?? '';
    if (!COMMAND_START_TOKEN.test(first)) continue;

    if (!KNOWN_COMMAND_NAMES.has(first.toLowerCase())) continue;

    const kept = [first];
    for (let index = 1; index < words.length; index += 1) {
      const word = words[index] ?? '';
      if (word === '/') break; // 「A / B」のような代替表記の区切り
      kept.push(word);
    }
    return kept.join(' ');
  }
  return undefined;
}

const LEADING_PUNCTUATION = /^[(（「『"']+/;
const TRAILING_PUNCTUATION = /[)）」』"'.,;:!?、。]+$/;

function trimOuterPunctuation(run: string) {
  return run.replace(LEADING_PUNCTUATION, '').replace(TRAILING_PUNCTUATION, '');
}

/** 暗号強度不要の軽量ハッシュ(FNV-1a 風)。8桁16進文字列を返す。 */
export function hashRunbookBody(body: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < body.length; index += 1) {
    hash ^= body.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeCommandForMatch(command: string) {
  return command.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

/**
 * commandHistory との正規化後**完全一致**のみで evidence を導出する
 * (部分一致・前方一致は付けない)。最初に一致した履歴を採用する。
 */
export function deriveStepEvidence(
  steps: RunbookStepDefinition[],
  commandHistory: Array<{at: number; command: string}>
): Record<string, RunbookStepEvidence> {
  const normalizedHistory = commandHistory.map((entry) => ({
    at: entry.at,
    normalized: normalizeCommandForMatch(entry.command),
  }));

  const evidence: Record<string, RunbookStepEvidence> = {};
  for (const step of steps) {
    if (!step.command) continue;
    const normalizedCommand = normalizeCommandForMatch(step.command);
    const match = normalizedHistory.find(
      (entry) => entry.normalized === normalizedCommand
    );
    if (match) {
      evidence[step.id] = {
        kind: 'command_executed',
        command: step.command,
        at: match.at,
      };
    }
  }
  return evidence;
}

/**
 * manualStatus を優先し、なければ evidence があっても pending のまま扱う
 * (evidence は「実行済み」注記のみで done への昇格はしない)。
 * current は「manualStatus が done/skipped でない」最初の手順。
 */
export function resolveStepStatuses(
  steps: RunbookStepDefinition[],
  progress: GameRenderState['runbookProgress'] | undefined
): Array<{
  step: RunbookStepDefinition;
  status: RunbookStepStatus;
  evidence?: RunbookStepEvidence;
}> {
  const progressById = new Map(
    (progress?.steps ?? []).map((entry) => [entry.stepId, entry])
  );

  const currentIndex = steps.findIndex((step) => {
    const manualStatus = progressById.get(step.id)?.manualStatus;
    return manualStatus !== 'done' && manualStatus !== 'skipped';
  });

  return steps.map((step, index) => {
    const entry = progressById.get(step.id);
    const status: RunbookStepStatus =
      entry?.manualStatus ?? (index === currentIndex ? 'current' : 'pending');
    return {
      step,
      status,
      ...(entry?.evidence ? {evidence: entry.evidence} : {}),
    };
  });
}
