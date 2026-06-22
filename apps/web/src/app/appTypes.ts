import type {Difficulty, ScenarioDefinition} from '@incident/shared';

export type Screen =
  | 'select'
  | 'scenario-list'
  | 'briefing'
  | 'play'
  | 'result'
  | 'replay';

export type ScenarioSummary = Pick<
  ScenarioDefinition,
  'id' | 'title' | 'difficulty' | 'timeLimitMinutes'
>;

export type FinishMode = 'resolve' | 'retire' | 'timeout';

export const TUTORIAL_SCENARIO_ID = 'process-stop-001';

export const speedOptions = [0.5, 1, 1.5, 2, 4, 8] as const;

export function formatDifficulty(difficulty: Difficulty) {
  if (difficulty === 'beginner') return '初級';
  if (difficulty === 'intermediate') return '中級';
  return '上級';
}
