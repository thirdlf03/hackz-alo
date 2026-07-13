import type {Screen} from './appTypes.js';
import {
  computeLiveGameTimeMs as computeLiveGameTimeMsPure,
  snapElapsedMsOnSpeedChange as snapElapsedMsOnSpeedChangePure,
} from '../pure/appClock.js';
import {toErrorMessage} from '../pure/errors.js';
import {containsPoint} from '../pure/geometry.js';
import {SessionActionError} from '../api/httpClient.js';
import {participantRoleLabels} from './AppScreens.js';

export function readReplayIdFromSearch() {
  if (typeof window === 'undefined') return undefined;
  const replayId = new URLSearchParams(window.location.search)
    .get('replay')
    ?.trim();
  return replayId || undefined;
}

export function readInviteFromSearch() {
  if (typeof window === 'undefined') return undefined;
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('join')?.trim();
  const writeToken = params.get('wt')?.trim();
  if (!sessionId || !writeToken) return undefined;
  return {sessionId, writeToken};
}

export function buildInviteUrl(sessionId: string, writeToken: string) {
  if (typeof window === 'undefined') return '';
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('join', sessionId);
  url.searchParams.set('wt', writeToken);
  return url.toString();
}

export {toErrorMessage};

export function describeSessionActionError(
  error: unknown,
  context: 'start' | 'fireInject' | 'phase' | 'task' | 'incidentLog' | 'hotwash'
): string {
  if (error instanceof SessionActionError) {
    if (error.code === 'host_required') {
      if (context === 'fireInject') {
        return 'インジェクトの投入はホストのみ行えます。';
      }
      if (context === 'phase') return 'フェーズの進行はホストのみ行えます。';
      return 'セッションの開始はホストのみ行えます。';
    }
    if (error.code === 'participants_not_ready') {
      return '全員の準備が完了するまで開始できません。';
    }
    if (error.code === 'role_required') {
      // The server reports `ops` as the representative required role for
      // sandbox operations, which are allowed to Ops and Facilitator.
      const roles =
        !error.requiredRole || error.requiredRole === 'ops'
          ? `${participantRoleLabels.ops} / ${participantRoleLabels.facilitator}`
          : participantRoleLabels[error.requiredRole];
      return `この操作には ${roles} の役割が必要です。`;
    }
    if (error.code === 'observer_read_only') {
      return `${participantRoleLabels.observer} は閲覧専用です。`;
    }
  }
  return toErrorMessage(error);
}

export function toLogicalCanvasPoint(
  event: MouseEvent,
  canvas: HTMLCanvasElement
) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * 1920,
    y: ((event.clientY - rect.top) / rect.height) * 1080,
  };
}

export {containsPoint};

export function computeLiveGameTimeMs(options: {
  screen: Screen;
  baseMs: number;
  lastTickAt: number;
  speed: number;
  timeLimitMs: number;
  finishing: boolean;
}) {
  return computeLiveGameTimeMsPure({
    ...options,
    now: performance.now(),
  });
}

export function snapElapsedMsOnSpeedChange(options: {
  elapsedMs: number;
  timeLimitMs: number;
  lastTickAt: number;
  oldSpeed: number;
  now?: number;
}) {
  return snapElapsedMsOnSpeedChangePure({
    elapsedMs: options.elapsedMs,
    timeLimitMs: options.timeLimitMs,
    lastTickAt: options.lastTickAt,
    oldSpeed: options.oldSpeed,
    now: options.now ?? performance.now(),
  });
}
