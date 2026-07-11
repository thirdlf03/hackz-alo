import {useEffect, useRef} from 'preact/hooks';
import type {GameRenderState} from '@incident/shared';
import {
  INCIDENT_ATTRS,
  INCIDENT_SPAN_NAMES,
  markJourney,
} from '@incident/observability/browser';
import type {ApiClientSurface} from '../api/client.js';
import {CanvasRecorder} from '../game/recording/recorder.js';
import {getRecordingAudioStream} from '../game/recording/audioMixer.js';
import {RecordingFinalizer} from '../game/recording/finalizer.js';
import {
  installOfflineFlush,
  OfflineUploadQueue,
} from '../game/recording/offlineQueue.js';
import type {RecordingClockSegment} from '../replay/replayMediaUtils.js';
import type {Screen} from './appTypes.js';

interface SessionIdentity {
  sessionId: string;
  replayId: string;
}
type SetGameState = (
  value:
    | GameRenderState
    | undefined
    | ((current: GameRenderState | undefined) => GameRenderState | undefined)
) => void;

let offlineQueue: OfflineUploadQueue | undefined;
const recordingFlushRef: {stop?: () => void} = {};

function queueFor(api: ApiClientSurface) {
  if (!offlineQueue) {
    offlineQueue = new OfflineUploadQueue(api);
    installOfflineFlush(offlineQueue, () => recordingFlushRef.stop?.());
  }
  return offlineQueue;
}

