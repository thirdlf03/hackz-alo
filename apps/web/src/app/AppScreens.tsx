import type {
  Difficulty,
  GameRenderState,
  ScenarioDefinition,
} from '@incident/shared';
import {setCenterTool, updateEditorPanel} from '../game/state/gameState.js';
import {centerEditorOverlayRegion} from '../game/render/canvasLayout.js';
import {ReplayPage} from '../pages/ReplayPage.js';
import {ResultPage} from '../pages/ResultPage.js';
import {
  formatDifficulty,
  speedOptions,
  TUTORIAL_SCENARIO_ID,
  type Screen,
  type ScenarioSummary,
} from './appTypes.js';

export type {FinishMode, ScenarioSummary, Screen} from './appTypes.js';

type PatchGameState = (
  updater: (state: GameRenderState) => GameRenderState,
  options?: {render?: boolean; collectTransitions?: boolean}
) => void;

const difficultyOptions: Array<{
  difficulty: Difficulty;
  label: string;
  tone: string;
  summary: string;
}> = [
  {
    difficulty: 'beginner',
    label: '初級',
    tone: 'green',
    summary: '監視とログを順番に追う短い初動訓練',
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
  },
];

export function TopBar(props: {
  screen: Screen;
  isStarting: boolean;
  gameSpeed: number;
  canNavigateToReplay: boolean;
  onSetScreen: (screen: Screen) => void;
  onSetGameSpeed: (speed: number) => void;
  onOpenReplay: () => void;
}) {
  const navigationDisabled = props.screen === 'play' || props.isStarting;
  return (
    <header class='topbar'>
      <strong
        class='topbar-brand'
        role='link'
        tabIndex={navigationDisabled ? -1 : 0}
        aria-label='ホーム（難易度選択）に戻る'
        aria-disabled={navigationDisabled}
        onClick={() => {
          if (navigationDisabled) return;
          props.onSetScreen('select');
        }}
        onKeyDown={(event) => {
          if (navigationDisabled) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            props.onSetScreen('select');
          }
        }}
      >
        障害対応訓練
      </strong>
      <div class='speed-control' role='group' aria-label='ゲーム速度'>
        {speedOptions.map((speed) => (
          <button
            key={speed}
            type='button'
            class={speed === props.gameSpeed ? 'active' : ''}
            aria-pressed={speed === props.gameSpeed}
            onClick={() => {
              props.onSetGameSpeed(speed);
            }}
          >
            {speed}x
          </button>
        ))}
      </div>
      <div class='topbar-actions'>
        <button
          type='button'
          aria-label='シナリオ選択に戻る'
          onClick={() => {
            props.onSetScreen('select');
          }}
          disabled={navigationDisabled}
        >
          Scenario
        </button>
        {props.canNavigateToReplay && (
          <button
            type='button'
            aria-label='リプレイ詳細を開く'
            onClick={props.onOpenReplay}
          >
            Replay
          </button>
        )}
      </div>
    </header>
  );
}

