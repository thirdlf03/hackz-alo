import {useState} from 'preact/hooks';
import type {ExerciseTask, ExerciseTaskStatus} from '@incident/shared';

/** タスク一覧の状態マーカー(6a サイドバー: 完了 ✓ / 進行中 ▸ など)。 */
const taskStatusMarkers: Record<ExerciseTaskStatus, string> = {
  open: '·',
  in_progress: '▸',
  done: '✓',
  blocked: '!',
};

const taskStatusLabels: Record<ExerciseTaskStatus, string> = {
  open: '未着手',
  in_progress: '進行中',
  done: '完了',
  blocked: 'ブロック',
};

export function TaskRow(props: {
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

export function TaskComposer(props: {
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