export function useCanvasRecording(options: {
  api: ApiClientSurface;
  canvasRef: {current: HTMLCanvasElement | null};
  screen: Screen;
  session: SessionIdentity | undefined;
  isHost: boolean;
  hasRecordingConsent: boolean;
  saveRecording: boolean;
  gameSpeedRef: {current: number};
  currentGameTimeMs: () => number;
  setGameState: SetGameState;
  setAppError: (message: string | undefined) => void;
}) {
  const recorderRef = useRef<CanvasRecorder | null>(null);
  const finalizerRef = useRef<RecordingFinalizer | null>(null);
  const saveRecordingRef = useRef(true);
  const recordingStartedAtGameMsRef = useRef(0);
  const recordingClockSegmentsRef = useRef<RecordingClockSegment[]>([]);
  const queue = queueFor(options.api);

  useEffect(() => {
    recordingFlushRef.stop = () => {
      void recorderRef.current?.stop().catch(console.error);
    };
    return () => {
      delete recordingFlushRef.stop;
    };
  }, []);

  useEffect(() => {
    saveRecordingRef.current = options.saveRecording;
  }, [options.saveRecording]);

  useEffect(() => {
    if (
      options.screen !== 'play' ||
      !options.session ||
      !options.canvasRef.current ||
      recorderRef.current ||
      !options.isHost ||
      !options.hasRecordingConsent ||
      !options.saveRecording
    ) {
      return;
    }
    const session = options.session;
    const finalizer = new RecordingFinalizer();
    finalizerRef.current = finalizer;
    const recorder = new CanvasRecorder(options.canvasRef.current, {
      replayId: session.replayId,
      onChunk: async (chunk) => {
        await finalizer.append(chunk.blob);
        try {
          await options.api.uploadChunk(session.replayId, chunk);
          markJourney(INCIDENT_SPAN_NAMES.journeyRecordingChunkUploaded, {
            [INCIDENT_ATTRS.replayId]: session.replayId,
            chunk_size: chunk.blob.size,
          });
        } catch {
          await queue.enqueueChunk({
            replayId: session.replayId,
            ...chunk,
          });
        }
      },
      onEvent: async (event) => {
        try {
          await options.api.uploadEvents(session.replayId, [event]);
        } catch {
          await queue.enqueueEvents(session.replayId, [event]);
        }
      },
    });
    recorderRef.current = recorder;
    options.setGameState((current) =>
      updateRecordingStatus(current, 'initializing')
    );
    try {
      // アラート音とウォールーム音声を録画に合成する(tech.md R30-R32)。
      // 対応外ブラウザでは undefined になり従来どおり映像のみ録画する。
      recorder.start(getRecordingAudioStream());
      recordingStartedAtGameMsRef.current = options.currentGameTimeMs();
      recordingClockSegmentsRef.current = [
        {
          gameMs: recordingStartedAtGameMsRef.current,
          videoMs: 0,
          speed: options.gameSpeedRef.current,
        },
      ];
      options.setGameState((current) =>
        updateRecordingStatus(current, 'recording')
      );
    } catch (error: unknown) {
      recorderRef.current = null;
      options.setAppError(toErrorMessage(error));
      options.setGameState((current) =>
        updateRecordingStatus(current, classifyRecordingError(error))
      );
    }
    return () => {
      if (recorderRef.current === recorder) {
        recorderRef.current = null;
        void recorder.stop().catch(console.error);
      }
      if (finalizerRef.current === finalizer) finalizerRef.current = null;
    };
  }, [
    options.screen,
    options.session?.replayId,
    options.isHost,
    options.hasRecordingConsent,
    options.saveRecording,
  ]);

  function resetRecordingClock() {
    recordingStartedAtGameMsRef.current = 0;
    recordingClockSegmentsRef.current = [];
  }

  function recordSpeedChange(gameMs: number, speed: number) {
    const activeRecorder = recorderRef.current;
    if (!activeRecorder || recordingClockSegmentsRef.current.length === 0) {
      return;
    }
    appendRecordingClockSegment({
      gameMs,
      videoMs: activeRecorder.currentElapsedMs,
      speed,
    });
  }

  function shouldSaveVideo() {
    return saveRecordingRef.current && options.hasRecordingConsent;
  }

  async function finishRecording(
    session: SessionIdentity,
    shouldSaveVideo: boolean
  ): Promise<GameRenderState['recording']['status']> {
    const activeRecorder = recorderRef.current;
    const recordingMimeType = activeRecorder?.mimeType;
    if (shouldSaveVideo) {
      await activeRecorder?.stop().catch((error: unknown) => {
        options.setAppError(toErrorMessage(error));
      });
      const videoDurationMs = activeRecorder?.durationMs;
      recorderRef.current = null;
      await queue.flush();
      options.setGameState((current) =>
        updateRecordingStatus(current, 'finalizing')
      );
      // finalize must not depend on finalizerRef: leaving play unmounts the
      // recorder effect and clears that ref before finishRecording resumes.
      const finalized = await options.api
        .finalizeReplayVideo(session.replayId)
        .then((result) => result.status === 'ready')
        .catch(() => false);
      finalizerRef.current = null;
      if (!finalized) {
        const headOk = await options.api.replayVideoExists(session.replayId);
        if (!headOk) {
          await options.api
            .waitForReplayVideo(session.replayId)
            .catch(() => undefined);
        }
      }
      await options.api
        .finishReplay(session.replayId, {
          browserInfo: browserInfo(recordingMimeType),
          consentRecorded: options.hasRecordingConsent,
          ...(videoDurationMs === undefined ? {} : {videoDurationMs}),
        })
        .catch(console.error);
    } else {
      recorderRef.current = null;
      finalizerRef.current = null;
      await queue.flush();
      await options.api
        .finishReplay(session.replayId, {
          browserInfo: browserInfo(recordingMimeType),
        })
        .catch(console.error);
    }
    if (!shouldSaveVideo) return 'idle';
    return (await options.api.replayVideoExists(session.replayId))
      ? 'ready'
      : 'upload_degraded';
  }

  function browserInfo(mimeType?: string) {
    return {
      userAgent: navigator.userAgent,
      mimeType,
      recordingStartedAtGameMs: recordingStartedAtGameMsRef.current,
      recordingClockSegments: recordingClockSegmentsRef.current,
    };
  }

  function appendRecordingClockSegment(segment: RecordingClockSegment) {
    const previous = recordingClockSegmentsRef.current.at(-1);
    if (
      previous &&
      previous.gameMs === segment.gameMs &&
      previous.videoMs === segment.videoMs
    ) {
      recordingClockSegmentsRef.current = [
        ...recordingClockSegmentsRef.current.slice(0, -1),
        segment,
      ];
      return;
    }
    if (previous && previous.speed === segment.speed) return;
    recordingClockSegmentsRef.current = [
      ...recordingClockSegmentsRef.current,
      segment,
    ];
  }

  return {
    finishRecording,
    recordSpeedChange,
    resetRecordingClock,
    shouldSaveVideo,
  };
}

function updateRecordingStatus(
  state: GameRenderState | undefined,
  status: GameRenderState['recording']['status']
) {
  return state ? {...state, recording: {...state.recording, status}} : state;
}

function classifyRecordingError(
  error: unknown
): GameRenderState['recording']['status'] {
  const message = toErrorMessage(error);
  return message.includes('MediaRecorder') || message.includes('captureStream')
    ? 'unsupported_browser'
    : 'recording_error';
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
