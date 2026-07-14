import {useState} from 'preact/hooks';
import type {IncidentLogEntry, IncidentLogEntryKind} from '@incident/shared';
import {INCIDENT_LOG_KIND_LABELS} from '../../pure/speechPhrases.js';

export function IncidentLogRow(props: {
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

export function LogComposer(props: {
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
