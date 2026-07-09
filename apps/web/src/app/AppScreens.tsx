import {useState} from 'preact/hooks';
import type {
  AfterActionReport,
  Difficulty,
  ExerciseSnapshot,
  GameRenderState,
  ParticipantRole,
  ScenarioDefinition,
} from '@incident/shared';
import {setCenterTool, updateEditorPanel} from '../game/state/gameState.js';
import {centerEditorOverlayRegion} from '../game/render/canvasLayout.js';
import {formatTime} from '../pure/canvasFormat.js';
import {areParticipantsReadyToStart} from '../pure/participantsReady.js';
import {ReplayPage} from '../pages/ReplayPage.js';
import {ResultPage} from '../pages/ResultPage.js';
import {
  formatDifficulty,
  speedOptions,
  TUTORIAL_SCENARIO_ID,
  type Screen,
  type ScenarioSummary,
} from './appTypes.js';
import {PerfOverlay} from './PerfOverlay.js';

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

function GameSpeedControl(props: {
  gameSpeed: number;
  onSetGameSpeed: (speed: number) => void;
}) {
  return (
    <div
      class='speed-control play-speed-control'
      role='group'
      aria-label='ゲーム速度'
    >
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
  );
}

export function TopBar(props: {
  screen: Screen;
  isStarting: boolean;
  canNavigateToReplay: boolean;
  gameSpeed: number;
  onSetScreen: (screen: Screen) => void;
  onOpenReplay: () => void;
  onSetGameSpeed: (speed: number) => void;
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
      {props.screen === 'play' && (
        <GameSpeedControl
          gameSpeed={props.gameSpeed}
          onSetGameSpeed={props.onSetGameSpeed}
        />
      )}
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
  isHost: boolean;
  sandboxReady: boolean;
  recordingConsent: boolean;
  saveRecording: boolean;
  pagerAvailable: boolean;
  pagerRegistered: boolean;
  pagerBusy: boolean;
  onBack: () => void;
  onSetRecordingConsent: (value: boolean) => void;
  onSetSaveRecording: (value: boolean) => void;
  onRegisterPager: () => void;
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
      {props.pagerAvailable && (
        <div class='pager-row'>
          <button
            type='button'
            onClick={props.onRegisterPager}
            disabled={props.pagerBusy || props.pagerRegistered}
          >
            {props.pagerRegistered
              ? '📟 待機中'
              : props.pagerBusy
                ? '登録中…'
                : '📟 ページャー待機'}
          </button>
        </div>
      )}
      {props.isHost ? (
        <button
          type='button'
          onClick={props.onStartPlay}
          disabled={
            props.isStarting || !props.sandboxReady || !props.recordingConsent
          }
          aria-describedby='briefing-consent-note'
        >
          {props.isStarting
            ? '開始中…'
            : props.sandboxReady
              ? '開始'
              : '環境準備中…'}
        </button>
      ) : (
        <p role='status'>ホストの開始を待っています…</p>
      )}
    </section>
  );
}

const participantRoleLabels: Record<ParticipantRole, string> = {
  incident_commander: 'IC',
  ops: 'Ops',
  scribe: 'Scribe',
  comms: 'Comms',
  facilitator: 'Facilitator',
  observer: 'Observer',
};

const participantRoles = Object.keys(
  participantRoleLabels
) as ParticipantRole[];

