import {clampDownloadRatio, formatDownloadProgress} from '../pure/aiAssist.js';

export function ModelDownloadProgress(props: {progress: number | undefined}) {
  const {progress} = props;

  // undefined / <=0: waiting for meaningful progress
  // >= 1: download finished, create() still extracting/loading
  if (progress === undefined || progress <= 0 || progress >= 1) {
    return (
      <div
        class='model-download-progress'
        role='progressbar'
        aria-label='AIモデルのダウンロード進捗'
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div class='model-download-progress-track'>
          <div class='model-download-progress-fill model-download-progress-fill--indeterminate' />
        </div>
      </div>
    );
  }

  const percent = Math.round(clampDownloadRatio(progress) * 100);

  return (
    <div
      class='model-download-progress'
      role='progressbar'
      aria-label='AIモデルのダウンロード進捗'
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div class='model-download-progress-track'>
        <div
          class='model-download-progress-fill'
          style={{width: `${String(percent)}%`}}
        />
      </div>
      <span class='model-download-progress-label'>
        {formatDownloadProgress(progress)}
      </span>
    </div>
  );
}
