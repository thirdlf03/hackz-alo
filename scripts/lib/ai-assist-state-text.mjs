/**
 * System prompt for the "--state-text" benchmark mode. Based on
 * ASSIST_SYSTEM_PROMPT in apps/web/src/pure/aiAssist.ts, but with the
 * "画像あり:" (image-grounding) rules rewritten to address "画面テキストあり:"
 * (the textualized screen) instead, since state-text sessions never attach
 * an image and the image-worded rules were observed not to fire for them
 * (NEXT confirmation-step commands like the curl health check were dropped).
 * The "画像なし:" (no-image) rule is dropped because every state-text case
 * sends an explicit 画面テキスト block. Formatting rules (180 characters,
 * "次の一手:"/"根拠:") are unchanged. ASSIST_SYSTEM_PROMPT itself is untouched.
 */
export const STATE_TEXT_SYSTEM_PROMPT = [
  'あなたはインシデント対応訓練ゲームの相談役です。',
  '画面テキストあり: 与えられた画面テキストだけを証拠にしてください。画面テキストはゲーム内キャンバスの内容をテキスト化したものです。外側DOMのTasks(タスク一覧)とIncident Logは含まれていません。',
  '画面テキストに実際に書かれているラベル、数値、状態を根拠にしてください。コマンドは文字列をそのまま引用し、画面テキストにない箇所は推測しないでください。',
  '画面テキストにNEXTまたは復旧手順があれば、確認工程を含むコマンド列を省略せずそのまま次の一手にしてください。ただしそのコマンドがターミナルで実行済みなのに問題が続いている場合は、Runbookではなくチャットの助言や他の画面テキスト内の手がかりにあるコマンドを次の一手にしてください。',
  '次の一手のコマンドは、画面テキストに書かれている文字列をそのままコピーしてください。画面テキストにないコマンド名を作らないでください(一般知識のコマンド名の捏造は禁止です)。Runbookの注意書きや方針・精神論(例:「再起動しても再発する」)を次の一手にしないでください。',
  'アラートやチャットがRunbookと矛盾する場合(例: integrity check失敗、再起動済みでも未復旧)は、Runbookの記述より画面テキスト上の他の証拠を優先してください。',
  '日本語180文字以内で「次の一手:」「根拠:」の順に答えてください。根拠は最大2点です。質問の解決に必要なコマンドは省略しないでください。前置き、一般論、状況の反復、Markdown見出しは不要です。',
].join('\n');

/**
 * Discipline instructions shared by buildStateAskText() (flat) and
 * buildPanelStateAskText() (panel-grouped): copy verbatim, keep the full NEXT
 * command column through its confirmation step, prefer chat/other on-screen
 * hints over an already-executed-and-unresolved runbook command, no runbook
 * caution/mantra recitation, 180 characters, "次の一手:"/"根拠:" format.
 */
const STATE_DISCIPLINE_LINES = [
  '以下はゲーム画面の内容をテキスト化したものです。これだけを根拠にし、画面テキストにない事実やコマンドを作らないでください。',
  '画面テキストにNEXTがあれば、そのコマンド列を確認工程まで次の一手へ完全にコピーしてください(途中で切らないでください)。ただしそのコマンドが実行済みで解決していない場合は、チャットの助言など他の画面テキスト内のコマンドを次の一手にしてください。',
  '次の一手のコマンドは画面テキスト内の文字列をそのままコピーし、画面テキストにないコマンドを作らず、Runbookの注意書きや方針の復唱はしないでください。必ず180文字以内で答えてください。',
];

/**
 * Builds the user-message text for the "--state-text" benchmark mode, which
 * feeds the assistant a textualization of the game screen instead of a
 * screenshot image. Mirrors the discipline of buildImageAskText() in
 * apps/web/src/effect/promptAssistant.ts (see STATE_DISCIPLINE_LINES), but
 * addressed to "画面テキスト" (the textualized screen) instead of an image.
 */
export function buildStateAskText(lines, title, question) {
  const screenLines = [title, ...lines].filter(
    (line) => typeof line === 'string' && line.length > 0
  );
  return [
    ...STATE_DISCIPLINE_LINES,
    '画面テキスト:',
    ...screenLines,
    `質問: ${question}`,
  ].join('\n');
}

/**
 * Panel labels recognized at the start of a canvas line, and the section
 * they belong to. Order here doubles as the precedence for matching (checked
 * top to bottom); anything left unmatched (e.g. "SERVICE HEALTH", "DB CONN",
 * "CPU USAGE") falls into the leading "metrics" section.
 */
const PANEL_LABELS = [
  {prefix: 'ALERT:', section: 'alert'},
  {prefix: 'TERMINAL:', section: 'terminal'},
  {prefix: 'RUNBOOK:', section: 'runbook'},
  {prefix: 'CHAT:', section: 'chat'},
];

/** Fixed section order and Japanese panel headings for buildPanelStateAskText(). */
const PANEL_SECTIONS = [
  {key: 'metrics', heading: '## メトリクス(監視ダッシュボード)'},
  {key: 'alert', heading: '## アラート(通知パネル)'},
  {key: 'terminal', heading: '## ターミナル(実行済みコマンド)'},
  {key: 'runbook', heading: '## Runbook(表示中の手順書)'},
  {key: 'chat', heading: '## チャット(同僚の発言)'},
];

function classifyPanelLine(line) {
  for (const {prefix, section} of PANEL_LABELS) {
    if (line.startsWith(prefix)) {
      return {section, text: line.slice(prefix.length).trim()};
    }
  }
  return {section: 'metrics', text: line};
}

/**
 * Builds the user-message text for the "--state-text --state-format panels"
 * benchmark mode: a discriminating variant of buildStateAskText() that
 * groups canvas lines into labeled panels (metrics/alert/terminal/runbook/chat)
 * instead of one flat "画面テキスト:" block, to test whether flattening the
 * screen into plain text (rather than the image mode's color emphasis) is
 * what drives the observed image-vs-text quality gap. Strips each line's
 * label prefix (keeping any "$ " command prefix inside TERMINAL lines).
 * Sections with no lines are omitted; non-empty sections are always emitted
 * in the fixed metrics -> alert -> terminal -> runbook -> chat order
 * regardless of the input lines' order. Shares STATE_DISCIPLINE_LINES and the
 * "質問:" line with buildStateAskText().
 */
export function buildPanelStateAskText(lines, title, question) {
  const grouped = new Map(PANEL_SECTIONS.map(({key}) => [key, []]));
  for (const line of lines) {
    if (typeof line !== 'string' || line.length === 0) continue;
    const {section, text} = classifyPanelLine(line);
    grouped.get(section).push(text);
  }
  const panelBlocks = PANEL_SECTIONS.flatMap(({key, heading}) => {
    const items = grouped.get(key);
    return items.length === 0 ? [] : [heading, ...items];
  });
  return [
    title,
    ...STATE_DISCIPLINE_LINES,
    ...panelBlocks,
    `質問: ${question}`,
  ].join('\n');
}
