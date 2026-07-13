import type {ScenarioDefinition} from '@incident/shared';
import {difficultyOptions} from './SelectScreen.js';

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
  const level =
    difficultyOptions.findIndex(
      (option) => option.difficulty === props.scenario.difficulty
    ) + 1;
  return (
    <section class='panel briefing-panel' aria-labelledby='briefing-heading'>
      <button
        type='button'
        class='panel-back-button'
        disabled={props.isStarting}
        onClick={props.onBack}
      >
        ← シナリオ選択に戻る
      </button>
      <p class='eyebrow'>BRIEFING — LEVEL {level}</p>
      <h1 id='briefing-heading'>{props.scenario.title}</h1>
      <ul>
        {props.scenario.briefing.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {props.isHost ? (
        <>
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
        </>
      ) : (
        <p class='consent-row'>録画はホストが管理します。</p>
      )}
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
          class='briefing-start-button'
          onClick={props.onStartPlay}
          disabled={
            props.isStarting || !props.sandboxReady || !props.recordingConsent
          }
          aria-describedby='briefing-consent-note'
        >
          {props.isStarting
            ? 'シフト開始中…'
            : props.sandboxReady
              ? '▸ シフト開始'
              : '環境準備中…'}
        </button>
      ) : (
        <p role='status'>ホストの開始を待っています…</p>
      )}
    </section>
  );
}
