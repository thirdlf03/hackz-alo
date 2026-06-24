import {test} from '@playwright/test';
import {
  acceptRecordingConsent,
  clickResolveButton,
  openDemoScenarioBriefing,
  setGameSpeed,
  setSaveRecording,
  startGameFromBriefing,
  waitForFalseResolveResult,
  waitForSandboxReady,
} from './helpers.js';

test('premature resolve is rejected as false resolve failure', async ({
  page,
}) => {
  await openDemoScenarioBriefing(page);
  await acceptRecordingConsent(page);
  await setSaveRecording(page, false);
  await startGameFromBriefing(page);
  await waitForSandboxReady(page);
  await setGameSpeed(page, 8);
  await page.waitForTimeout(3_000);
  await clickResolveButton(page);
  await waitForFalseResolveResult(page);
});