export function SelectScreen(props: {
  scenarios: ScenarioSummary[];
  isStarting: boolean;
  onSelectDifficulty: (difficulty: Difficulty) => void;
}) {
  return (
    <section class='select-screen'>
      <div class='select-header'>
        <p class='eyebrow'>Incident Drill</p>
        <h1>難易度を選ぶ</h1>
        <p>難易度ごとにシナリオを選んで訓練を開始します。</p>
      </div>
      <div class='difficulty-grid'>
        {difficultyOptions.map((option) => {
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
              aria-label={`${option.label}、${String(count)} シナリオ。${option.summary}${disabled ? '（シナリオなし）' : ''}`}
              title={
                disabled ? 'この難易度にはシナリオがありません' : undefined
              }
              onClick={() => {
                props.onSelectDifficulty(option.difficulty);
              }}
            >
              <span class='difficulty-label'>{option.label}</span>
              <strong>{count} シナリオ</strong>
              <small>{option.summary}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function ScenarioListScreen(props: {
  selectedDifficulty: Difficulty;
  scenarios: ScenarioSummary[];
  isStarting: boolean;
  onBack: () => void;
  onStartScenario: (scenarioId: string) => void;
}) {
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
        ← 戻る
      </button>
      <h1 id='scenario-list-heading'>
        {formatDifficulty(props.selectedDifficulty)}シナリオ
      </h1>
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
            <span class='scenario-card-main'>
              <strong>{item.title}</strong>
              {item.id === TUTORIAL_SCENARIO_ID && (
                <span class='tutorial-badge'>チュートリアル</span>
              )}
            </span>
            <span>{item.timeLimitMinutes}分</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function BriefingScreen(props: {
  scenario: ScenarioDefinition;
  isStarting: boolean;
  recordingConsent: boolean;
  saveRecording: boolean;
  onBack: () => void;
  onSetRecordingConsent: (value: boolean) => void;
  onSetSaveRecording: (value: boolean) => void;
  onStartPlay: () => void;
}) {
  return (
    <section class='panel briefing-panel' aria-labelledby='briefing-heading'>
      <button
        type='button'
        class='panel-back-button'
        aria-label='シナリオ選択に戻る'
        disabled={props.isStarting}
        onClick={props.onBack}
      >
        ← 戻る
      </button>
      <h1 id='briefing-heading'>{props.scenario.title}</h1>
      <ul>
        {props.scenario.briefing.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <fieldset>
        <legend>録画設定</legend>
        <label class='consent-row'>
          <input
            type='checkbox'
            checked={props.recordingConsent}
            onChange={(event) => {
              props.onSetRecordingConsent(event.currentTarget.checked);
            }}
          />
          ゲーム画面（canvas 内のみ）を録画し、振り返りに使うことに同意する
        </label>
        <label class='consent-row'>
          <input
            type='checkbox'
            checked={props.saveRecording}
            disabled={!props.recordingConsent}
            onChange={(event) => {
              props.onSetSaveRecording(event.currentTarget.checked);
            }}
          />
          録画データをサーバーに保存する（オフにするとイベントログのみ残ります）
        </label>
      </fieldset>
      <p id='briefing-consent-note'>
        ブラウザ全体や別タブは録画されません。公開するかどうかは後から選べます。
      </p>
      <button
        type='button'
        onClick={props.onStartPlay}
        disabled={props.isStarting || !props.recordingConsent}
        aria-describedby='briefing-consent-note'
      >
        {props.isStarting ? '開始中…' : '開始'}
      </button>
    </section>
  );
}

export function PlayScreen(props: {
  gameState: GameRenderState | undefined;
  canvasRef: {current: HTMLCanvasElement | null};
  editorTextareaRef: {current: HTMLTextAreaElement | null};
  patchGameStateRef: PatchGameState;
  onSaveEditorFile: () => void;
  onCanvasClick: (event: MouseEvent) => void;
  onCanvasMove: (event: MouseEvent) => void;
  onCanvasWheel: (event: WheelEvent) => void;
  onTerminalKey: (event: KeyboardEvent) => void;
  onCanvasPaste: (event: ClipboardEvent) => void;
}) {
  return (
    <section class='game-layout'>
      {props.gameState?.monitors.center.activeTool === 'editor' && (
        <textarea
          ref={props.editorTextareaRef}
          class='editor-overlay'
          style={editorOverlayStyle(
            props.canvasRef.current,
            props.gameState.world.expandedMonitor === 'terminal'
          )}
          value={props.gameState.monitors.center.editor.content}
          aria-label={`${props.gameState.monitors.center.editor.currentPath ?? 'ファイル'} を編集`}
          spellcheck={false}
          disabled={
            props.gameState.monitors.center.editor.status === 'loading' ||
            props.gameState.monitors.center.editor.status === 'saving'
          }
          onInput={(event) => {
            const target = event.currentTarget;
            const cursor = editorCursorFromTextarea(target);
            props.patchGameStateRef((current) =>
              updateEditorPanel(current, (editor) => ({
                ...editor,
                content: target.value,
                dirty: target.value !== editor.savedContent,
                status: editor.status === 'error' ? 'ready' : editor.status,
                cursor,
              }))
            );
          }}
          onSelect={(event) => {
            const target = event.currentTarget;
            const cursor = editorCursorFromTextarea(target);
            props.patchGameStateRef(
              (current) =>
                updateEditorPanel(current, (editor) => ({
                  ...editor,
                  cursor,
                })),
              {collectTransitions: false}
            );
          }}
          onKeyDown={(event) => {
            if (
              (event.metaKey || event.ctrlKey) &&
              event.key.toLowerCase() === 's'
            ) {
              event.preventDefault();
              props.onSaveEditorFile();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              props.patchGameStateRef((current) =>
                setCenterTool(current, 'terminal')
              );
            }
          }}
        />
      )}
      <canvas
        ref={props.canvasRef}
        width='1920'
        height='1080'
        aria-label='録画対象のゲーム画面。ターミナル入力はキーボードで操作できます。'
        aria-describedby='canvas-play-hint'
        tabIndex={0}
        onClick={props.onCanvasClick}
        onMouseMove={props.onCanvasMove}
        onWheel={props.onCanvasWheel}
        onKeyDown={props.onTerminalKey}
        onPaste={props.onCanvasPaste}
      />
      <p id='canvas-play-hint' class='visually-hidden'>
        ターミナルにフォーカスしてキーボードでコマンドを入力できます。画面上のボタンはマウスで操作します。
      </p>
    </section>
  );
}

export function ResultScreen(props: {
  replayId: string;
  sessionId: string;
  scenario: ScenarioDefinition;
  canOpenReplay: boolean;
  isRetrying: boolean;
  onGoHome: () => void;
  onRetry: () => void;
  onOpenReplay: () => void;
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
      isRetrying={props.isRetrying}
    />
  );
}

export function ReplayScreen(props: {
  replayId: string;
  deepLinkValidated: boolean;
  timeline: Array<{at: number; label: string}>;
}) {
  if (!props.deepLinkValidated) {
    return (
      <section class='panel' aria-busy='true'>
        <p role='status'>リプレイを読み込み中…</p>
      </section>
    );
  }
  return <ReplayPage replayId={props.replayId} timeline={props.timeline} />;
}

function editorOverlayStyle(
  canvas: HTMLCanvasElement | null,
  expanded: boolean
) {
  if (!canvas) return {display: 'none'};
  const rect = canvas.getBoundingClientRect();
  const region = centerEditorOverlayRegion(expanded);
  const scaleX = rect.width / 1920;
  const scaleY = rect.height / 1080;
  return {
    left: `${String(rect.left + region.x * scaleX)}px`,
    top: `${String(rect.top + region.y * scaleY)}px`,
    width: `${String(region.width * scaleX)}px`,
    height: `${String(region.height * scaleY)}px`,
  };
}

function editorCursorFromTextarea(textarea: HTMLTextAreaElement) {
  const before = textarea.value.slice(0, textarea.selectionStart);
  const lines = before.split('\n');
  return {
    line: lines.length,
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
  };
}
