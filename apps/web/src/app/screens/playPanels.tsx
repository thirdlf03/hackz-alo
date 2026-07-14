import {useState} from 'preact/hooks';
import type {
  ExerciseSnapshot,
  ExerciseTask,
  ExerciseTaskStatus,
  IncidentLogEntry,
  IncidentLogEntryKind,
  ScenarioDefinition,
} from '@incident/shared';
import {formatTime} from '../../pure/canvasFormat.js';
import {describeVoiceStatus} from '../../pure/voiceChat.js';
import {INCIDENT_LOG_KIND_LABELS} from '../../pure/speechPhrases.js';
import {PIP_MONITOR_LABELS, type PipMonitorId} from '../../pure/pipMonitor.js';
import {AiAssistPanel} from '../AiAssistPanel.js';
import {SpeechIncidentLogPanel} from '../SpeechIncidentLogPanel.js';
import type {VoiceChatControls} from '../useVoiceChat.js';
import type {MonitorPipControls} from '../useMonitorPip.js';
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
  onUpdateTask: (
    taskId: string,
    input: {title?: string; status?: ExerciseTaskStatus}
  ) => void;
  onDeleteTask: (taskId: string) => void;
  onAppendIncidentLog: (body: string, kind?: IncidentLogEntryKind) => void;
  onUpdateIncidentLog: (
    entryId: string,
    input: {body?: string; kind?: IncidentLogEntryKind}
  ) => void;
  onDeleteIncidentLog: (entryId: string) => void;
  onFireInject: (injectId: string) => void;
  voice: VoiceChatControls;
}) {
  const participants = props.exercise?.participants ?? [];
  const tasks = props.exercise?.tasks ?? [];
  const incidentLog = props.exercise?.incidentLog ?? [];
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
      <section class='npc-panel' aria-label='AIアシスタント'>
        <h2>ASSIST — ソラ (AI)</h2>
        <AiAssistPanel canvasRef={props.canvasRef} />
      </section>
      <section>
        <h2>TASKS</h2>
        <ol class='team-list'>
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              disabled={!props.canContribute}
              onUpdate={props.onUpdateTask}
              onDelete={props.onDeleteTask}
            />
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
            <IncidentLogRow
              key={entry.id}
              entry={entry}
              disabled={!props.canContribute}
              onUpdate={props.onUpdateIncidentLog}
              onDelete={props.onDeleteIncidentLog}
            />
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

const taskStatusLabels: Record<ExerciseTaskStatus, string> = {
  open: '未着手',
  in_progress: '進行中',
  done: '完了',
  blocked: 'ブロック',
};

function TaskRow(props: {
  task: ExerciseTask;
  disabled: boolean;
  onUpdate: (
    taskId: string,
    input: {title?: string; status?: ExerciseTaskStatus}
  ) => void;
  onDelete: (taskId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(props.task.title);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (editing) {
    return (
      <li class={`team-task team-task-${props.task.status}`}>
        <form
          class='team-item-editor'
          onSubmit={(event) => {
            event.preventDefault();
            const nextTitle = title.trim();
            if (!nextTitle) return;
            props.onUpdate(props.task.id, {title: nextTitle});
            setEditing(false);
          }}
        >
          <input
            value={title}
            maxLength={160}
            aria-label='タスク名'
            onInput={(event) => {
              setTitle(event.currentTarget.value);
            }}
          />
          <div class='team-item-actions'>
            <button type='submit'>保存</button>
            <button
              type='button'
              class='ghost'
              onClick={() => {
                setTitle(props.task.title);
                setEditing(false);
              }}
            >
              キャンセル
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li class={`team-task team-task-${props.task.status}`}>
      <span class='team-task-marker' aria-hidden='true'>
        {taskStatusMarkers[props.task.status]}
      </span>
      <span class='team-task-title'>{props.task.title}</span>
      {!props.disabled && (
        <div class='team-item-actions'>
          <select
            value={props.task.status}
            aria-label={`${props.task.title}の状態`}
            onChange={(event) => {
              props.onUpdate(props.task.id, {
                status: event.currentTarget.value as ExerciseTaskStatus,
              });
            }}
          >
            {Object.entries(taskStatusLabels).map(([status, label]) => (
              <option key={status} value={status}>
                {label}
              </option>
            ))}
          </select>
          <button
            type='button'
            aria-label={`${props.task.title}を編集`}
            onClick={() => {
              setTitle(props.task.title);
              setConfirmingDelete(false);
              setEditing(true);
            }}
          >
            編集
          </button>
          {confirmingDelete ? (
            <>
              <button
                type='button'
                class='danger'
                aria-label={`${props.task.title}を削除する`}
                onClick={() => {
                  props.onDelete(props.task.id);
                }}
              >
                削除する
              </button>
              <button
                type='button'
                class='ghost'
                onClick={() => {
                  setConfirmingDelete(false);
                }}
              >
                やめる
              </button>
            </>
          ) : (
            <button
              type='button'
              class='danger ghost'
              aria-label={`${props.task.title}の削除を確認`}
              onClick={() => {
                setConfirmingDelete(true);
              }}
            >
              削除
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function IncidentLogRow(props: {
  entry: IncidentLogEntry;
  disabled: boolean;
  onUpdate: (
    entryId: string,
    input: {body?: string; kind?: IncidentLogEntryKind}
  ) => void;
  onDelete: (entryId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(props.entry.body);
  const [kind, setKind] = useState(props.entry.kind);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const entryLabel = props.entry.body.slice(0, 40);

  if (editing) {
    return (
      <li class='team-log-entry'>
        <form
          class='team-item-editor'
          onSubmit={(event) => {
            event.preventDefault();
            const nextBody = body.trim();
            if (!nextBody) return;
            props.onUpdate(props.entry.id, {body: nextBody, kind});
            setEditing(false);
          }}
        >
          <select
            value={kind}
            aria-label='記録の種類'
            onChange={(event) => {
              setKind(event.currentTarget.value as IncidentLogEntryKind);
            }}
          >
            {Object.entries(INCIDENT_LOG_KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            value={body}
            maxLength={2000}
            aria-label='記録内容'
            onInput={(event) => {
              setBody(event.currentTarget.value);
            }}
          />
          <div class='team-item-actions'>
            <button type='submit'>保存</button>
            <button
              type='button'
              class='ghost'
              onClick={() => {
                setBody(props.entry.body);
                setKind(props.entry.kind);
                setEditing(false);
              }}
            >
              キャンセル
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li class='team-log-entry'>
      <span>
        <span class='team-log-kind'>
          {INCIDENT_LOG_KIND_LABELS[props.entry.kind]}
        </span>{' '}
        <span class='team-log-body'>{props.entry.body}</span>
      </span>
      {!props.disabled && (
        <div class='team-item-actions'>
          <button
            type='button'
            aria-label={`${entryLabel}を編集`}
            onClick={() => {
              setBody(props.entry.body);
              setKind(props.entry.kind);
              setConfirmingDelete(false);
              setEditing(true);
            }}
          >
            編集
          </button>
          {confirmingDelete ? (
            <>
              <button
                type='button'
                class='danger'
                aria-label={`${entryLabel}を削除する`}
                onClick={() => {
                  props.onDelete(props.entry.id);
                }}
              >
                削除する
              </button>
              <button
                type='button'
                class='ghost'
                onClick={() => {
                  setConfirmingDelete(false);
                }}
              >
                やめる
              </button>
            </>
          ) : (
            <button
              type='button'
              class='danger ghost'
              aria-label={`${entryLabel}の削除を確認`}
              onClick={() => {
                setConfirmingDelete(true);
              }}
            >
              削除
            </button>
          )}
        </div>
      )}
    </li>
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
