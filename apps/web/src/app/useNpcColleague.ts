import {useEffect, useRef, useState} from 'preact/hooks';
import type {GameRenderState} from '@incident/shared';
import type {AssistAvailability} from '../pure/aiAssist.js';
import {
  appendRecentSay,
  buildNpcReplyPrompt,
  filterNpcReply,
  NPC_NAME,
  NPC_RESPONSE_SCHEMA,
  parseNpcReply,
  type NpcReply,
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

/** プレイヤーの新規チャット発言がないか確認する間隔。 */
const NPC_MESSAGE_CHECK_INTERVAL_MS = 2_000;

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
 * プレイヤーの新規チャット発言を検知すると summarizeIncidentState() の状況JSONと
 * ともに Prompt API に渡し、JSON Schema 制約付き出力 {say, suggestTask} を
 * 受け取ってチャット発言とタスク提案に反映する。
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
  // 有効/無効を切り替えるトグルUI(旧 NpcColleaguePanel)は 7fec895a で撤去され
  // 現時点で再建していないため、availability が使える間はデフォルトで有効にする。
  const [enabled, setEnabled] = useState(true);
  const [thinking, setThinking] = useState(false);
  const [suggestedTask, setSuggestedTask] = useState<string>();
  const sessionRef = useRef<NpcSession | null>(null);
  const recentSaysRef = useRef<string[]>([]);
  const busyRef = useRef(false);
  /** 応答済み・応答不要と判定済みのプレイヤーチャットメッセージ id。 */
  const processedMentionIdsRef = useRef<Set<string>>(new Set());
  /** 応答生成中に届いた最新のメンション。生成完了後にこれだけ処理する。 */
  const pendingMentionRef = useRef<{id: string; body: string} | undefined>(
    undefined
  );

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
    // モデル未DL(downloadable)・DL中(downloading)ではセッションを生成しない。
    // 事前DLはホーム画面の ModelDownloadButton の明示クリックで行う設計であり、
    // ここで自動的に約22GBのモデルダウンロードを開始してはならない。
    if (options.screen !== 'play' || !enabled || availability !== 'available') {
      return;
    }

    let cancelled = false;
    const isCancelled = () => cancelled;

    // play 画面に入った時点までのチャット履歴は応答対象にしない。
    processedMentionIdsRef.current = new Set(
      (options.gameStateRef.current?.playerChatMessages ?? []).map(
        (message) => message.id
      )
    );
    pendingMentionRef.current = undefined;

    const deliverReply = (reply: NpcReply) => {
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
    };

    const ensureSession = async () => {
      if (!sessionRef.current) {
        sessionRef.current = await createNpcSession();
        setAvailability('available');
      }
      return sessionRef.current;
    };

    const respondToMention = async (mention: {
      id: string;
      body: string;
    }): Promise<void> => {
      if (isCancelled() || busyRef.current) return;
      const state = options.gameStateRef.current;
      const overview = summarizeIncidentState(state);
      if (!state || !overview || state.session.status !== 'running') return;
      busyRef.current = true;
      setThinking(true);
      try {
        const session = await ensureSession();
        const raw = await promptNpc(
          session,
          buildNpcReplyPrompt(overview, mention.body, recentSaysRef.current),
          NPC_RESPONSE_SCHEMA
        );
        if (isCancelled()) return;
        const parsed = parseNpcReply(raw);
        if (parsed) {
          const reply = filterNpcReply(
            parsed,
            recentSaysRef.current,
            (options.gameStateRef.current?.room.tasks ?? []).map(
              (task) => task.title
            )
          );
          if (reply) deliverReply(reply);
        }
      } catch (error) {
        console.error('npc colleague reply error', error);
      } finally {
        busyRef.current = false;
        if (!isCancelled()) setThinking(false);
        drainPendingMention();
      }
    };

    /** busy解除時に、その間に届いていた保留メンションを1件処理する。 */
    const drainPendingMention = () => {
      const pending = pendingMentionRef.current;
      if (pending) {
        pendingMentionRef.current = undefined;
        void respondToMention(pending);
      }
    };

    const checkNewPlayerMessages = () => {
      if (isCancelled()) return;
      const messages = options.gameStateRef.current?.playerChatMessages ?? [];
      let latest: {id: string; body: string} | undefined;
      for (const message of messages) {
        if (processedMentionIdsRef.current.has(message.id)) continue;
        processedMentionIdsRef.current.add(message.id);
        if (message.from === NPC_NAME) continue;
        latest = {id: message.id, body: message.body};
      }
      if (!latest) return;
      if (busyRef.current) {
        pendingMentionRef.current = latest;
        return;
      }
      void respondToMention(latest);
    };

    const mentionInterval = window.setInterval(() => {
      checkNewPlayerMessages();
    }, NPC_MESSAGE_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(mentionInterval);
    };
  }, [options.screen, enabled, availability, options.session?.sessionId]);

  // play 画面を離れたらセッションを破棄して提案もリセットする
  useEffect(() => {
    if (options.screen === 'play') return;
    sessionRef.current?.destroy();
    sessionRef.current = null;
    recentSaysRef.current = [];
    processedMentionIdsRef.current = new Set();
    pendingMentionRef.current = undefined;
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
