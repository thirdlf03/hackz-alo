import type {
  ExerciseSnapshot,
  ExerciseTaskStatus,
  GameRenderState,
  IncidentLogEntryKind,
  ScenarioDefinition,
} from '@incident/shared';
import {formatNarrativeClock, formatTime} from '../../pure/canvasFormat.js';
import {describeAssistAvailability} from '../../pure/aiAssist.js';
import {describeVoiceStatus} from '../../pure/voiceChat.js';
import {INCIDENT_LOG_KIND_LABELS} from '../../pure/speechPhrases.js';
import {PIP_MONITOR_LABELS, type PipMonitorId} from '../../pure/pipMonitor.js';
import {AiAssistPanel} from '../AiAssistPanel.js';
import {SpeechIncidentLogPanel} from '../SpeechIncidentLogPanel.js';
import type {VoiceChatControls} from '../useVoiceChat.js';
import type {NpcColleagueControls} from '../useNpcColleague.js';
import type {MonitorPipControls} from '../useMonitorPip.js';
import {difficultyOptions} from './SelectScreen.js';
import {participantRoleLabels} from './LobbyScreen.js';

/** タスク一覧の状態マーカー(6a サイドバー: 完了 ✓ / 進行中 ▸ など)。 */
const taskStatusMarkers: Record<ExerciseTaskStatus, string> = {
  open: '·',
  in_progress: '▸',
  done: '✓',
  blocked: '!',
};

