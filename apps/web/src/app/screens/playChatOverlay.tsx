import {useEffect} from 'preact/hooks';
import type {GameRenderState} from '@incident/shared';
import {
  activateChatCompose,
  deactivateChatCompose,
  setChatDraft,
} from '../../game/state/gameState.js';
import {
  chatComposeRegion,
  type MonitorId,
  type RightPanelTab,
} from '../../game/render/canvasLayout.js';

type PatchGameState = (
  updater: (state: GameRenderState) => GameRenderState,
  options?: {render?: boolean; collectTransitions?: boolean}
) => void;

// HTML-in-Canvas 非対応環境で chatCompose がアクティブな間だけ、canvas 上に
// 実 DOM の <input> を重ねて表示する(ChatOverlayInput)。日本語 IME は実 DOM
// のフォーカスがないと機能しないため、canvas 疑似入力(useTerminalBridge の
// pseudo-input)ではなくこちらに一本化する。マウント時に自動でフォーカスし、
// 非アクティブ化(送信・Escape・他クリック)でアンマウントされたタイミングで
// canvas にフォーカスを戻し、ターミナル操作を継続できるようにする。
export function useChatOverlayFocus(
  overlayChatActive: boolean,
  chatInputRef: {current: HTMLInputElement | null},
  canvasRef: {current: HTMLCanvasElement | null}
) {
  useEffect(() => {
    if (!overlayChatActive) return;
    chatInputRef.current?.focus();
    return () => {
      canvasRef.current?.focus();
    };
  }, [overlayChatActive]);
}

// HTML-in-Canvas 対応時のみ、canvas 内チャット欄を本物の <input> に置き換える
// (IME・テキスト選択・スクリーンリーダー対応)。非対応時は子を描画せず、従来の
// canvas 自前描画へフォールバックする。
export function EmbeddedChatInput(props: {
  visible: boolean;
  chatInputRef: {current: HTMLInputElement | null};
  gameState: GameRenderState | undefined;
  patchGameStateRef: PatchGameState;
  onChatSubmit: () => void;
}) {
  if (!props.visible) return null;
  return (
    <input
      ref={props.chatInputRef}
      class='canvas-embedded-chat-input'
      aria-label='チャットメッセージ'
      maxLength={500}
      value={props.gameState?.chatCompose.draft ?? ''}
      onInput={(event) => {
        const {value} = event.currentTarget;
        props.patchGameStateRef((current) => setChatDraft(current, value));
      }}
      onFocus={() => {
        props.patchGameStateRef((current) => activateChatCompose(current));
      }}
      onBlur={() => {
        props.patchGameStateRef((current) => deactivateChatCompose(current));
      }}
      onKeyDown={(event) => {
        // IME変換確定のEnterは送信しない。
        if (event.key === 'Enter' && !event.isComposing) {
          event.preventDefault();
          props.onChatSubmit();
        }
      }}
    />
  );
}

// HTML-in-Canvas 非対応環境向けのチャット入力オーバーレイ。canvas の外
// (canvas-stage の兄弟要素)に position: fixed で置き、chatCompose の矩形
// (chatComposeRegion)にスケーリングして重ねる。canvas の子要素は
// HTML-in-Canvas 非対応環境では実 DOM として操作できないため、editor-overlay
// と同じ手法(getBoundingClientRect + スケール)を使う。draft は
// state.chatCompose.draft と onInput で同期し続け、canvas 側の
// drawChatCompose もそのまま描き続ける(録画にテキストが残る)。オーバーレイ
// が不透明背景で上に被さるため二重表示は起きない。
export function ChatOverlayInput(props: {
  active: boolean;
  gameState: GameRenderState | undefined;
  chatInputRef: {current: HTMLInputElement | null};
  canvasRef: {current: HTMLCanvasElement | null};
  patchGameStateRef: PatchGameState;
  onChatSubmit: () => void;
}) {
  const gameState = props.gameState;
  if (!props.active || !gameState) return null;
  return (
    <input
      ref={props.chatInputRef}
      class='canvas-chat-overlay-input'
      aria-label='チャットメッセージ'
      maxLength={500}
      style={chatComposeOverlayStyle(
        props.canvasRef.current,
        gameState.monitors.right.activePanelTab,
        gameState.world.expandedMonitor
      )}
      value={gameState.chatCompose.draft}
      onInput={(event) => {
        const {value} = event.currentTarget;
        props.patchGameStateRef((current) => setChatDraft(current, value));
      }}
      onFocus={() => {
        props.patchGameStateRef((current) => activateChatCompose(current));
      }}
      onBlur={() => {
        props.patchGameStateRef((current) => deactivateChatCompose(current));
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          props.patchGameStateRef((current) => deactivateChatCompose(current));
          return;
        }
        // IME変換確定のEnterは送信しない。
        if (event.key === 'Enter' && !event.isComposing) {
          event.preventDefault();
          props.onChatSubmit();
        }
      }}
    />
  );
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
