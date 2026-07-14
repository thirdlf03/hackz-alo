import {expect, test} from '@playwright/test';
import {
  acceptRecordingConsent,
  clickRecoveryCheckButton,
  openDefaultScenarioBriefing,
  setGameSpeed,
  setSaveRecording,
  startGameFromBriefing,
  waitForSandboxReady,
} from './helpers.js';

test('premature recovery check keeps session running and shows unmet conditions', async ({
  page,
}) => {
  await openDefaultScenarioBriefing(page);
  await acceptRecordingConsent(page);
  await setSaveRecording(page, false);
  await startGameFromBriefing(page);
  await waitForSandboxReady(page);
  await setGameSpeed(page, 8);
  await page.waitForTimeout(3_000);

  // Recovery command was never run, so success conditions must still be
  // unmet: recovery-check is a dry run and must not resolve the session
  // (2366fd63 "復旧状態を確認" / "訓練を完了" split).
  let resolveRequested = false;
  page.on('request', (request) => {
    if (request.url().includes('/resolve') && request.method() === 'POST') {
      resolveRequested = true;
    }
  });

  const check = await clickRecoveryCheckButton(page);
  // The incident has triggered by now (8x speed, 3s real time), so this is
  // the "未達条件 N 件" unmet-condition display, not the earlier
  // "まだ復旧宣言できる段階ではありません" (not-yet-declarable) state.
  expect(check.declarable).toBe(true);
  expect(check.allOk).toBe(false);
  expect(check.checks.some((item) => !item.ok)).toBe(true);

  // Give any (incorrectly) fired resolve request time to show up.
  await page.waitForTimeout(2_000);
  expect(resolveRequested).toBe(false);

  // Session stays running: still on the play canvas, no result screen.
  await expect(page.getByLabel('録画対象のゲーム画面')).toBeVisible();
  await expect(page.locator('#result-heading')).toHaveCount(0);
});
