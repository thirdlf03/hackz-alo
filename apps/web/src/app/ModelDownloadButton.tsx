import {useEffect, useRef, useState} from 'preact/hooks';
import {
  describeModelDownloadStatus,
  type AssistAvailability,
} from '../pure/aiAssist.js';
import {
  checkAssistAvailability,
  createAssistantSession,
} from '../effect/promptAssistant.js';
import {ModelDownloadProgress} from './ModelDownloadProgress.js';

const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const DOWNLOAD_TIMEOUT_REASON = 'model-download-timeout';

const TIMEOUT_ERROR_MESSAGE =
  'AIモデルのダウンロードが完了しませんでした。空き容量が約22GBあること、従量制でないネットワークであること、chrome://on-device-internals で状態を確認してください。';

const LOG_PREFIX = '[on-device-ai]';

export function ModelDownloadButton() {
  const unmountedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [availability, setAvailability] = useState<AssistAvailability>();
  const [downloadProgress, setDownloadProgress] = useState<number>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void checkAssistAvailability().then((state) => {
      if (unmountedRef.current) return;
      // Chrome may report 'downloading' before the user starts create().
      // Only show downloading UI after our own download click.
      console.info(LOG_PREFIX, 'download UI: initial availability', {
        reported: state,
        displayed: state === 'downloading' ? 'downloadable' : state,
      });
      setAvailability(state === 'downloading' ? 'downloadable' : state);
    });
    return () => {
      unmountedRef.current = true;
      if (abortControllerRef.current) {
        console.warn(LOG_PREFIX, 'download UI: unmounted while pending');
      }
      abortControllerRef.current?.abort();
    };
  }, []);

  if (
    availability === undefined ||
    availability === 'unsupported' ||
    availability === 'unavailable'
  ) {
    return null;
  }

  const handleDownload = async () => {
    const startedAt = Date.now();
    console.info(LOG_PREFIX, 'download UI: start clicked');
    setAvailability('downloading');
    setDownloadProgress(undefined);
    setError(undefined);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const timeoutId = window.setTimeout(() => {
      console.error(LOG_PREFIX, 'download UI: timed out', {
        elapsedMs: Date.now() - startedAt,
      });
      controller.abort(DOWNLOAD_TIMEOUT_REASON);
    }, DOWNLOAD_TIMEOUT_MS);

    try {
      const session = await createAssistantSession((ratio) => {
        if (unmountedRef.current) return;
        // Keep ratio >= 1 so status can show the preparing phase; the progress
        // bar treats >= 1 as indeterminate while create() finishes loading.
        setDownloadProgress(ratio);
      }, controller.signal);
      session.destroy();
      if (unmountedRef.current) return;
      console.info(LOG_PREFIX, 'download UI: completed', {
        elapsedMs: Date.now() - startedAt,
      });
      setAvailability('available');
      setDownloadProgress(undefined);
    } catch (err) {
      const timedOut = controller.signal.reason === DOWNLOAD_TIMEOUT_REASON;
      console.error(LOG_PREFIX, 'download UI: failed', {
        elapsedMs: Date.now() - startedAt,
        errorName: err instanceof Error ? err.name : undefined,
        errorMessage: err instanceof Error ? err.message : String(err),
        signalAborted: controller.signal.aborted,
        timedOut,
      });
      if (unmountedRef.current) return;
      if (controller.signal.aborted) {
        setError(
          timedOut
            ? TIMEOUT_ERROR_MESSAGE
            : 'ダウンロードをキャンセルしました。'
        );
      } else {
        const detail = err instanceof Error && err.message ? err.message : '';
        setError(
          detail
            ? `AIモデルのダウンロードに失敗しました。${detail}`
            : 'AIモデルのダウンロードに失敗しました。もう一度お試しください。'
        );
      }
      setAvailability('downloadable');
      setDownloadProgress(undefined);
    } finally {
      window.clearTimeout(timeoutId);
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  };

  return (
    <section class='model-download' aria-label='AIモデルの事前ダウンロード'>
      <p class='model-download-status' role='status'>
        {describeModelDownloadStatus(availability, downloadProgress)}
      </p>
      {availability === 'downloadable' && (
        <button
          type='button'
          class='model-download-button'
          onClick={() => {
            void handleDownload();
          }}
        >
          AIモデルのダウンロードを開始
        </button>
      )}
      {availability === 'downloading' && (
        <>
          <div class='model-download-actions'>
            <button type='button' class='model-download-button' disabled>
              ダウンロード中…
            </button>
            <button
              type='button'
              class='model-download-button'
              onClick={() => {
                console.warn(LOG_PREFIX, 'download UI: cancel clicked');
                abortControllerRef.current?.abort();
              }}
            >
              キャンセル
            </button>
          </div>
          <ModelDownloadProgress progress={downloadProgress} />
        </>
      )}
      {error && (
        <p class='model-download-error' role='alert'>
          {error}
        </p>
      )}
    </section>
  );
}
