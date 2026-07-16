import {useState} from 'preact/hooks';
import type {
  ExerciseSnapshot,
  ParticipantRole,
  ScenarioDefinition,
} from '@incident/shared';
import {areParticipantsReadyToStart} from '../../pure/participantsReady.js';
import {roleInfoFor} from '../../pure/roleInfo.js';

export const participantRoleLabels: Record<ParticipantRole, string> = {
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
  onLeave: () => void;
}) {
  const [inviteCopied, setInviteCopied] = useState(false);
  const selectedRoleInfo = roleInfoFor(props.participantRole);
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
      <p class='eyebrow'>WAITING ROOM</p>
      <h1 id='lobby-heading'>{props.scenario.title}</h1>
      <p class='lobby-lead'>
        全員そろったら開始。ひとりでも遊べるが、夜勤は仲間がいたほうが心強い。
      </p>
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
        <div class='role-info-card' aria-live='polite'>
          <p class='role-info-heading'>
            <strong>{participantRoleLabels[props.participantRole]}</strong>
            <span class='role-info-tagline'>{selectedRoleInfo.tagline}</span>
          </p>
          {selectedRoleInfo.can.length > 0 && (
            <p class='role-info-can'>
              できること: {selectedRoleInfo.can.join('、')}
            </p>
          )}
          {selectedRoleInfo.cannot.length > 0 && (
            <p class='role-info-cannot'>
              できないこと: {selectedRoleInfo.cannot.join('、')}
            </p>
          )}
        </div>
      </div>
      <div class='participant-list'>
        {participants.map((participant) => (
          <div
            key={participant.participantId}
            class={`participant-row${participant.online ? '' : ' offline'}`}
          >
            <strong>{participant.displayName}</strong>
            <span>{participantRoleLabels[participant.role]}</span>
            <span
              class={
                !participant.online
                  ? 'participant-status'
                  : participant.ready
                    ? 'participant-status ready'
                    : 'participant-status waiting'
              }
            >
              {!participant.online
                ? 'オフライン'
                : participant.ready
                  ? 'READY ✓'
                  : '待機中…'}
            </span>
          </div>
        ))}
      </div>
      <div class='lobby-actions'>
        <button type='button' onClick={props.onReady} disabled={ready}>
          {ready ? 'READY 済み' : 'READY'}
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
        <button type='button' onClick={props.onLeave}>
          退出
        </button>
      </div>
    </section>
  );
}
