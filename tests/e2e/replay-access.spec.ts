import {expect, test, type APIRequestContext} from '@playwright/test';
import {
  acceptRecordingConsent,
  openDefaultScenarioBriefing,
  retireFromGame,
  setSaveRecording,
  startGameFromBriefing,
  waitForReplayButton,
  waitForReplayVideoReady,
  waitForRetireResult,
} from './helpers.js';

interface CreatedSession {
  sessionId: string;
  replayId: string;
  writeToken: string;
}

async function createSession(
  request: APIRequestContext
): Promise<CreatedSession> {
  const createResponse = await request.post('/api/sessions', {
    data: {scenarioId: 'disk-full-001'},
  });
  expect(createResponse.ok()).toBeTruthy();
  const payload = await createResponse.json();
  expect(payload.ok).toBe(true);
  return payload.data as CreatedSession;
}

test.describe('access policy api', () => {
  test('private replay read routes reject missing credentials', async ({
    request,
  }) => {
    const session = await createSession(request);
    const replayId = session.replayId;
    const encodedReplayId = encodeURIComponent(replayId);
    const privateReadPaths = [
      `/api/replays/${encodedReplayId}`,
      `/api/replays/${encodedReplayId}/video`,
      `/api/replays/${encodedReplayId}/chunks`,
      `/api/replays/${encodedReplayId}/chunks/0`,
      `/api/replays/${encodedReplayId}/events`,
      `/api/replays/${encodedReplayId}/thumbnail`,
      `/api/replays/${encodedReplayId}/comments`,
    ];

    for (const path of privateReadPaths) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(401);
    }

    const commentResponse = await request.post(
      `/api/replays/${encodedReplayId}/comments`,
      {
        data: {atMs: 1, body: 'blocked'},
        headers: {'content-type': 'application/json'},
      }
    );
    expect(commentResponse.status()).toBe(401);
  });

  test('share link read token grants replay access without write token', async ({
    request,
  }) => {
    const session = await createSession(request);
    const replayId = session.replayId;
    const encodedReplayId = encodeURIComponent(replayId);

    const shareResponse = await request.post(
      `/api/replays/${encodedReplayId}/share-links`,
      {
        headers: {authorization: `Bearer ${session.writeToken}`},
        data: {},
      }
    );
    expect(shareResponse.ok()).toBeTruthy();
    const sharePayload = await shareResponse.json();
    expect(sharePayload.ok).toBe(true);
    expect(sharePayload.data.scope).toBe('read');
    expect(sharePayload.data.expiresAt).toBeTruthy();
    expect(sharePayload.data.readToken).toBeTruthy();
    expect(sharePayload.data.sharePath).toContain('readToken=');

    const readToken = sharePayload.data.readToken as string;
    const metadata = await request.get(
      `/api/replays/${encodedReplayId}?readToken=${encodeURIComponent(readToken)}`
    );
    expect(metadata.ok()).toBeTruthy();

    const events = await request.get(
      `/api/replays/${encodedReplayId}/events?readToken=${encodeURIComponent(readToken)}`
    );
    expect(events.ok()).toBeTruthy();
  });

  test('active session terminal rejects missing credentials and accepts write token', async ({
    request,
  }) => {
    const session = await createSession(request);
    const encodedSessionId = encodeURIComponent(session.sessionId);

    const denied = await request.get(
      `/api/sessions/${encodedSessionId}/ws/terminal`
    );
    expect(denied.status()).toBe(401);

    const allowed = await request.get(
      `/api/sessions/${encodedSessionId}/ws/terminal`,
      {
        headers: {authorization: `Bearer ${session.writeToken}`},
      }
    );
    expect(allowed.status()).not.toBe(401);
  });
});

test.describe('replay playback journeys', () => {
  test.describe.configure({mode: 'serial'});

  test('recording opt-out shows timeline-only replay state', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const session = await openDefaultScenarioBriefing(page);
    await acceptRecordingConsent(page);
    await setSaveRecording(page, false);
    await startGameFromBriefing(page);
    await retireFromGame(page);
    await waitForRetireResult(page);

    const videoHead = await request.head(
      `/api/replays/${encodeURIComponent(session.replayId)}/video`,
      {headers: {authorization: `Bearer ${session.writeToken}`}}
    );
    expect(videoHead.ok()).toBe(false);

    const replay = await waitForReplayButton(page);
    await replay.click();

    await expect(page.getByRole('tab', {name: 'タイムライン'})).toBeVisible({
      timeout: 15_000,
    });
    await expect
      .poll(
        async () => {
          const timelineOnly = await page
            .getByText(/保存された録画はありません|タイムラインのみ表示/)
            .isVisible()
            .catch(() => false);
          if (timelineOnly) return true;
          const videoCount = await page.locator('video').count();
          const loading = await page
            .getByText('動画の時間を計算中です…')
            .isVisible()
            .catch(() => false);
          return !loading && videoCount === 0;
        },
        {timeout: 130_000}
      )
      .toBe(true);
    await expect(page.locator('video')).toHaveCount(0);

    const eventsResponse = await page.request.get(
      `/api/replays/${encodeURIComponent(session.replayId)}/events`,
      {headers: {authorization: `Bearer ${session.writeToken}`}}
    );
    expect(eventsResponse.ok()).toBeTruthy();
  });

  test('recording save enabled exposes replay video under write token policy', async ({
    page,
    request,
  }) => {
    const session = await openDefaultScenarioBriefing(page);
    await acceptRecordingConsent(page);
    await setSaveRecording(page, true);
    await startGameFromBriefing(page);
    await page.waitForTimeout(8_000);
    await retireFromGame(page);
    await waitForRetireResult(page);
    await waitForReplayVideoReady(
      request,
      session.replayId,
      session.writeToken
    );
    const replay = await waitForReplayButton(page);
    await replay.click();
    await expect(page.getByRole('tab', {name: 'タイムライン'})).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('タイムラインの時間を計算中です…')).toHaveCount(
      0
    );
    await expect(page.locator('.timeline li').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('shared replay link opens standalone replay under read token policy', async ({
    page,
    request,
  }) => {
    const session = await openDefaultScenarioBriefing(page);
    await acceptRecordingConsent(page);
    await setSaveRecording(page, false);
    await startGameFromBriefing(page);
    await retireFromGame(page);
    await waitForRetireResult(page);
    await waitForReplayButton(page);

    const shareResponse = await request.post(
      `/api/replays/${encodeURIComponent(session.replayId)}/share-links`,
      {
        headers: {authorization: `Bearer ${session.writeToken}`},
        data: {},
      }
    );
    expect(shareResponse.ok()).toBeTruthy();
    const sharePayload = await shareResponse.json();
    const readToken = sharePayload.data.readToken as string;

    await page.evaluate(() => sessionStorage.clear());
    await page.goto(
      `/?replay=${encodeURIComponent(session.replayId)}&readToken=${encodeURIComponent(readToken)}`
    );
    await expect(page.getByRole('tab', {name: 'タイムライン'})).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole('button', {name: '共有リンクをコピー'})
    ).toBeVisible();
  });
});
