import {ApiResultError} from '../../api/httpClient.js';

export function isMissingReplayVideoFinalizeError(error: unknown) {
  return (
    error instanceof ApiResultError &&
    isMissingReplayVideoFinalizeFailure(error.status, error.code)
  );
}

export function isMissingReplayVideoFinalizeFailure(
  status: number,
  code: string
) {
  return status === 404 && code === 'not_found';
}

export function shouldPollForReplayVideo(recordingStatus?: string) {
  return ![
    'idle',
    'recording_error',
    'upload_degraded',
    'finalization_failed',
    'unsupported_browser',
  ].includes(recordingStatus ?? '');
}
