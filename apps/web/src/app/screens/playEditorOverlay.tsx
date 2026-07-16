import type {GameRenderState} from '@incident/shared';
import {setCenterTool, updateEditorPanel} from '../../game/state/gameState.js';
import {centerEditorOverlayRegion} from '../../game/render/canvasLayout.js';
import {shouldShowEditorOverlay} from '../../pure/editorOverlayVisibility.js';

type PatchGameState = (
  updater: (state: GameRenderState) => GameRenderState,
  options?: {render?: boolean; collectTransitions?: boolean}
) => void;

export function EditorOverlay(props: {
  gameState: GameRenderState | undefined;
  canvasRef: {current: HTMLCanvasElement | null};
  editorTextareaRef: {current: HTMLTextAreaElement | null};
  patchGameStateRef: PatchGameState;
  onSaveEditorFile: () => void;
}) {
  const gameState = props.gameState;
  if (
    !gameState ||
    !shouldShowEditorOverlay(
      gameState.monitors.center.activeTool,
      gameState.recovery?.retireConfirming
    )
  ) {
    return null;
  }
  return (
    <textarea
      ref={props.editorTextareaRef}
      class='editor-overlay'
      style={editorOverlayStyle(
        props.canvasRef.current,
        gameState.world.expandedMonitor === 'terminal'
      )}
      value={gameState.monitors.center.editor.content}
      aria-label={`${gameState.monitors.center.editor.currentPath ?? 'ファイル'} を編集`}
      spellcheck={false}
      disabled={
        gameState.monitors.center.editor.status === 'loading' ||
        gameState.monitors.center.editor.status === 'saving'
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
