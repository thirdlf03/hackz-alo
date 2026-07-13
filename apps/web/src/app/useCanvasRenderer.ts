import {useEffect} from 'preact/hooks';
import type {GameRenderState, ScenarioDefinition} from '@incident/shared';
import {recordCanvasDraw} from '@incident/observability/browser';
import {CanvasRenderer} from '../game/render/canvasRenderer.js';
import type {Screen} from './appTypes.js';

interface RendererHandle {
  scrollMetricsPanel(deltaY: number): void;
  setChatInput(input: HTMLInputElement | null): void;
}

export function useCanvasRenderer(options: {
  screen: Screen;
  canvasRef: {current: HTMLCanvasElement | null};
  chatInputRef?: {current: HTMLInputElement | null};
  rendererRef: {current: RendererHandle | null};
  gameStateRef: {current: GameRenderState | undefined};
  scenarioRef: {current: ScenarioDefinition | undefined};
}) {
  useEffect(() => {
    if (options.screen !== 'play' || !options.canvasRef.current) return;
    const canvas = options.canvasRef.current;
    const renderer = new CanvasRenderer(canvas);
    renderer.setChatInput(options.chatInputRef?.current ?? null);
    // HTML-in-Canvas 有効時のみ layoutsubtree を付与し、canvas 子孫(埋め込み
    // input)をレイアウト・ヒットテストに参加させる。
    if (renderer.embedsHtml) canvas.setAttribute('layoutsubtree', '');
    options.rendererRef.current = renderer;
    let frame = 0;
    let lastState: GameRenderState | undefined;
    let lastScenario: ScenarioDefinition | undefined;
    // 初回描画がウェブフォント読込前に走った場合、フォールバックフォントで
    // 焼き付いた canvas テキストを描き直すための強制再描画フラグ。
    let forceRedraw = false;
    if (typeof document !== 'undefined') {
      document.fonts.ready
        .then(() => {
          forceRedraw = true;
        })
        .catch(() => {
          // フォント読込監視に失敗しても致命的ではないため無視する。
        });
    }
    const draw = () => {
      const latest = options.gameStateRef.current;
      const scenario = options.scenarioRef.current;
      const hasRemoteCursors = Boolean(
        latest?.room.participants.some(
          (participant) =>
            participant.cursor?.visible &&
            participant.online &&
            participant.participantId !== latest.localParticipantId
        )
      );
      const animate =
        Boolean(latest?.commandInputFocused) ||
        hasRemoteCursors ||
        Boolean(scenario?.topology);
      if (
        latest &&
        (animate ||
          forceRedraw ||
          latest !== lastState ||
          scenario !== lastScenario)
      ) {
        const drawStartedAt = performance.now();
        renderer.draw(latest, scenario);
        recordCanvasDraw(performance.now() - drawStartedAt, {
          command_input_focused: latest.commandInputFocused,
        });
        forceRedraw = false;
        if (!animate) {
          lastState = latest;
          lastScenario = scenario;
        }
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(frame);
      renderer.setChatInput(null);
      canvas.removeAttribute('layoutsubtree');
      options.rendererRef.current = null;
    };
  }, [options.screen]);
}
