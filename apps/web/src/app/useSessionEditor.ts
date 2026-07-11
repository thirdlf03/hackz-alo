import {useEffect, useRef} from 'preact/hooks';
import type {GameRenderState} from '@incident/shared';
import type {ApiClientSurface} from '../api/client.js';
import {updateEditorPanel} from '../game/state/gameState.js';
import {canOperateSandbox} from '../pure/rolePermissions.js';
import type {ReplayEventEmitter} from '../game/events/emitReplayEvent.js';
import type {Screen} from './appTypes.js';

interface SessionIdentity {
  sessionId: string;
  replayId: string;
}
type PatchGameState = (
  updater: (state: GameRenderState) => GameRenderState,
  options?: {render?: boolean; collectTransitions?: boolean}
) => void;

export function useSessionEditor(options: {
  api: ApiClientSurface;
  screen: Screen;
  participantId: string;
  gameState: GameRenderState | undefined;
  sessionRef: {current: SessionIdentity | undefined};
  gameStateRef: {current: GameRenderState | undefined};
  eventEmitterRef: {current: ReplayEventEmitter | null};
  patchGameStateRef: PatchGameState;
  currentGameTimeMs: () => number;
}) {
  const editorTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (
      options.screen !== 'play' ||
      options.gameState?.monitors.center.activeTool !== 'editor'
    ) {
      return;
    }
    window.setTimeout(() => editorTextareaRef.current?.focus(), 0);
  }, [
    options.screen,
    options.gameState?.monitors.center.activeTool,
    options.gameState?.monitors.center.editor.currentPath,
  ]);

  async function loadEditorFiles(preferredPath?: string) {
    const activeSession = options.sessionRef.current;
    if (!activeSession) return;
    options.patchGameStateRef((current) =>
      updateEditorPanel(current, (editor) => ({
        ...editor,
        status: 'loading',
        error: undefined,
      }))
    );
    try {
      const response = await options.api.listSessionFiles(
        activeSession.sessionId
      );
      const files =
        response.files.length > 0
          ? response.files
          : (options.gameStateRef.current?.monitors.center.editor.files ?? []);
      const targetPath =
        preferredPath ??
        options.gameStateRef.current?.monitors.center.editor.currentPath ??
        files[0]?.path;
      options.patchGameStateRef((current) =>
        updateEditorPanel(current, (editor) => ({...editor, files}))
      );
      if (targetPath) await openEditorFile(targetPath, {skipListRefresh: true});
      else {
        options.patchGameStateRef((current) =>
          updateEditorPanel(current, (editor) => ({
            ...editor,
            status: 'ready',
          }))
        );
      }
    } catch (error) {
      options.patchGameStateRef((current) =>
        updateEditorPanel(current, (editor) => ({
          ...editor,
          status: 'error',
          error: toErrorMessage(error),
        }))
      );
    }
  }

  async function openEditorFile(
    path: string,
    optionsOverride: {skipListRefresh?: boolean} = {}
  ) {
    const activeSession = options.sessionRef.current;
    if (!activeSession) return;
    if (
      !optionsOverride.skipListRefresh &&
      options.gameStateRef.current?.monitors.center.editor.files.length === 0
    ) {
      await loadEditorFiles(path);
      return;
    }
    options.patchGameStateRef((current) =>
      updateEditorPanel(current, (editor) => ({
        ...editor,
        currentPath: path,
        status: 'loading',
        error: undefined,
      }))
    );
    try {
      const file = await options.api.readSessionFile(
        activeSession.sessionId,
        path
      );
      options.patchGameStateRef((current) =>
        updateEditorPanel(current, (editor) => ({
          ...editor,
          currentPath: file.path,
          content: file.content,
          savedContent: file.content,
          dirty: false,
          status: 'ready',
          error: undefined,
          cursor: {line: 1, column: 1},
        }))
      );
      const replayId = options.sessionRef.current?.replayId;
      const emitter = options.eventEmitterRef.current;
      if (replayId && emitter) {
        void emitter.emit({
          replayId,
          type: 'file_opened',
          at: options.currentGameTimeMs(),
          payload: {path: file.path},
        });
      }
    } catch (error) {
      options.patchGameStateRef((current) =>
        updateEditorPanel(current, (editor) => ({
          ...editor,
          status: 'error',
          error: toErrorMessage(error),
        }))
      );
    }
  }

  async function saveEditorFile() {
    const activeSession = options.sessionRef.current;
    const editor = options.gameStateRef.current?.monitors.center.editor;
    if (!activeSession || !editor?.currentPath || editor.status === 'saving') {
      return;
    }
    if (
      !canOperateSandbox(
        options.gameStateRef.current?.room.participants ?? [],
        options.participantId
      )
    ) {
      options.patchGameStateRef((current) =>
        updateEditorPanel(current, (value) => ({
          ...value,
          status: 'error',
          error: 'ファイル保存は Ops / Facilitator のみ行えます',
        }))
      );
      return;
    }
    options.patchGameStateRef((current) =>
      updateEditorPanel(current, (value) => ({
        ...value,
        status: 'saving',
        error: undefined,
      }))
    );
    try {
      const saved = await options.api.writeSessionFile(
        activeSession.sessionId,
        editor.currentPath,
        editor.content,
        options.participantId
      );
      options.patchGameStateRef((current) =>
        updateEditorPanel(current, (value) => ({
          ...value,
          currentPath: saved.path,
          savedContent: value.content,
          dirty: false,
          status: 'ready',
          error: undefined,
        }))
      );
      const replayId = options.sessionRef.current?.replayId;
      const emitter = options.eventEmitterRef.current;
      if (replayId && emitter) {
        void emitter.emit({
          replayId,
          type: 'file_saved',
          at: options.currentGameTimeMs(),
          payload: {path: saved.path, byteLength: saved.byteLength},
        });
      }
    } catch (error) {
      options.patchGameStateRef((current) =>
        updateEditorPanel(current, (value) => ({
          ...value,
          status: 'error',
          error: toErrorMessage(error),
        }))
      );
    }
  }

  return {
    editorTextareaRef,
    loadEditorFiles,
    openEditorFile,
    saveEditorFile,
  };
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
