import type {AssistAvailability} from './aiAssist.js';
import {formatDuration} from './replayMedia.js';

export interface PostmortemInput {
  scenarioTitle: string;
  result: string | null;
  durationMs: number;
  events: Array<{type: string; at_ms: number; summary?: string | null}>;
  incidentLog: Array<{kind: string; body: string; createdAt?: string}>;
}

/** Upper bound for the on-device model input (~8000 chars). */
export const POSTMORTEM_SOURCE_MAX_LENGTH = 8000;

export const POSTMORTEM_SHARED_CONTEXT = [
  'これはインシデント対応訓練セッションの記録です。',
  '監視アラート、オペレーターの操作、チームのインシデントログが時系列で含まれます。',
  '出力は障害対応のポストモーテム(振り返り資料)の草案として使われます。',
].join('\n');

export const POSTMORTEM_ROOT_CAUSE_TASK =
  '以下のインシデント対応記録をもとに、障害の根本原因の分析を日本語で2〜3文で書いてください。記録にない事実は推測と明記してください。';

export const POSTMORTEM_ACTIONS_TASK =
  '以下のインシデント対応記録をもとに、再発防止・改善アクションを日本語で3〜5個の箇条書きで書いてください。具体的で実行可能な内容にしてください。';

/**
 * Event types worth keeping in the postmortem source, with a priority used
 * when the text must be truncated (higher survives longer).
 */
const eventPriority: Record<string, number> = {
  incident_resolved: 5,
  session_end: 5,
  session_start: 5,
  alert: 4,
  service_health_changed: 3,
  inject_fired: 3,
  player_note: 3,
  command_detected: 2,
  runbook_open: 2,
};

function postmortemEventPriority(type: string): number {
  const known = eventPriority[type];
  if (known !== undefined) return known;
  // Inject-related events (e.g. inject_fired variants) matter for the story.
  if (type.includes('inject')) return 3;
  // Everything else (recording_chunk_created, cursor moves, ...) is noise.
  return 0;
}

const incidentLogKindLabels: Record<string, string> = {
  note: 'メモ',
  decision: '判断',
  hypothesis: '仮説',
  comms: '連絡',
  follow_up: 'フォローアップ',
  role_deviation: 'ロール逸脱',
};

function incidentLogKindLabel(kind: string): string {
  return incidentLogKindLabels[kind] ?? kind;
}

function eventLine(event: {
  type: string;
  at_ms: number;
  summary?: string | null;
}): string {
  const time = formatDuration(event.at_ms);
  const summary = event.summary?.trim();
  return summary
    ? `[${time}] ${event.type}: ${summary}`
    : `[${time}] ${event.type}`;
}

/**
 * Builds a compact Japanese source text for the Summarizer/Writer APIs:
 * header, chronological timeline, then the team's incident log. Length is
 * capped at {@link POSTMORTEM_SOURCE_MAX_LENGTH} by dropping the
 * lowest-priority timeline events first.
 */
export function buildPostmortemSource(input: PostmortemInput): string {
  const headerLines = [
    `シナリオ: ${input.scenarioTitle}`,
    `結果: ${input.result ?? '不明'}`,
    `対応時間: ${formatDuration(input.durationMs)}`,
  ];

  const logLines = input.incidentLog
    .map((entry) => ({entry, body: entry.body.trim()}))
    .filter(({body}) => body.length > 0)
    .map(({entry, body}) => `(${incidentLogKindLabel(entry.kind)}) ${body}`);

  let kept = input.events
    .filter((event) => postmortemEventPriority(event.type) > 0)
    .toSorted((a, b) => a.at_ms - b.at_ms);

  const render = () => {
    const sections = [headerLines.join('\n')];
    if (kept.length > 0) {
      sections.push(
        ['# タイムライン', ...kept.map((event) => eventLine(event))].join('\n')
      );
    }
    if (logLines.length > 0) {
      sections.push(['# インシデントログ', ...logLines].join('\n'));
    }
    return sections.join('\n\n');
  };

  let text = render();
  while (text.length > POSTMORTEM_SOURCE_MAX_LENGTH && kept.length > 0) {
    // Drop the earliest occurrence of the lowest-priority type still present.
    const lowest = Math.min(
      ...kept.map((event) => postmortemEventPriority(event.type))
    );
    const dropIndex = kept.findIndex(
      (event) => postmortemEventPriority(event.type) === lowest
    );
    kept = kept.filter((_, index) => index !== dropIndex);
    text = render();
  }
  return text.length > POSTMORTEM_SOURCE_MAX_LENGTH
    ? text.slice(0, POSTMORTEM_SOURCE_MAX_LENGTH)
    : text;
}

export function buildPostmortemMarkdown(sections: {
  timeline?: string;
  rootCause?: string;
  actions?: string;
}): string {
  const parts: string[] = [];
  const timeline = sections.timeline?.trim();
  const rootCause = sections.rootCause?.trim();
  const actions = sections.actions?.trim();
  if (timeline) parts.push(`## タイムライン要約\n\n${timeline}`);
  if (rootCause) parts.push(`## 根本原因\n\n${rootCause}`);
  if (actions) parts.push(`## 改善アクション\n\n${actions}`);
  return parts.join('\n\n');
}

export function describePostmortemAvailability(
  availability: AssistAvailability
): string {
  switch (availability) {
    case 'unsupported':
      return 'このブラウザはオンデバイスAIに対応していません';
    case 'unavailable':
      return 'この端末ではオンデバイスAIを利用できません';
    case 'downloadable':
      return 'AIモデルをダウンロードするとポストモーテム草案を生成できます';
    case 'downloading':
      return 'AIモデルをダウンロードしています…';
    case 'available':
      return 'セッション記録からポストモーテム草案を端末内で生成できます';
  }
}

/**
 * Overall gate for the postmortem panel.
 * Rule: 'unsupported' only when BOTH engines are missing; a download state
 * surfaces when either engine still needs its model; otherwise the panel is
 * usable as soon as the Summarizer is ready — the Writer is optional and the
 * actions/root-cause sections are simply skipped when it cannot run.
 */
export function combinePostmortemAvailability(
  summarizer: AssistAvailability,
  writer: AssistAvailability
): AssistAvailability {
  if (summarizer === 'unsupported' && writer === 'unsupported') {
    return 'unsupported';
  }
  if (summarizer === 'downloading' || writer === 'downloading') {
    return 'downloading';
  }
  if (summarizer === 'downloadable' || writer === 'downloadable') {
    return 'downloadable';
  }
  return summarizer === 'available' ? 'available' : 'unavailable';
}
