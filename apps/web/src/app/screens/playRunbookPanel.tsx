import type {
  GameRenderState,
  RunbookDefinition,
  RunbookStepEvidence,
  RunbookStepStatus,
} from '@incident/shared';
import {
  hashRunbookBody,
  parseRunbookSteps,
  resolveStepStatuses,
} from '../../pure/runbookSteps.js';

/** 手順一覧の状態マーカー(6a サイドバー: 完了 ✓ / 対応中 ▸ など)。 */
const runbookStepMarkers: Record<RunbookStepStatus, string> = {
  pending: '·',
  current: '▸',
  done: '✓',
  failed: '!',
  skipped: '−',
};

type RunbookManualStatus = 'done' | 'failed' | 'skipped';

export function RunbookProgressPanel(props: {
  activeRunbook: RunbookDefinition | undefined;
  runbookProgress: GameRenderState['runbookProgress'];
  disabled: boolean;
  onMarkStep: (
    runbookId: string,
    bodyHash: string,
    stepId: string,
    status: RunbookManualStatus | null
  ) => void;
}) {
  const runbook = props.activeRunbook;
  if (!runbook) {
    return <p class='runbook-step-empty'>Runbook はまだ届いていない。</p>;
  }

  const steps = parseRunbookSteps(runbook.body, runbook.steps);
  if (steps.length === 0) {
    return <p class='runbook-step-empty'>この Runbook に手順はありません</p>;
  }

  const bodyHash = hashRunbookBody(runbook.body);
  const resolved = resolveStepStatuses(steps, props.runbookProgress);
  const current = resolved.find((entry) => entry.status === 'current');

  return (
    <>
      {current && (
        <p class='runbook-step-current-banner'>
          <span class='runbook-step-marker' aria-hidden='true'>
            {runbookStepMarkers.current}
          </span>{' '}
          {current.step.instruction}
        </p>
      )}
      <ol class='team-list runbook-step-list'>
        {resolved.map(({step, status, evidence}) => (
          <RunbookStepRow
            key={step.id}
            instruction={step.instruction}
            status={status}
            evidence={evidence}
            disabled={props.disabled}
            onUpdate={(nextStatus) => {
              props.onMarkStep(runbook.id, bodyHash, step.id, nextStatus);
            }}
          />
        ))}
      </ol>
    </>
  );
}

function RunbookStepRow(props: {
  instruction: string;
  status: RunbookStepStatus;
  evidence?: RunbookStepEvidence | undefined;
  disabled: boolean;
  onUpdate: (status: RunbookManualStatus | null) => void;
}) {
  const done = props.status === 'done';
  return (
    <li class={`team-task runbook-step-${props.status}`}>
      <span class='team-task-marker' aria-hidden='true'>
        {runbookStepMarkers[props.status]}
      </span>
      <button
        type='button'
        class='runbook-step-toggle'
        aria-pressed={done}
        disabled={props.disabled}
        onClick={() => {
          props.onUpdate(done ? null : 'done');
        }}
      >
        <span class='team-task-title'>
          {props.instruction}
          {props.evidence && (
            <span class='runbook-step-evidence'>
              ⌨ 実行済み {formatWallClockTime(props.evidence.at)}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

function formatWallClockTime(atMs: number) {
  const date = new Date(atMs);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}
