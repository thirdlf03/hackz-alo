import type {IncidentOverview} from './webmcpTools.js';

/** ゲーム内チャットに常駐する AI NPC「後輩ソラ」の表示名。 */
export const NPC_NAME = '後輩ソラ';

const NPC_SAY_MAX_LENGTH = 160;
const NPC_TASK_MAX_LENGTH = 80;
/** 直近の発言をこの件数だけ覚えて、同じ発言の繰り返しを避ける。 */
export const NPC_RECENT_SAY_LIMIT = 6;

export const NPC_SYSTEM_PROMPT = [
  'あなたはインシデント対応訓練ゲームに登場する新人SRE「ソラ」です。',
  '先輩(プレイヤー)のウォールームチャットに参加しています。',
  '定期的に渡されるインシデント状況のJSONを読み、気づいたことを短く日本語で発言します。',
  '出力は必ず JSON オブジェクトのみ: {"say": string, "suggestTask": string}。',
  'say: チャットに投稿するひとこと(120文字以内、です・ます調、絵文字なし)。言うことがなければ空文字。',
  'suggestTask: 今やるべき具体的な対応タスクの提案(60文字以内)。自信がなければ空文字。',
  '新人なので推測が外れることもありますが、根拠(メトリクスやアラート名)を添えて発言してください。',
].join('\n');

/**
 * Prompt API の responseConstraint に渡す JSON Schema。
 * 後輩の発言(say)とタスク提案(suggestTask)だけを許す。
 */
export const NPC_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    say: {type: 'string'},
    suggestTask: {type: 'string'},
  },
  required: ['say', 'suggestTask'],
  additionalProperties: false,
} as const;

export interface NpcReply {
  say?: string;
  suggestTask?: string;
}

export function buildNpcReplyPrompt(
  overview: IncidentOverview,
  playerMessage: string,
  recentSays: string[]
): string {
  const lines = [
    '現在のインシデント状況:',
    JSON.stringify(overview),
    '',
    `先輩からチャットで話しかけられました: ${JSON.stringify(playerMessage)}`,
    'この呼びかけに答えるひとこと(say)を返してください。関連する対応タスクを思いついた場合はsuggestTaskに、なければ空文字にしてください。',
  ];
  if (recentSays.length > 0) {
    lines.push(
      `直近の自分の発言と同じ内容は繰り返さないでください: ${JSON.stringify(recentSays)}`
    );
  }
  return lines.join('\n');
}

/**
 * Prompt API の出力を NpcReply に変換する。responseConstraint があっても
 * 端末側モデルが前後に余計なテキストを付けることがあるため、最初の
 * JSON オブジェクトを抜き出してからパースする。
 */
export function parseNpcReply(raw: string): NpcReply | undefined {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const say = normalizeText(
    (parsed as {say?: unknown}).say,
    NPC_SAY_MAX_LENGTH
  );
  const suggestTask = normalizeText(
    (parsed as {suggestTask?: unknown}).suggestTask,
    NPC_TASK_MAX_LENGTH
  );
  if (!say && !suggestTask) return undefined;
  return {
    ...(say ? {say} : {}),
    ...(suggestTask ? {suggestTask} : {}),
  };
}

/**
 * 繰り返し発言・既存タスクと重複する提案を落とす。
 * 何も残らなければ undefined。
 */
export function filterNpcReply(
  reply: NpcReply,
  recentSays: string[],
  openTaskTitles: string[]
): NpcReply | undefined {
  const say =
    reply.say && !recentSays.includes(reply.say) ? reply.say : undefined;
  const suggestTask =
    reply.suggestTask &&
    !openTaskTitles.some((title) => title.trim() === reply.suggestTask?.trim())
      ? reply.suggestTask
      : undefined;
  if (!say && !suggestTask) return undefined;
  return {
    ...(say ? {say} : {}),
    ...(suggestTask ? {suggestTask} : {}),
  };
}

export function appendRecentSay(recent: string[], say: string): string[] {
  return [...recent, say].slice(-NPC_RECENT_SAY_LIMIT);
}

function normalizeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function extractJsonObject(raw: string): string | undefined {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return undefined;
  return raw.slice(start, end + 1);
}
