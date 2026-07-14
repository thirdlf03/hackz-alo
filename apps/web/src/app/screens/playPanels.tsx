import type {
  ExerciseSnapshot,
  ExerciseTaskStatus,
  GameRenderState,
  IncidentLogEntryKind,
  ScenarioDefinition,
} from '@incident/shared';
import {formatTime} from '../../pure/canvasFormat.js';
import {describeVoiceStatus} from '../../pure/voiceChat.js';
import {PIP_MONITOR_LABELS, type PipMonitorId} from '../../pure/pipMonitor.js';
import {AiAssistPanel} from '../AiAssistPanel.js';
import {SpeechIncidentLogPanel} from '../SpeechIncidentLogPanel.js';
import type {VoiceChatControls} from '../useVoiceChat.js';
import type {MonitorPipControls} from '../useMonitorPip.js';
import {participantRoleLabels} from './LobbyScreen.js';
import {TaskRow, TaskComposer} from './playTaskPanel.js';
import {IncidentLogRow, LogComposer} from './playIncidentLogPanel.js';

export function TeamExercisePanel(props: {
  exercise: ExerciseSnapshot | undefined;
  canContribute: boolean;
  canvasRef: {current: HTMLCanvasElement | null};
  gameStateRef: {current: GameRenderState | undefined};
  scenarioRef: {current: ScenarioDefinition | undefined};
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
        <AiAssistPanel
          canvasRef={props.canvasRef}
          gameStateRef={props.gameStateRef}
          scenarioRef={props.scenarioRef}
        />
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
