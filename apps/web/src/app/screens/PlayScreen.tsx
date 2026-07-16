import type {
  ExerciseSnapshot,
  ExerciseTaskStatus,
  GameRenderState,
  IncidentLogEntryKind,
  ScenarioDefinition,
} from '@incident/shared';
import {canContributeRecords} from '../../pure/rolePermissions.js';
import {PerfOverlay} from '../PerfOverlay.js';
import type {VoiceChatControls} from '../useVoiceChat.js';
import {TeamExercisePanel} from './playPanels.js';
import {EditorOverlay} from './playEditorOverlay.js';
import {
  ChatOverlayInput,
  EmbeddedChatInput,
  useChatOverlayFocus,
} from './playChatOverlay.js';

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
  const overlayChatActive =
    !props.htmlInCanvasChat && Boolean(props.gameState?.chatCompose.active);
  useChatOverlayFocus(overlayChatActive, props.chatInputRef, props.canvasRef);

  return (
    <section class='game-layout'>
      <EditorOverlay
        gameState={props.gameState}
        canvasRef={props.canvasRef}
        editorTextareaRef={props.editorTextareaRef}
        patchGameStateRef={props.patchGameStateRef}
        onSaveEditorFile={props.onSaveEditorFile}
      />
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
          <EmbeddedChatInput
            visible={props.htmlInCanvasChat}
            chatInputRef={props.chatInputRef}
            gameState={props.gameState}
            patchGameStateRef={props.patchGameStateRef}
            onChatSubmit={props.onChatSubmit}
          />
        </canvas>
        <ChatOverlayInput
          active={overlayChatActive}
          gameState={props.gameState}
          chatInputRef={props.chatInputRef}
          canvasRef={props.canvasRef}
          patchGameStateRef={props.patchGameStateRef}
          onChatSubmit={props.onChatSubmit}
        />
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
