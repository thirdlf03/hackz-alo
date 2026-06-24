import {test} from '@playwright/test';
import {
  acceptRecordingConsent,
  clickResolveButton,
  openDefaultScenarioBriefing,
  setGameSpeed,
  setSaveRecording,
  startGameFromBriefing,
  waitForResolveSuccess,
  waitForSandboxReady,
  waitForTerminalCommand,
} from './helpers.js';

test.describe.configure({mode: 'serial'});

test('scenario select through resolve success after fault recovery', async ({
  page,
}) => {
  await openDefaultScenarioBriefing(page);
  await acceptRecordingConsent(page);
  await setSaveRecording(page, false);
  await startGameFromBriefing(page);
  await waitForSandboxReady(page);
  await setGameSpeed(page, 8);
  await page.waitForTimeout(8_000);
  await waitForTerminalCommand(page, 'unctl restart api', {skipWarmup: true});
  await page.waitForTimeout(3_000);
  await clickResolveButton(page);
  await waitForResolveSuccess(page);
});