export function TeamExercisePanel(props: {
  exercise: ExerciseSnapshot | undefined;
  canContribute: boolean;
  canvasRef: {current: HTMLCanvasElement | null};
  scenario: ScenarioDefinition | undefined;
  commandInputFocused: boolean;
  onCreateTask: (title: string) => void;
  onAppendIncidentLog: (body: string, kind?: IncidentLogEntryKind) => void;
  onFireInject: (injectId: string) => void;
  voice: VoiceChatControls;
  npc: NpcColleagueControls;
}) {
  const participants = props.exercise?.participants ?? [];
  const tasks = props.exercise?.tasks ?? [];
  const incidentLog = props.exercise?.incidentLog.slice(-6) ?? [];
  return (
    <aside class='team-panel' aria-label='訓練ルーム'>
      <section aria-label='オンコール名簿'>
        <h2>ON-CALL</h2>
        <div class='team-participants'>
          {participants.map((participant) => (
            <span
              key={participant.participantId}
              class={participant.online ? '' : 'offline'}
            >
              <span class='team-participant-dot' aria-hidden='true'>
                {participant.online ? '●' : '○'}
              </span>{' '}
              {participant.displayName}{' '}
              <span class='team-participant-role'>
                {participantRoleLabels[participant.role]}
                {!participant.online && ' · 離席'}
              </span>
            </span>
          ))}
        </div>
        <WarRoomVoicePanel voice={props.voice} />
      </section>
      {!props.canContribute && (
        <p class='team-readonly-note' role='status'>
          Observer は閲覧専用です
        </p>
      )}
      <section class='npc-panel' aria-label='AI NPC 後輩ソラ'>
        <h2>ASSIST — ソラ (AI)</h2>
        <NpcColleaguePanel npc={props.npc} onCreateTask={props.onCreateTask} />
        <AiAssistPanel canvasRef={props.canvasRef} />
      </section>
      <section>
        <h2>TASKS</h2>
        <ol class='team-list'>
          {tasks.slice(-6).map((task) => (
            <li key={task.id} class={`team-task team-task-${task.status}`}>
              <span class='team-task-marker' aria-hidden='true'>
                {taskStatusMarkers[task.status]}
              </span>
              <span class='team-task-title'>{task.title}</span>
            </li>
          ))}
        </ol>
        <TaskComposer
          disabled={!props.canContribute}
          onCreateTask={props.onCreateTask}
        />
      </section>
      <section>
        <h2>INJECTS</h2>
        <ol class='team-list'>
          {(props.exercise?.injects ?? []).map((inject) => (
            <li key={inject.id} class='team-inject'>
              <span class='team-inject-title'>
                {inject.title}
                {inject.roleHint && (
                  <span class='inject-role-badge'>
                    {participantRoleLabels[inject.roleHint]}
                  </span>
                )}
              </span>
              <span class='team-inject-body'>
                {inject.fired ? '発火済み' : inject.body}
              </span>
              {!inject.fired && (
                <span class='team-inject-actions'>
                  {inject.atMs !== undefined && (
                    <span class='team-inject-time'>
                      {formatTime(inject.atMs)} 自動発火
                    </span>
                  )}
                  <button
                    type='button'
                    onClick={() => {
                      props.onFireInject(inject.id);
                    }}
                  >
                    今すぐ発火
                  </button>
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>
      <section>
        <h2>NOTES / INCIDENT LOG</h2>
        <ol class='team-list'>
          {incidentLog.map((entry) => (
            <li key={entry.id} class='team-log-entry'>
              <span class='team-log-kind'>
                {INCIDENT_LOG_KIND_LABELS[entry.kind]}
              </span>{' '}
              <span class='team-log-body'>{entry.body}</span>
            </li>
          ))}
        </ol>
        <LogComposer
          disabled={!props.canContribute}
          onAppendIncidentLog={props.onAppendIncidentLog}
        />
        <SpeechIncidentLogPanel
          scenario={props.scenario}
          canContribute={props.canContribute}
          commandInputFocused={props.commandInputFocused}
          onAppendIncidentLog={(body, kind) => {
            props.onAppendIncidentLog(body, kind);
          }}
        />
      </section>
    </aside>
  );
}

/** プレイ中の canvas 左上に重ねるステージ名・ゲーム内時計・経過表示。
 * gameState が届く前(接続直後)は何も表示しない。 */
export function PlayStatusBar(props: {gameState: GameRenderState | undefined}) {
  const state = props.gameState;
  if (!state) return null;
  const level =
    difficultyOptions.findIndex(
      (option) => option.difficulty === state.session.difficulty
    ) + 1;
  const recording = state.recording.status === 'recording';
  return (
    <div class='play-status-bar'>
      <span class='play-status-stage'>
        STAGE: {state.session.scenarioTitle} ── LV.{level}
      </span>
      <span class='play-status-session'>
        {recording && <span class='play-status-rec-dot' aria-hidden='true' />}
        SESSION {formatTime(state.clock.elapsedMs)}
      </span>
      <span class='play-status-clock'>
        {formatNarrativeClock(state.world.narrativeHour)}
      </span>
    </div>
  );
}

/** gameCanvas のモニターを Document PiP へ「取り外す」ボタン列。 */
export function MonitorPipToolbar(props: {pip: MonitorPipControls}) {
  const monitors: PipMonitorId[] = ['metrics', 'chat'];
  return (
    <div class='play-pip-toolbar' role='group' aria-label='モニターの取り外し'>
      <span class='play-pip-toolbar-label'>PiP:</span>
      {monitors.map((monitorId) => {
        const detached = props.pip.detached.includes(monitorId);
        return (
          <button
            key={monitorId}
            type='button'
            class={detached ? 'active' : ''}
            aria-pressed={detached}
            disabled={!props.pip.supported}
            title={
              props.pip.supported
                ? '常時最前面の PiP ウィンドウにミラー表示します'
                : 'このブラウザは Document Picture-in-Picture に対応していません'
            }
            onClick={() => {
              props.pip.toggle(monitorId);
            }}
          >
            {detached ? '📌 戻す: ' : '📌 取り外す: '}
            {PIP_MONITOR_LABELS[monitorId]}
          </button>
        );
      })}
      <span class='play-pip-toolbar-hint'>— 常時最前面の小窓にミラー表示</span>
    </div>
  );
}

/** WebRTC ウォールーム音声(Cloudflare TURN 経由)の参加・ミュート操作。 */
function WarRoomVoicePanel(props: {voice: VoiceChatControls}) {
  const {voice} = props;
  const joined = voice.status === 'connected';
  const joining = voice.status === 'requesting_mic';
  return (
    <section class='voice-panel' aria-label='ウォールーム音声'>
      <p class='voice-status' role='status'>
        {describeVoiceStatus(voice.status, voice.peerIds.length, voice.muted)}
      </p>
      {joined ? (
        <div class='voice-actions'>
          <button
            type='button'
            class={
              voice.muted ? 'voice-mute-button muted' : 'voice-mute-button'
            }
            aria-pressed={voice.muted}
            aria-label={
              voice.muted ? 'マイクのミュートを解除' : 'マイクをミュート'
            }
            onClick={() => {
              voice.toggleMute();
            }}
          >
            {voice.muted ? '🔇 ミュート中' : '🎙 ミュート'}
          </button>
          <button
            type='button'
            onClick={() => {
              voice.leave();
            }}
          >
            退出
          </button>
        </div>
      ) : (
        <div class='voice-actions'>
          <button
            type='button'
            disabled={joining}
            onClick={() => {
              voice.join();
            }}
          >
            {joining ? '接続中…' : '🎙 音声に参加'}
          </button>
        </div>
      )}
      <small class='voice-note'>参加中の会話はリプレイ録画に残ります</small>
    </section>
  );
}

/** Prompt API structured output で動く AI NPC「後輩ソラ」の操作パネル。 */
function NpcColleaguePanel(props: {
  npc: NpcColleagueControls;
  onCreateTask: (title: string) => void;
}) {
  const {npc} = props;
  const unavailable =
    npc.availability === 'unsupported' || npc.availability === 'unavailable';
  return (
    <>
      {unavailable || npc.availability === undefined ? (
        <p class='npc-status' role='status'>
          {npc.availability === undefined
            ? '利用可否を確認中…'
            : describeAssistAvailability(npc.availability)}
        </p>
      ) : (
        <>
          <label class='npc-toggle'>
            <input
              type='checkbox'
              checked={npc.enabled}
              onChange={(event) => {
                npc.setEnabled(event.currentTarget.checked);
              }}
            />
            チャットに常駐させる
          </label>
          <p class='npc-status' role='status'>
            {npc.enabled
              ? npc.thinking
                ? '状況を観察中…'
                : '数十秒おきに状況を見て発言します(提案の採否はあなた次第)'
              : 'オフ'}
          </p>
          {npc.suggestedTask && (
            <div class='npc-suggestion' role='group' aria-label='後輩の提案'>
              <p class='npc-suggestion-quote'>「{npc.suggestedTask}」</p>
              <div class='npc-suggestion-actions'>
                <button
                  type='button'
                  class='primary'
                  onClick={() => {
                    if (npc.suggestedTask) {
                      props.onCreateTask(npc.suggestedTask);
                    }
                    npc.dismissSuggestedTask();
                  }}
                >
                  タスクに採用
                </button>
                <button
                  type='button'
                  class='ghost'
                  onClick={() => {
                    npc.dismissSuggestedTask();
                  }}
                >
                  却下
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

function TaskComposer(props: {
  disabled?: boolean;
  onCreateTask: (title: string) => void;
}) {
  return (
    <form
      class='team-composer'
      onSubmit={(event) => {
        event.preventDefault();
        if (props.disabled) return;
        const input = event.currentTarget.elements.namedItem('task');
        if (!(input instanceof HTMLInputElement)) return;
        const title = input.value.trim();
        if (!title) return;
        props.onCreateTask(title);
        input.value = '';
      }}
    >
      <input
        name='task'
        type='text'
        maxLength={160}
        placeholder='タスク追加'
        disabled={props.disabled}
      />
      <button type='submit' aria-label='タスクを追加' disabled={props.disabled}>
        +
      </button>
    </form>
  );
}

function LogComposer(props: {
  disabled?: boolean;
  onAppendIncidentLog: (body: string) => void;
}) {
  return (
    <form
      class='team-composer'
      onSubmit={(event) => {
        event.preventDefault();
        if (props.disabled) return;
        const input = event.currentTarget.elements.namedItem('log');
        if (!(input instanceof HTMLInputElement)) return;
        const body = input.value.trim();
        if (!body) return;
        props.onAppendIncidentLog(body);
        input.value = '';
      }}
    >
      <input
        name='log'
        type='text'
        maxLength={2000}
        placeholder='記録追加'
        disabled={props.disabled}
      />
      <button type='submit' disabled={props.disabled}>
        記録
      </button>
    </form>
  );
}
