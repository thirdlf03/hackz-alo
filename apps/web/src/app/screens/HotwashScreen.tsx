import type {AfterActionReport, ExerciseSnapshot} from '@incident/shared';
import {canContributeRecords} from '../../pure/rolePermissions.js';

export function HotwashScreen(props: {
  exercise: ExerciseSnapshot | undefined;
  participantId: string;
  report: AfterActionReport | undefined;
  onSubmit: (input: {
    wentWell: string;
    improve: string;
    followUp: string;
  }) => void;
  onGenerateAar: () => void;
  onOpenReplay: () => void;
  canOpenReplay: boolean;
}) {
  const canContribute = canContributeRecords(
    props.exercise?.participants ?? [],
    props.participantId
  );
  return (
    <section class='panel hotwash-panel' aria-labelledby='hotwash-heading'>
      <p class='eyebrow'>HOTWASH — 夜勤明けの5分</p>
      <h1 id='hotwash-heading'>ふりかえり</h1>
      <p class='hotwash-lead'>
        記憶が新しいうちに3つだけ書き残す。次の夜の自分が助かる。
      </p>
      {!canContribute && (
        <p class='team-readonly-note' role='status'>
          Observer は閲覧専用です
        </p>
      )}
      <form
        class='hotwash-form'
        onSubmit={(event) => {
          event.preventDefault();
          if (!canContribute) return;
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
          <textarea name='wentWell' required disabled={!canContribute} />
        </label>
        <label>
          改善したいこと
          <textarea name='improve' required disabled={!canContribute} />
        </label>
        <label>
          フォローアップ
          <textarea name='followUp' required disabled={!canContribute} />
        </label>
        <button type='submit' disabled={!canContribute}>
          提出
        </button>
      </form>
      <p class='hotwash-team-heading'>チームの記録</p>
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
        <div class='aar-summary-header'>
          <h2>AAR</h2>
          <button type='button' onClick={props.onGenerateAar}>
            AAR 生成
          </button>
        </div>
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
      <button
        type='button'
        onClick={props.onOpenReplay}
        disabled={!props.canOpenReplay}
      >
        {props.canOpenReplay ? 'リプレイを見る' : 'リプレイ準備中…'}
      </button>
    </section>
  );
}
