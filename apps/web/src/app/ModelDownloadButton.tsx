import {useEffect, useRef, useState} from 'preact/hooks';
import {
  describeModelDownloadStatus,
  type AssistAvailability,
} from '../pure/aiAssist.js';
import {
  checkAssistAvailability,
  createAssistantSession,
} from '../effect/promptAssistant.js';

export function ModelDownloadButton() {
  const unmountedRef = useRef(false);
  const [availability, setAvailability] = useState<AssistAvailability>();
  const [downloadProgress, setDownloadProgress] = useState<number>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void checkAssistAvailability().then((state) => {
      if (!unmountedRef.current) setAvailability(state);
    });
    return () => {
      unmountedRef.current = true;
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
    setAvailability('downloading');
    setDownloadProgress(0);
    setError(undefined);
    try {
      const session = await createAssistantSession((loaded) => {
        if (!unmountedRef.current) setDownloadProgress(loaded);
      });
      session.destroy();
      if (unmountedRef.current) return;
      setAvailability('available');
      setDownloadProgress(undefined);
    } catch (err) {
      console.error(err);
      if (unmountedRef.current) return;
      setError(
        'AIモデルのダウンロードに失敗しました。もう一度お試しください。'
      );
      setAvailability('downloadable');
      setDownloadProgress(undefined);
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
          AIモデルを事前ダウンロード
        </button>
      )}
      {availability === 'downloading' && (
        <button type='button' class='model-download-button' disabled>
          ダウンロード中…
        </button>
      )}
      {error && (
        <p class='model-download-error' role='alert'>
          {error}
        </p>
      )}
    </section>
  );
}
