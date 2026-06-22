import {test, expect} from '@playwright/test';
import {
  acceptRecordingConsent,
  openDefaultScenarioBriefing,
  retireFromGame,
  setSaveRecording,
  startGameFromBriefing,
  waitForReplayButton,
  waitForRetireResult,
} from './helpers.js';

test.describe.configure({mode: 'serial'});

test('game canvas renders first viewport', async ({page}) => {
  await openDefaultScenarioBriefing(page);
  await acceptRecordingConsent(page);
  await startGameFromBriefing(page);
  await expect(
    page.getByRole('button', {name: 'Replay', exact: true})
  ).toHaveCount(0);
});

test('briefing exposes recording save opt-out', async ({page}) => {
  await openDefaultScenarioBriefing(page);
  await acceptRecordingConsent(page);
  await setSaveRecording(page, false);
  await startGameFromBriefing(page);
});

test('result page offers replay after resolve flow', async ({page}) => {
  await openDefaultScenarioBriefing(page);
  await acceptRecordingConsent(page);
  await setSaveRecording(page, false);
  await startGameFromBriefing(page);
  await retireFromGame(page);
  await waitForRetireResult(page);
  const replay = await waitForReplayButton(page);
  await replay.click();
  await expect(
    page.getByRole('button', {name: '共有リンクをコピー'})
  ).toBeVisible();
});

test('shared replay link opens standalone replay', async ({page}) => {
  let replayId: string | undefined;
  page.on('response', (response) => {
    const match = response.url().match(/\/api\/replays\/(repl_[^/?]+)/);
    if (match && response.ok()) replayId = match[1];
  });

  await openDefaultScenarioBriefing(page);
  await acceptRecordingConsent(page);
  await setSaveRecording(page, false);
  await startGameFromBriefing(page);
  await retireFromGame(page);
  await waitForRetireResult(page);
  await waitForReplayButton(page);
  await expect.poll(() => replayId, {timeout: 30_000}).toBeTruthy();

  await page.goto(`/?replay=${encodeURIComponent(replayId!)}`);
  await expect(
    page.getByRole('button', {name: '共有リンクをコピー'})
  ).toBeVisible({timeout: 15_000});
  await expect(page.getByRole('tab', {name: 'タイムライン'})).toBeVisible();
});
