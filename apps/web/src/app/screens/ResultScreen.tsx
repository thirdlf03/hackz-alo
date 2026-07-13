import type {ScenarioDefinition} from '@incident/shared';
import {ResultPage} from '../../pages/ResultPage.js';

export function ResultScreen(props: {
  replayId: string;
  sessionId: string;
  scenario: ScenarioDefinition;
  canOpenReplay: boolean;
  isRetrying: boolean;
  onGoHome: () => void;
  onRetry: () => void;
  onOpenReplay: () => void;
  onOpenHotwash: () => void;
}) {
  return (
    <ResultPage
      replayId={props.replayId}
      sessionId={props.sessionId}
      scenarioTitle={props.scenario.title}
      canOpenReplay={props.canOpenReplay}
      onGoHome={props.onGoHome}
      onRetry={props.onRetry}
      onOpenReplay={props.onOpenReplay}
      onOpenHotwash={props.onOpenHotwash}
      isRetrying={props.isRetrying}
    />
  );
}
