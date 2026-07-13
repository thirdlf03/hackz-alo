import type {Difficulty} from '@incident/shared';
import type {ScenarioSummary} from '../appTypes.js';
import {ModelDownloadButton} from '../ModelDownloadButton.js';

export const difficultyOptions: Array<{
  difficulty: Difficulty;
  label: string;
  tone: string;
  summary: string;
  warning?: string;
}> = [
  {
    difficulty: 'beginner',
    label: '初級',
    tone: 'green',
    summary: '丁寧な誘導つきで、基本動作をひとつずつ学ぶ初動訓練',
  },
  {
    difficulty: 'intermediate',
    label: '中級',
    tone: 'amber',
    summary: '原因候補を絞り込みながら復旧まで進める訓練',
  },
  {
    difficulty: 'advanced',
    label: '上級',
    tone: 'red',
    summary: '少ない手掛かりから仮説を立てて完走する訓練',
    warning: '※仮眠不可',
  },
];

export function SelectScreen(props: {
  scenarios: ScenarioSummary[];
  isStarting: boolean;
  onSelectDifficulty: (difficulty: Difficulty) => void;
}) {
  return (
    <section class='select-screen'>
      <div class='select-header'>
        <p class='eyebrow'>INCIDENT DRILL</p>
        <h1>今夜のシフトを選ぶ</h1>
        <p>
          電話が鳴る前に、監視とログの読み方を体に入れておこう。難易度ごとにシナリオを選んで訓練開始。
        </p>
      </div>
      <div class='difficulty-grid'>
        {difficultyOptions.map((option, index) => {
          const level = index + 1;
          const count = props.scenarios.filter(
            (item) => item.difficulty === option.difficulty
          ).length;
          const disabled = count === 0 || props.isStarting;
          return (
            <button
              key={option.difficulty}
              class={`difficulty-card ${option.tone}`}
              type='button'
              disabled={disabled}
              aria-label={`${option.label}、${String(count)} シナリオ。${option.summary}${option.warning ?? ''}${disabled ? '（シナリオなし）' : ''}`}
              title={
                disabled ? 'この難易度にはシナリオがありません' : undefined
              }
              onClick={() => {
                props.onSelectDifficulty(option.difficulty);
              }}
            >
              <span class='difficulty-card-top'>
                <span class='difficulty-label'>
                  LEVEL {level} ── {option.label}
                </span>
                <span class='difficulty-level-dots' aria-hidden='true'>
                  {[0, 1, 2].map((dot) => (
                    <span key={dot} class={dot < level ? 'lit' : ''} />
                  ))}
                </span>
              </span>
              <strong>{count} シナリオ</strong>
              <small>
                {option.summary}
                {option.warning && (
                  <span class='difficulty-warn'> {option.warning}</span>
                )}
              </small>
              <span class='difficulty-cta'>▸ PRESS START</span>
            </button>
          );
        })}
      </div>
      <ModelDownloadButton />
    </section>
  );
}
