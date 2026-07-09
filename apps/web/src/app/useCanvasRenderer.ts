import {useEffect} from 'preact/hooks';
import type {GameRenderState, ScenarioDefinition} from '@incident/shared';
import {recordCanvasDraw} from '@incident/observability/browser';
import {CanvasRenderer} from '../game/render/canvasRenderer.js';
import type {Screen} from './appTypes.js';

interface RendererHandle {
  scrollMetricsPanel(deltaY: number): void;
}

export function useCanvasRenderer(options: {
  screen: Screen;
  canvasRef: {current: HTMLCanvasElement | null};
  rendererRef: {current: RendererHandle | null};
  gameStateRef: {current: GameRenderState | undefined};
  scenarioRef: {current: ScenarioDefinition | undefined};
}) {
  useEffect(() => {
    if (options.screen !== 'play' || !options.canvasRef.current) return;
    const renderer = new CanvasRenderer(options.canvasRef.current);
    options.rendererRef.current = renderer;
    let frame = 0;
    let lastState: GameRenderState | undefined;
    let lastScenario: ScenarioDefinition | undefined;
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
        (animate || latest !== lastState || scenario !== lastScenario)
      ) {
        const drawStartedAt = performance.now();
        renderer.draw(latest, scenario);
        recordCanvasDraw(performance.now() - drawStartedAt, {
          command_input_focused: latest.commandInputFocused,
        });
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
      options.rendererRef.current = null;
    };
  }, [options.screen]);
}
