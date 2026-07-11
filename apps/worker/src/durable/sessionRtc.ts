import {readInternalJsonObject} from '../http/body.js';
import {HttpError, jsonOk} from '../http/response.js';
import {parseRtcSignalBody} from '../pure/turnCredentials.js';
import type {SessionSseHub} from './sessionSseHub.js';

const RTC_SIGNAL_BODY_MAX_BYTES = 64 * 1024;

/**
 * WebRTC ウォールーム音声のシグナリング中継。SDP/ICE を保存せず、
 * セッションの SSE ストリームへ `rtc_signal` としてブロードキャスト
 * するだけ(宛先の絞り込みはクライアント側で行う)。
 */
export async function handleSessionRtcSignal(
  request: Request,
  sessionId: string,
  sseHub: SessionSseHub
): Promise<Response> {
  const body = parseRtcSignalBody(
    await readInternalJsonObject(request, RTC_SIGNAL_BODY_MAX_BYTES)
  );
  if (!body) {
    throw new HttpError(400, 'bad_request', 'invalid rtc signal body');
  }
  sseHub.broadcast('rtc_signal', {sessionId, ...body});
  return jsonOk({sent: true});
}
