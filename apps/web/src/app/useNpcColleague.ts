import {useEffect, useRef, useState} from 'preact/hooks';
import type {GameRenderState} from '@incident/shared';
import type {AssistAvailability} from '../pure/aiAssist.js';
import {
  appendRecentSay,
  buildNpcUserPrompt,
  filterNpcReply,
  NPC_NAME,
  NPC_OBSERVE_INTERVAL_MS,
  NPC_RESPONSE_SCHEMA,
  parseNpcReply,
} from '../pure/npcColleague.js';
import {summarizeIncidentState} from '../pure/webmcpTools.js';
import {appendNpcChatMessage} from '../game/state/gameState.js';
import {
  checkNpcAvailability,
  createNpcSession,
  promptNpc,
  type NpcSession,
} from '../effect/npcPrompt.js';
import type {ReplayEventEmitter} from '../game/events/emitReplayEvent.js';
import type {Screen} from './appTypes.js';

export interface NpcColleagueControls {
  availability: AssistAvailability | undefined;
  enabled: boolean;
  setEnabled(value: boolean): void;
  thinking: boolean;
  /** 後輩からの未処理のタスク提案(取捨選択はプレイヤーに委ねる)。 */
  suggestedTask: string | undefined;
  dismissSuggestedTask(): void;
}

/**
 * ゲーム内チャットに常駐する AI NPC「後輩ソラ」。
 * 一定間隔で summarizeIncidentState() の状況JSONを Prompt API に渡し、
 * JSON Schema 制約付き出力 {say, suggestTask} を受け取って
 * チャット発言とタスク提案に反映する。
 */
export function useNpcColleague(options: {
  screen: Screen;
  session: {sessionId: string; replayId: string} | undefined;
  gameStateRef: {current: GameRenderState | undefined};
  eventEmitterRef: {current: ReplayEventEmitter | null};
  patchGameStateRef: (
    updater: (state: GameRenderState) => GameRenderState,
    patchOptions?: {render?: boolean; collectTransitions?: boolean}
  ) => void;
  currentGameTimeMs: () => number;
}): NpcColleagueControls {
  const [availability, setAvailability] = useState<AssistAvailability>();
  const [enabled, setEnabled] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [suggestedTask, setSuggestedTask] = useState<string>();
  const sessionRef = useRef<NpcSession | null>(null);
  const recentSaysRef = useRef<string[]>([]);
  const busyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void checkNpcAvailability().then((state) => {
      if (!cancelled) setAvailability(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (
      options.screen !== 'play' ||
      !enabled ||
      availability === undefined ||
      availability === 'unsupported' ||
      availability === 'unavailable'
    ) {
      return;
    }

    let cancelled = false;
    const isCancelled = () => cancelled;

    const observe = async () => {
      if (isCancelled() || busyRef.current) return;
      const state = options.gameStateRef.current;
      const overview = summarizeIncidentState(state);
      if (!state || !overview || state.session.status !== 'running') return;
      busyRef.current = true;
      setThinking(true);
      try {
        if (!sessionRef.current) {
          sessionRef.current = await createNpcSession();
          setAvailability('available');
        }
        const raw = await promptNpc(
          sessionRef.current,
          buildNpcUserPrompt(overview, recentSaysRef.current),
          NPC_RESPONSE_SCHEMA
        );
        if (isCancelled()) return;
        const parsed = parseNpcReply(raw);
        if (!parsed) return;
        const reply = filterNpcReply(
          parsed,
          recentSaysRef.current,
          (options.gameStateRef.current?.room.tasks ?? []).map(
            (task) => task.title
          )
        );
        if (!reply) return;
        const atMs = options.currentGameTimeMs();
        if (reply.say) {
          const say = reply.say;
          recentSaysRef.current = appendRecentSay(recentSaysRef.current, say);
          options.patchGameStateRef((current) =>
            appendNpcChatMessage(current, say, atMs, NPC_NAME)
          );
          const replayId = options.session?.replayId;
          if (replayId && options.eventEmitterRef.current) {
            void options.eventEmitterRef.current.emit({
              replayId,
              type: 'player_note',
              at: atMs,
              payload: {body: say, channel: 'npc_chat', from: NPC_NAME},
            });
          }
        }
        if (reply.suggestTask) setSuggestedTask(reply.suggestTask);
      } catch (error) {
        console.error('npc colleague error', error);
      } finally {
        busyRef.current = false;
        if (!isCancelled()) setThinking(false);
      }
    };

    const initialDelay = window.setTimeout(() => {
      void observe();
    }, 8_000);
    const interval = window.setInterval(() => {
      void observe();
    }, NPC_OBSERVE_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(initialDelay);
      window.clearInterval(interval);
    };
  }, [options.screen, enabled, availability, options.session?.sessionId]);

  // play 画面を離れたらセッションを破棄して提案もリセットする
  useEffect(() => {
    if (options.screen === 'play') return;
    sessionRef.current?.destroy();
    sessionRef.current = null;
    recentSaysRef.current = [];
    setSuggestedTask(undefined);
  }, [options.screen]);

  return {
    availability,
    enabled,
    setEnabled,
    thinking,
    suggestedTask,
    dismissSuggestedTask: () => {
      setSuggestedTask(undefined);
    },
  };
}
