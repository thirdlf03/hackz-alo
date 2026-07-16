import {useEffect} from 'preact/hooks';
import type {
  ExerciseSnapshot,
  ExerciseTaskStatus,
  GameRenderState,
  IncidentLogEntryKind,
  ScenarioDefinition,
} from '@incident/shared';
import {
  activateChatCompose,
  deactivateChatCompose,
  setCenterTool,
  setChatDraft,
  updateEditorPanel,
} from '../../game/state/gameState.js';
import {
  centerEditorOverlayRegion,
  chatComposeRegion,
  type MonitorId,
  type RightPanelTab,
} from '../../game/render/canvasLayout.js';
import {canContributeRecords} from '../../pure/rolePermissions.js';
import {shouldShowEditorOverlay} from '../../pure/editorOverlayVisibility.js';
import {PerfOverlay} from '../PerfOverlay.js';
import type {VoiceChatControls} from '../useVoiceChat.js';
import {TeamExercisePanel} from './playPanels.js';

type PatchGameState = (
  updater: (state: GameRenderState) => GameRenderState,
  options?: {render?: boolean; collectTransitions?: boolean}
) => void;

export function PlayScreen(props: {
  gameState: GameRenderState | undefined;
  gameSpeed: number;
  participantId: string;
  scenario: ScenarioDefinition | undefined;
  exercise: ExerciseSnapshot | undefined;
  canvasRef: {current: HTMLCanvasElement | null};
  gameStateRef: {current: GameRenderState | undefined};
  scenarioRef: {current: ScenarioDefinition | undefined};
  chatInputRef: {current: HTMLInputElement | null};
  htmlInCanvasChat: boolean;
  editorTextareaRef: {current: HTMLTextAreaElement | null};
  patchGameStateRef: PatchGameState;
  onSetGameSpeed: (speed: number) => void;
  onSaveEditorFile: () => void;
  onCanvasClick: (event: MouseEvent) => void;
  onCanvasMove: (event: MouseEvent) => void;
  onCanvasWheel: (event: WheelEvent) => void;
  onTerminalKey: (event: KeyboardEvent) => void;
  onCanvasPaste: (event: ClipboardEvent) => void;
  onChatSubmit: () => void;
  onCreateTask: (title: string) => void;
  onUpdateTask: (
    taskId: string,
    input: {title?: string; status?: ExerciseTaskStatus}
  ) => void;
  onDeleteTask: (taskId: string) => void;
  onAppendIncidentLog: (body: string, kind?: IncidentLogEntryKind) => void;
  onUpdateIncidentLog: (
    entryId: string,
    input: {body?: string; kind?: IncidentLogEntryKind}
  ) => void;
  onDeleteIncidentLog: (entryId: string) => void;
  onFireInject: (injectId: string) => void;
  voice: VoiceChatControls;
  checkRecovery: () => Promise<void>;
}) {
  // HTML-in-Canvas 非対応環境で chatCompose がアクティブな間だけ、canvas 上に
  // 実 DOM の <input> を重ねて表示する(下の JSX 内 canvas-chat-overlay-input)。
  // 日本語 IME は実 DOM のフォーカスがないと機能しないため、canvas 疑似入力
  // (useTerminalBridge の pseudo-input)ではなくこちらに一本化する。
  // マウント時に自動でフォーカスし、非アクティブ化(送信・Escape・他クリック)
  // でアンマウントされたタイミングで canvas にフォーカスを戻し、ターミナル
  // 操作を継続できるようにする。
  const overlayChatActive =
    !props.htmlInCanvasChat && Boolean(props.gameState?.chatCompose.active);
  useEffect(() => {
    if (!overlayChatActive) return;
    props.chatInputRef.current?.focus();
    return () => {
      props.canvasRef.current?.focus();
    };
  }, [overlayChatActive]);

  return (
    <section class='game-layout'>
      {props.gameState &&
        shouldShowEditorOverlay(
          props.gameState.monitors.center.activeTool,
          props.gameState.recovery?.retireConfirming
        ) && (
          <textarea
            ref={props.editorTextareaRef}
            class='editor-overlay'
            style={editorOverlayStyle(
              props.canvasRef.current,
              props.gameState.world.expandedMonitor === 'terminal'
            )}
            value={props.gameState.monitors.center.editor.content}
            aria-label={`${props.gameState.monitors.center.editor.currentPath ?? 'ファイル'} を編集`}
            spellcheck={false}
            disabled={
              props.gameState.monitors.center.editor.status === 'loading' ||
              props.gameState.monitors.center.editor.status === 'saving'
            }
            onInput={(event) => {
              const target = event.currentTarget;
              const cursor = editorCursorFromTextarea(target);
              props.patchGameStateRef((current) =>
                updateEditorPanel(current, (editor) => ({
                  ...editor,
                  content: target.value,
                  dirty: target.value !== editor.savedContent,
                  status: editor.status === 'error' ? 'ready' : editor.status,
                  cursor,
                }))
              );
            }}
            onSelect={(event) => {
              const target = event.currentTarget;
              const cursor = editorCursorFromTextarea(target);
              props.patchGameStateRef(
                (current) =>
                  updateEditorPanel(current, (editor) => ({
                    ...editor,
                    cursor,
                  })),
                {collectTransitions: false}
              );
            }}
            onKeyDown={(event) => {
              if (
                (event.metaKey || event.ctrlKey) &&
                event.key.toLowerCase() === 's'
              ) {
                event.preventDefault();
                props.onSaveEditorFile();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                props.patchGameStateRef((current) =>
                  setCenterTool(current, 'terminal')
                );
              }
            }}
          />
        )}
      <div class='canvas-stage'>
        <canvas
          ref={props.canvasRef}
          width='1920'
          height='1080'
          aria-label='録画対象のゲーム画面。ターミナル入力はキーボードで操作できます。'
          aria-describedby='canvas-play-hint'
          tabIndex={0}
          onClick={props.onCanvasClick}
          onMouseMove={props.onCanvasMove}
          onWheel={props.onCanvasWheel}
          onKeyDown={props.onTerminalKey}
          onPaste={props.onCanvasPaste}
        >
          {/* HTML-in-Canvas 対応時のみ、canvas 内チャット欄を本物の <input> に
              置き換える(IME・テキスト選択・スクリーンリーダー対応)。非対応時は
              子を描画せず、従来の canvas 自前描画へフォールバックする。 */}
          {props.htmlInCanvasChat && (
            <input
              ref={props.chatInputRef}
              class='canvas-embedded-chat-input'
              aria-label='チャットメッセージ'
              maxLength={500}
              value={props.gameState?.chatCompose.draft ?? ''}
              onInput={(event) => {
                const {value} = event.currentTarget;
                props.patchGameStateRef((current) =>
                  setChatDraft(current, value)
                );
              }}
              onFocus={() => {
                props.patchGameStateRef((current) =>
                  activateChatCompose(current)
                );
              }}
              onBlur={() => {
                props.patchGameStateRef((current) =>
                  deactivateChatCompose(current)
                );
              }}
              onKeyDown={(event) => {
                // IME変換確定のEnter(isComposing/keyCode 229)は送信しない。
                if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) {
                  event.preventDefault();
                  props.onChatSubmit();
                }
              }}
            />
          )}
        </canvas>
        {/* HTML-in-Canvas 非対応環境向けのチャット入力オーバーレイ。canvas の
            外(canvas-stage の兄弟要素)に position: fixed で置き、chatCompose
            の矩形(chatComposeRegion)にスケーリングして重ねる。canvas の子
            要素は HTML-in-Canvas 非対応環境では実 DOM として操作できないため、
            editor-overlay と同じ手法(getBoundingClientRect + スケール)を使う。
            draft は state.chatCompose.draft と onInput で同期し続け、canvas
            側の drawChatCompose もそのまま描き続ける(録画にテキストが残る)。
            オーバーレイが不透明背景で上に被さるため二重表示は起きない。 */}
        {overlayChatActive && props.gameState && (
          <input
            ref={props.chatInputRef}
            class='canvas-chat-overlay-input'
            aria-label='チャットメッセージ'
            maxLength={500}
            style={chatComposeOverlayStyle(
              props.canvasRef.current,
              props.gameState.monitors.right.activePanelTab,
              props.gameState.world.expandedMonitor
            )}
            value={props.gameState.chatCompose.draft}
            onInput={(event) => {
              const {value} = event.currentTarget;
              props.patchGameStateRef((current) =>
                setChatDraft(current, value)
              );
            }}
            onFocus={() => {
              props.patchGameStateRef((current) =>
                activateChatCompose(current)
              );
            }}
            onBlur={() => {
              props.patchGameStateRef((current) =>
                deactivateChatCompose(current)
              );
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                props.patchGameStateRef((current) =>
                  deactivateChatCompose(current)
                );
                return;
              }
              // IME変換確定のEnter(isComposing/keyCode 229)は送信しない。
              if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) {
                event.preventDefault();
                props.onChatSubmit();
              }
            }}
          />
        )}
        <PerfOverlay />
        {props.gameState?.warning && props.gameState.warning.flashMs > 0 && (
          <p class='play-warning-banner' role='status'>
            {props.gameState.warning.message}
          </p>
        )}
      </div>
      <TeamExercisePanel
        exercise={props.exercise}
        canContribute={canContributeRecords(
          props.exercise?.participants ?? [],
          props.participantId
        )}
        canvasRef={props.canvasRef}
        gameStateRef={props.gameStateRef}
        scenarioRef={props.scenarioRef}
        scenario={props.scenario}
        commandInputFocused={props.gameState?.commandInputFocused ?? false}
        onCreateTask={props.onCreateTask}
        onUpdateTask={props.onUpdateTask}
        onDeleteTask={props.onDeleteTask}
        onAppendIncidentLog={props.onAppendIncidentLog}
        onUpdateIncidentLog={props.onUpdateIncidentLog}
        onDeleteIncidentLog={props.onDeleteIncidentLog}
        onFireInject={props.onFireInject}
        voice={props.voice}
        checkRecovery={props.checkRecovery}
        recoveryState={props.gameState?.recovery}
      />
      <p id='canvas-play-hint' class='visually-hidden'>
        ターミナルにフォーカスしてキーボードでコマンドを入力できます。画面上のボタンはマウスで操作します。
      </p>
    </section>
  );
}

