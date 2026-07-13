import {speedOptions, type Screen} from '../appTypes.js';

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
        ▚▞ 障害対応訓練
        <span class='blink-cursor' aria-hidden='true' />
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
          シナリオ
        </button>
        {props.canNavigateToReplay && (
          <button
            type='button'
            aria-label='リプレイ詳細を開く'
            onClick={props.onOpenReplay}
          >
            リプレイ
          </button>
        )}
      </div>
    </header>
  );
}
