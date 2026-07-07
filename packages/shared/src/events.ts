import type {Actor, ReplayEvent, ReplayEventType} from './types.js';

let localCounter = 0;

export function createReplayEvent(input: {
  replayId: string;
  type: ReplayEventType;
  at: number;
  actor: Actor;
  payload?: Record<string, unknown>;
  visibility?: ReplayEvent['visibility'];
}): ReplayEvent {
  localCounter += 1;
  return {
    id: `evt_${Date.now().toString(36)}_${localCounter.toString(36)}`,
    replayId: input.replayId,
    type: input.type,
    at: Math.max(0, Math.floor(input.at)),
    wallTime: new Date().toISOString(),
    actor: input.actor,
    payload: input.payload ?? {},
    visibility: input.visibility ?? 'public_safe',
  };
}

export function toJsonLine(event: ReplayEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function replayEventSummary(event: ReplayEvent): string {
  if (event.type === 'session_start') {
    return 'シナリオ開始';
  }
  if (event.type === 'session_end') {
    if (event.payload.result === 'retired') return '解雇！';
    if (event.payload.result === 'false_resolve') return '未復旧のまま解雇';
    if (event.payload.result === 'failed') return '解雇！';
    if (event.payload.result === 'timeout') return '解雇！';
    if (event.payload.result === 'aborted') return '強制終了';
    return 'セッション終了';
  }
  if (
    event.type === 'terminal_input' &&
    typeof event.payload.data === 'string'
  ) {
    return `command: ${event.payload.data.trim()}`;
  }
  if (event.type === 'alert' && typeof event.payload.message === 'string') {
    return `alert: ${event.payload.message}`;
  }
  if (
    event.type === 'runbook_open' &&
    typeof event.payload.runbookId === 'string'
  ) {
    return `runbook: ${event.payload.runbookId}`;
  }
  if (
    event.type === 'command_detected' &&
    typeof event.payload.command === 'string'
  ) {
    return `command: ${event.payload.command}`;
  }
  if (event.type === 'player_note' && typeof event.payload.body === 'string') {
    return `チャット報告: ${event.payload.body}`;
  }
  if (
    event.type === 'recovery_check' &&
    typeof event.payload.command === 'string'
  ) {
    return `復旧確認: ${event.payload.command}`;
  }
  if (
    event.type === 'service_restart' &&
    typeof event.payload.command === 'string'
  ) {
    return `再起動: ${event.payload.command}`;
  }
  if (event.type === 'file_opened' && typeof event.payload.path === 'string') {
    return `ファイル: ${event.payload.path}`;
  }
  if (event.type === 'file_saved' && typeof event.payload.path === 'string') {
    return `保存: ${event.payload.path}`;
  }
  if (
    event.type === 'ui_panel_open' &&
    typeof event.payload.panel === 'string'
  ) {
    return panelOpenSummary(event.payload.panel);
  }
  if (
    event.type === 'monitor_update' &&
    typeof event.payload.label === 'string'
  ) {
    return `メトリクス: ${event.payload.label}`;
  }
  if (event.type === 'incident_resolved') {
    return '復旧宣言';
  }
  return event.type;
}

function panelOpenSummary(panel: string) {
  if (panel === 'editor') return 'Editor を開いた';
  if (panel === 'notifications') return '通知パネルを開いた';
  if (panel === 'chat_compose' || panel === 'slack_compose') {
    return 'チャット返信を開始';
  }
  return `パネル: ${panel}`;
}