function editorOverlayStyle(
  canvas: HTMLCanvasElement | null,
  expanded: boolean
) {
  if (!canvas) return {display: 'none'};
  const rect = canvas.getBoundingClientRect();
  const region = centerEditorOverlayRegion(expanded);
  const scaleX = rect.width / 1920;
  const scaleY = rect.height / 1080;
  return {
    left: `${String(rect.left + region.x * scaleX)}px`,
    top: `${String(rect.top + region.y * scaleY)}px`,
    width: `${String(region.width * scaleX)}px`,
    height: `${String(region.height * scaleY)}px`,
  };
}

function chatComposeOverlayStyle(
  canvas: HTMLCanvasElement | null,
  activePanelTab: RightPanelTab,
  expandedMonitor: MonitorId | null
) {
  if (!canvas) return {display: 'none'};
  const rect = canvas.getBoundingClientRect();
  const region = chatComposeRegion(activePanelTab, expandedMonitor);
  const scaleX = rect.width / 1920;
  const scaleY = rect.height / 1080;
  return {
    left: `${String(rect.left + region.x * scaleX)}px`,
    top: `${String(rect.top + region.y * scaleY)}px`,
    width: `${String(region.width * scaleX)}px`,
    height: `${String(region.height * scaleY)}px`,
  };
}

function editorCursorFromTextarea(textarea: HTMLTextAreaElement) {
  const before = textarea.value.slice(0, textarea.selectionStart);
  const lines = before.split('\n');
  return {
    line: lines.length,
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
  };
}
