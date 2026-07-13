import type {IncidentLogEntryKind, ScenarioDefinition} from '@incident/shared';

export interface SpeechPhrase {
  phrase: string;
  /** 0.0〜10.0。高いほど認識されやすい。誤爆を避けるため第1弾は 3.0 を上限にする。 */
  boost: number;
}

/**
 * boost の上限。過大な boost は無関係な発話が固有語に吸われる誤爆を招くため、
 * explainer の推奨に従い控えめに抑える。
 */
export const SPEECH_PHRASE_MAX_BOOST = 3.0;

const NODE_LABEL_BOOST = 3.0;
const TITLE_WORD_BOOST = 2.5;
const VOCAB_BOOST = 2.0;

/** メトリクス系の固定語彙。汎用認識が誤りやすいゲーム内固有語。 */
const METRICS_VOCAB = [
  '5xx',
  'p95',
  'レイテンシ',
  'キュー',
  'コネクション',
  'DBプール',
  'スループット',
];

/** ログ分類キーワード(classifySpokenLog の先頭一致語と揃える)。 */
const LOG_KEYWORDS = [
  '仮説',
  '判断',
  '決定',
  '連絡',
  '共有',
  'フォローアップ',
  '宿題',
  'メモ',
  '記録',
];

function titleWords(title: string): string[] {
  return title
    .split(/[\s、。:：/()（）「」]+/u)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2);
}

/**
 * `ScenarioDefinition` と固定語彙からコンテキストバイアス用のフレーズ辞書を
 * 組み立てる純粋関数。シナリオロード時に一度だけ生成し、セッション中は固定する。
 * 同一フレーズは最も高い boost を採用し、boost は上限で丸める。
 */
export function buildSpeechPhrases(
  scenario: ScenarioDefinition | undefined
): SpeechPhrase[] {
  const byPhrase = new Map<string, number>();
  const add = (raw: string, boost: number) => {
    const phrase = raw.trim();
    if (!phrase) return;
    const capped = Math.min(boost, SPEECH_PHRASE_MAX_BOOST);
    const existing = byPhrase.get(phrase);
    if (existing === undefined || capped > existing) {
      byPhrase.set(phrase, capped);
    }
  };

  for (const node of scenario?.topology?.nodes ?? []) {
    add(node.label, NODE_LABEL_BOOST);
  }
  for (const inject of scenario?.exercise?.injects ?? []) {
    for (const word of titleWords(inject.title)) add(word, TITLE_WORD_BOOST);
  }
  for (const runbook of scenario?.runbooks ?? []) {
    for (const word of titleWords(runbook.title)) add(word, TITLE_WORD_BOOST);
  }
  for (const word of METRICS_VOCAB) add(word, VOCAB_BOOST);
  for (const word of LOG_KEYWORDS) add(word, VOCAB_BOOST);

  return [...byPhrase.entries()].map(([phrase, boost]) => ({phrase, boost}));
}

/** 発話先頭のキーワード → IncidentLogEntryKind の対応表。 */
const KIND_PREFIXES: Array<{keywords: string[]; kind: IncidentLogEntryKind}> = [
  {keywords: ['仮説'], kind: 'hypothesis'},
  {keywords: ['判断', '決定'], kind: 'decision'},
  {keywords: ['連絡', '共有'], kind: 'comms'},
  {keywords: ['フォローアップ', '宿題'], kind: 'follow_up'},
  {keywords: ['メモ', '記録'], kind: 'note'},
];

/** キーワードと本文を区切る記号(読点・句点・コロン)。 */
const DELIMITER = /^[\s、。,.:：]+/u;

export interface ClassifiedSpokenLog {
  kind: IncidentLogEntryKind;
  /** 先頭キーワードと区切りを除いた本文。 */
  body: string;
}

/**
 * 発話テキストの先頭語で `kind` を分類し、本文を切り出す。該当語がなければ `note`。
 * 例: 「仮説、DBプールが枯渇している」→ {hypothesis, 'DBプールが枯渇している'}
 */
export function classifySpokenLog(transcript: string): ClassifiedSpokenLog {
  const trimmed = transcript.trim();
  for (const {keywords, kind} of KIND_PREFIXES) {
    for (const keyword of keywords) {
      if (!trimmed.startsWith(keyword)) continue;
      const rest = trimmed.slice(keyword.length);
      // 区切り記号が続く場合のみキーワードとして扱う(「判断する」等の誤検出を防ぐ)。
      if (rest === '' || DELIMITER.test(rest)) {
        return {kind, body: rest.replace(DELIMITER, '').trim()};
      }
    }
  }
  return {kind: 'note', body: trimmed};
}

export type SpeechLogAvailability =
  | 'unsupported' // SpeechRecognition が無い
  | 'no-phrase-support' // 認識は可能だがフレーズリスト非対応
  | 'ready';

export function describeSpeechLogAvailability(
  availability: SpeechLogAvailability
): string {
  switch (availability) {
    case 'unsupported':
      return 'このブラウザは音声認識に対応していません';
    case 'no-phrase-support':
      return '音声でインシデントログに記録できます(固有語補正なし)';
    case 'ready':
      return '音声でインシデントログに記録できます';
  }
}

export const INCIDENT_LOG_KIND_LABELS: Record<IncidentLogEntryKind, string> = {
  note: 'メモ',
  decision: '判断',
  hypothesis: '仮説',
  comms: '連絡',
  follow_up: 'フォローアップ',
  role_deviation: 'ロール逸脱',
};