export function LobbyScreen(props: {
  scenario: ScenarioDefinition;
  participantId: string;
  participantName: string;
  participantRole: ParticipantRole;
  exercise: ExerciseSnapshot | undefined;
  sandboxReady: boolean;
  isHost: boolean;
  inviteUrl: string | undefined;
  onSetParticipantName: (name: string) => void;
  onSetParticipantRole: (role: ParticipantRole) => void;
  onReady: () => void;
  onContinue: () => void;
}) {
  const [inviteCopied, setInviteCopied] = useState(false);
  const participants = props.exercise?.participants ?? [];
  const ready = participants.find(
    (participant) => participant.participantId === props.participantId
  )?.ready;
  const readyGateSatisfied = areParticipantsReadyToStart(participants);
  const continueDisabled = !props.sandboxReady || !readyGateSatisfied;
  const continueLabel = !props.sandboxReady
    ? '環境準備中…'
    : !readyGateSatisfied
      ? '全員の準備完了を待っています'
      : 'ブリーフィングへ';

  async function copyInviteLink() {
    if (!props.inviteUrl) return;
    try {
      await navigator.clipboard.writeText(props.inviteUrl);
      setInviteCopied(true);
    } catch {
      setInviteCopied(false);
    }
  }

  return (
    <section class='panel lobby-panel' aria-labelledby='lobby-heading'>
      <p class='eyebrow'>Exercise Room</p>
      <h1 id='lobby-heading'>{props.scenario.title}</h1>
      <div class='lobby-invite'>
        <button
          type='button'
          onClick={() => {
            void copyInviteLink();
          }}
          disabled={!props.inviteUrl}
        >
          招待リンクをコピー
        </button>
        {inviteCopied && <span role='status'>コピーしました</span>}
      </div>
      <div class='lobby-controls'>
        <label>
          表示名
          <input
            type='text'
            value={props.participantName}
            maxLength={40}
            onInput={(event) => {
              props.onSetParticipantName(event.currentTarget.value);
            }}
          />
        </label>
        <label>
          ロール
          <select
            value={props.participantRole}
            onChange={(event) => {
              props.onSetParticipantRole(
                event.currentTarget.value as ParticipantRole
              );
            }}
          >
            {participantRoles.map((role) => (
              <option key={role} value={role}>
                {participantRoleLabels[role]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div class='participant-list'>
        {participants.map((participant) => (
          <div
            key={participant.participantId}
            class={`participant-row${participant.online ? '' : ' offline'}`}
          >
            <strong>{participant.displayName}</strong>
            <span>{participantRoleLabels[participant.role]}</span>
            <span>{participant.ready ? 'Ready' : '待機中'}</span>
          </div>
        ))}
      </div>
      <div class='lobby-actions'>
        <button type='button' onClick={props.onReady} disabled={ready}>
          {ready ? 'Ready' : 'Ready'}
        </button>
        {props.isHost ? (
          <button
            type='button'
            onClick={props.onContinue}
            disabled={continueDisabled}
          >
            {continueLabel}
          </button>
        ) : (
          <p role='status'>ホストの開始を待っています</p>
        )}
      </div>
    </section>
  );
}

export function PlayScreen(props: {
  gameState: GameRenderState | undefined;
  gameSpeed: number;
  participantId: string;
  exercise: ExerciseSnapshot | undefined;
  canvasRef: {current: HTMLCanvasElement | null};
  editorTextareaRef: {current: HTMLTextAreaElement | null};
  patchGameStateRef: PatchGameState;
  onSetGameSpeed: (speed: number) => void;
  onSaveEditorFile: () => void;
  onCanvasClick: (event: MouseEvent) => void;
  onCanvasMove: (event: MouseEvent) => void;
  onCanvasWheel: (event: WheelEvent) => void;
  onTerminalKey: (event: KeyboardEvent) => void;
  onCanvasPaste: (event: ClipboardEvent) => void;
  onCreateTask: (title: string) => void;
  onAppendIncidentLog: (body: string) => void;
  onFireInject: (injectId: string) => void;
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
      <div class='canvas-stage'>
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
        <PerfOverlay />
      </div>
      <TeamExercisePanel
        exercise={props.exercise}
        onCreateTask={props.onCreateTask}
        onAppendIncidentLog={props.onAppendIncidentLog}
        onFireInject={props.onFireInject}
      />
      <p id='canvas-play-hint' class='visually-hidden'>
        ターミナルにフォーカスしてキーボードでコマンドを入力できます。画面上のボタンはマウスで操作します。
      </p>
    </section>
  );
}

function TeamExercisePanel(props: {
  exercise: ExerciseSnapshot | undefined;
  onCreateTask: (title: string) => void;
  onAppendIncidentLog: (body: string) => void;
  onFireInject: (injectId: string) => void;
}) {
  const participants = props.exercise?.participants ?? [];
  const tasks = props.exercise?.tasks ?? [];
  const incidentLog = props.exercise?.incidentLog.slice(-6) ?? [];
  return (
    <aside class='team-panel' aria-label='訓練ルーム'>
      <section>
        <h2>Team</h2>
        <div class='team-participants'>
          {participants.map((participant) => (
            <span
              key={participant.participantId}
              class={participant.online ? '' : 'offline'}
            >
              {participant.displayName} /{' '}
              {participantRoleLabels[participant.role]}
            </span>
          ))}
        </div>
      </section>
      <section>
        <h2>Tasks</h2>
        <TaskComposer onCreateTask={props.onCreateTask} />
        <ol class='team-list'>
          {tasks.slice(-6).map((task) => (
            <li key={task.id}>
              <strong>{task.title}</strong>
              <span>{task.status}</span>
            </li>
          ))}
        </ol>
      </section>
      <section>
        <h2>Incident Log</h2>
        <LogComposer onAppendIncidentLog={props.onAppendIncidentLog} />
        <ol class='team-list'>
          {incidentLog.map((entry) => (
            <li key={entry.id}>
              <strong>{entry.kind}</strong>
              <span>{entry.body}</span>
            </li>
          ))}
        </ol>
      </section>
      <section>
        <h2>Injects</h2>
        <ol class='team-list'>
          {(props.exercise?.injects ?? []).map((inject) => (
            <li key={inject.id}>
              <strong>{inject.title}</strong>
              {(Boolean(inject.roleHint) ||
                (inject.atMs !== undefined && !inject.fired)) && (
                <span class='inject-badges'>
                  {inject.roleHint && (
                    <span class='inject-role-badge'>
                      {participantRoleLabels[inject.roleHint]}
                    </span>
                  )}
                  {inject.atMs !== undefined && !inject.fired && (
                    <span class='inject-auto-badge'>
                      {formatTime(inject.atMs)} に自動発火予定
                    </span>
                  )}
                </span>
              )}
              <span>{inject.fired ? 'fired' : inject.body}</span>
              {!inject.fired && (
                <button
                  type='button'
                  onClick={() => {
                    props.onFireInject(inject.id);
                  }}
                >
                  Fire
                </button>
              )}
            </li>
          ))}
        </ol>
      </section>
    </aside>
  );
}

function TaskComposer(props: {onCreateTask: (title: string) => void}) {
  return (
    <form
      class='team-composer'
      onSubmit={(event) => {
        event.preventDefault();
        const input = event.currentTarget.elements.namedItem('task');
        if (!(input instanceof HTMLInputElement)) return;
        const title = input.value.trim();
        if (!title) return;
        props.onCreateTask(title);
        input.value = '';
      }}
    >
      <input name='task' type='text' maxLength={160} placeholder='タスク追加' />
      <button type='submit'>追加</button>
    </form>
  );
}

function LogComposer(props: {onAppendIncidentLog: (body: string) => void}) {
  return (
    <form
      class='team-composer'
      onSubmit={(event) => {
        event.preventDefault();
        const input = event.currentTarget.elements.namedItem('log');
        if (!(input instanceof HTMLInputElement)) return;
        const body = input.value.trim();
        if (!body) return;
        props.onAppendIncidentLog(body);
        input.value = '';
      }}
    >
      <input name='log' type='text' maxLength={2000} placeholder='記録追加' />
      <button type='submit'>記録</button>
    </form>
  );
}

export function HotwashScreen(props: {
  exercise: ExerciseSnapshot | undefined;
  report: AfterActionReport | undefined;
  onSubmit: (input: {
    wentWell: string;
    improve: string;
    followUp: string;
  }) => void;
  onGenerateAar: () => void;
  onOpenReplay: () => void;
}) {
  return (
    <section class='panel hotwash-panel' aria-labelledby='hotwash-heading'>
      <p class='eyebrow'>Hotwash</p>
      <h1 id='hotwash-heading'>ふりかえり</h1>
      <form
        class='hotwash-form'
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const value = (name: string) => {
            const field = form.elements.namedItem(name);
            return field instanceof HTMLTextAreaElement ? field.value : '';
          };
          props.onSubmit({
            wentWell: value('wentWell'),
            improve: value('improve'),
            followUp: value('followUp'),
          });
          form.reset();
        }}
      >
        <label>
          うまくいったこと
          <textarea name='wentWell' required />
        </label>
        <label>
          改善したいこと
          <textarea name='improve' required />
        </label>
        <label>
          Follow-up
          <textarea name='followUp' required />
        </label>
        <button type='submit'>提出</button>
      </form>
      <div class='participant-list'>
        {(props.exercise?.hotwashNotes ?? []).map((note) => (
          <div key={note.id} class='participant-row'>
            <strong>{note.wentWell}</strong>
            <span>{note.improve}</span>
            <span>{note.followUp}</span>
          </div>
        ))}
      </div>
      <section class='aar-summary'>
        <h2>AAR</h2>
        <button type='button' onClick={props.onGenerateAar}>
          AAR 生成
        </button>
        {props.report && (
          <dl>
            <div>
              <dt>Participants</dt>
              <dd>{props.report.participants.length}</dd>
            </div>
            <div>
              <dt>Tasks</dt>
              <dd>{props.report.tasks.length}</dd>
            </div>
            <div>
              <dt>Injects</dt>
              <dd>
                {props.report.injects.filter((item) => item.fired).length}
              </dd>
            </div>
            <div>
              <dt>Log</dt>
              <dd>{props.report.incidentLog.length}</dd>
            </div>
          </dl>
        )}
      </section>
      <button type='button' onClick={props.onOpenReplay}>
        Replay
      </button>
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
