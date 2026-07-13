import {useEffect} from 'preact/hooks';
import type {ExerciseSnapshot, GameRenderState} from '@incident/shared';
import type {ApiClientSurface} from '../api/client.js';
import {
  parseAppendLogArgs,
  parseCreateTaskArgs,
  parseFireInjectArgs,
  summarizeIncidentState,
  WEBMCP_TOOL_DEFS,
} from '../pure/webmcpTools.js';
import {isWebMcpSupported, registerWebMcpTools} from '../effect/webmcp.js';
import type {Screen} from './appTypes.js';

export function useWebMcpTools(input: {
  api: ApiClientSurface;
  screen: Screen;
  session: {sessionId: string} | undefined;
  participantId: string;
  gameStateRef: {current: GameRenderState | undefined};
  setExerciseSnapshot: (exercise: ExerciseSnapshot) => void;
}) {
  const {api, screen, session, participantId, gameStateRef} = input;
  const setExerciseSnapshot = input.setExerciseSnapshot;
  const sessionId = session?.sessionId;

  useEffect(() => {
    if (screen !== 'play' || !sessionId || !isWebMcpSupported()) return;
    const controller = new AbortController();

    void registerWebMcpTools(
      [
        {
          ...WEBMCP_TOOL_DEFS.overview,
          execute: () =>
            Promise.resolve(
              JSON.stringify(
                summarizeIncidentState(gameStateRef.current) ?? {
                  error: 'ゲーム状態をまだ取得できていません',
                }
              )
            ),
        },
        {
          ...WEBMCP_TOOL_DEFS.createTask,
          async execute(args: unknown) {
            const parsed = parseCreateTaskArgs(args);
            if (!parsed) return 'エラー: title(空でない文字列)が必要です';
            const {exercise} = await api.createTask(sessionId, {
              title: parsed.title,
              actorParticipantId: participantId,
            });
            setExerciseSnapshot(exercise);
            return `タスクを追加しました: ${parsed.title}`;
          },
        },
        {
          ...WEBMCP_TOOL_DEFS.appendLog,
          async execute(args: unknown) {
            const parsed = parseAppendLogArgs(args);
            if (!parsed) return 'エラー: body(空でない文字列)が必要です';
            const {exercise} = await api.appendIncidentLog(sessionId, {
              body: parsed.body,
              kind: parsed.kind,
              actorParticipantId: participantId,
            });
            setExerciseSnapshot(exercise);
            return `インシデントログに記録しました (${parsed.kind})`;
          },
        },
        {
          ...WEBMCP_TOOL_DEFS.fireInject,
          async execute(args: unknown) {
            const parsed = parseFireInjectArgs(args);
            if (!parsed) return 'エラー: injectId(文字列)が必要です';
            const {exercise} = await api.fireInject(
              sessionId,
              parsed.injectId,
              {actorParticipantId: participantId, participantId}
            );
            setExerciseSnapshot(exercise);
            return `インジェクトを発火しました: ${parsed.injectId}`;
          },
        },
      ].map((tool) => ({
        ...tool,
        execute: (args: unknown) =>
          tool.execute(args).catch((error: unknown) => {
            console.error(error);
            return `エラー: ツールの実行に失敗しました (${tool.name})`;
          }),
      })),
      controller.signal
    );

    return () => {
      controller.abort();
    };
  }, [screen, sessionId, participantId]);
}
