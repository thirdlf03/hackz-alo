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
  markRunbookStep,
  setCenterTool,
  setChatDraft,
  updateEditorPanel,
} from '../../game/state/gameState.js';
import {centerEditorOverlayRegion} from '../../game/render/canvasLayout.js';
import {canContributeRecords} from '../../pure/rolePermissions.js';
import {PerfOverlay} from '../PerfOverlay.js';
import type {VoiceChatControls} from '../useVoiceChat.js';
import type {MonitorPipControls} from '../useMonitorPip.js';
import {TeamExercisePanel, MonitorPipToolbar} from './playPanels.js';

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
  pip: MonitorPipControls;
}) {
  return (
    <section class='game-layout'>
      {props.gameState?.monitors.center.activeTool === 'editor' && (
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
                if (event.key === 'Enter') {
                  event.preventDefault();
                  props.onChatSubmit();
                }
              }}
            />
          )}
        </canvas>
        <PerfOverlay />
        <MonitorPipToolbar pip={props.pip} />
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
        activeRunbook={props.gameState?.monitors.right.activeRunbook}
        runbookProgress={props.gameState?.runbookProgress}
        commandInputFocused={props.gameState?.commandInputFocused ?? false}
        onCreateTask={props.onCreateTask}
        onUpdateTask={props.onUpdateTask}
        onDeleteTask={props.onDeleteTask}
        onAppendIncidentLog={props.onAppendIncidentLog}
        onUpdateIncidentLog={props.onUpdateIncidentLog}
        onDeleteIncidentLog={props.onDeleteIncidentLog}
        onFireInject={props.onFireInject}
        onMarkRunbookStep={(runbookId, bodyHash, stepId, status) => {
          props.patchGameStateRef((current) =>
            markRunbookStep(current, runbookId, bodyHash, stepId, status)
          );
        }}
        voice={props.voice}
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

function editorCursorFromTextarea(textarea: HTMLTextAreaElement) {
  const before = textarea.value.slice(0, textarea.selectionStart);
  const lines = before.split('\n');
  return {
    line: lines.length,
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
  };
}
