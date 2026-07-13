import type {Difficulty} from '@incident/shared';
import {
  formatDifficulty,
  TUTORIAL_SCENARIO_ID,
  type ScenarioSummary,
} from '../appTypes.js';
import {difficultyOptions} from './SelectScreen.js';

export function ScenarioListScreen(props: {
  selectedDifficulty: Difficulty;
  scenarios: ScenarioSummary[];
  isStarting: boolean;
  onBack: () => void;
  onStartScenario: (scenarioId: string) => void;
}) {
  const level =
    difficultyOptions.findIndex(
      (option) => option.difficulty === props.selectedDifficulty
    ) + 1;
  return (
    <section
      class='panel scenario-list-panel'
      aria-labelledby='scenario-list-heading'
    >
      <button
        type='button'
        class='panel-back-button'
        aria-label='難易度選択に戻る'
        onClick={props.onBack}
      >
        ← 難易度選択に戻る
      </button>
      <div class='scenario-list-heading-row'>
        <h1 id='scenario-list-heading'>
          {formatDifficulty(props.selectedDifficulty)}シナリオ
        </h1>
        <span class='scenario-list-meta'>
          LEVEL {level} / 全{props.scenarios.length}件
        </span>
      </div>
      <p class='scenario-list-lead'>
        どれも実際に起きた夜がモデル。選ぶと環境の準備が始まる。
      </p>
      <div class='scenario-list'>
        {props.scenarios.map((item) => (
          <button
            key={item.id}
            type='button'
            class='scenario-card'
            disabled={props.isStarting}
            onClick={() => {
              props.onStartScenario(item.id);
            }}
          >
            <span class='scenario-card-marker' aria-hidden='true'>
              {item.id === TUTORIAL_SCENARIO_ID ? '►' : ''}
            </span>
            <span class='scenario-card-main'>
              <strong>{item.title}</strong>
              {item.id === TUTORIAL_SCENARIO_ID && (
                <span class='tutorial-badge'>チュートリアル</span>
              )}
            </span>
            <span class='scenario-card-time'>{item.timeLimitMinutes}分</span>
          </button>
        ))}
      </div>
    </section>
  );
}
