import {expect, test, type Page} from '@playwright/test';
import {
  acceptRecordingConsent,
  clickResolveButton,
  openDefaultScenarioBriefing,
  retireFromGame,
  setSaveRecording,
  startGameFromBriefing,
  waitForReplayButton,
  waitForReplayVideoReady,
  waitForResolveSuccess,
  waitForRetireResult,
  waitForSandboxReady,
  waitForTerminalCommand,
} from '../e2e/helpers.js';

const DEFAULT_SCENARIO = /API が寝落ち/;

async function waitForFontsReady(page: Page) {
  await page.evaluate(() => document.fonts.ready);
}

test('select screen', async ({page}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', {name: '今夜のシフトを選ぶ'})
  ).toBeVisible();
  await waitForFontsReady(page);
  await page.mouse.move(0, 0);
  await expect(page).toHaveScreenshot('select.png');
});

test('scenario-list screen', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: /初級/}).click();
  await expect(page.getByRole('heading', {name: /初級シナリオ/})).toBeVisible();
  await waitForFontsReady(page);
  await page.mouse.move(0, 0);
  await expect(page).toHaveScreenshot('scenario-list.png');
});

test('briefing screen', async ({page}) => {
  await openDefaultScenarioBriefing(page);
  await acceptRecordingConsent(page);
  await expect(page.getByRole('button', {name: /シフト開始/})).toBeEnabled({
    timeout: 90_000,
  });
  await waitForFontsReady(page);
  await page.mouse.move(0, 0);
  await expect(page).toHaveScreenshot('briefing.png');
});

test('lobby screen', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: /初級/}).click();
  const sessionResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/sessions$/.test(new URL(response.url()).pathname) &&
      response.ok(),
    {timeout: 90_000}
  );
  await page.getByRole('button', {name: DEFAULT_SCENARIO}).click();
  await sessionResponse;
  await expect(page.getByRole('heading', {name: DEFAULT_SCENARIO})).toBeVisible(
    {
      timeout: 30_000,
    }
  );
  const continueButton = page.getByRole('button', {name: 'ブリーフィングへ'});
  await expect(continueButton).toBeEnabled({timeout: 30_000});
  await waitForFontsReady(page);
  await page.mouse.move(0, 0);
  // 招待 URL・セッション ID はクリップボード/API 呼び出し向けのみで画面上の
  // テキストとしては表示されないため、マスク対象なし。
  await expect(page).toHaveScreenshot('lobby.png');
});

test('play screen', async ({page}) => {
  await openDefaultScenarioBriefing(page);
  await acceptRecordingConsent(page);
  await setSaveRecording(page, false);
  await startGameFromBriefing(page);
  await page.waitForTimeout(3_000);
  await waitForFontsReady(page);
  await page.mouse.move(0, 0);
  await expect(page).toHaveScreenshot('play.png', {
    mask: [
      page.locator('canvas'),
      page.locator('.play-status-bar'),
      // TASKS / INJECTS / NOTES はシナリオ進行時間に応じて内容が変わるため、
      // ふりかえりコンテンツ自体は VRT の対象から外す。
      page.locator('.team-list'),
    ],
  });
});

test('result screen (success)', async ({page}) => {
  await openDefaultScenarioBriefing(page);
  await acceptRecordingConsent(page);
  await setSaveRecording(page, false);
  await startGameFromBriefing(page);
  // process-stop-001 は制限時間 5 分、障害トリガー(stop-api)は atMs 20000。
  // 等速のまま進め、トリガー通過を待ってから復旧コマンドを打つ(先に打つと
  // 復旧前に障害が発生し、未復旧のまま resolve されてタイムアウトしてしまう)。
  await waitForSandboxReady(page);
  await page.waitForTimeout(10_000);
  await waitForTerminalCommand(page, 'yamactl restart api', {
    skipWarmup: true,
  });
  await page.waitForTimeout(3_000);
  await clickResolveButton(page);
  await waitForResolveSuccess(page);
  await page.waitForTimeout(1_000);
  await waitForFontsReady(page);
  await page.mouse.move(0, 0);
  await expect(page).toHaveScreenshot('result-success.png', {
    mask: [
      page.locator('.result-hero-duration'),
      page.locator('.result-stats dd'),
      page.locator('.result-highlights'),
      page.locator('.result-session-meta'),
    ],
  });
});

test('result screen (fired)', async ({page}) => {
  await openDefaultScenarioBriefing(page);
  await acceptRecordingConsent(page);
  await setSaveRecording(page, false);
  await startGameFromBriefing(page);
  await retireFromGame(page);
  await waitForRetireResult(page);
  await page.waitForTimeout(1_000);
  await waitForFontsReady(page);
  await page.mouse.move(0, 0);
  await expect(page).toHaveScreenshot('result-fired.png', {
    mask: [
      page.locator('.result-dismissal-notice'),
      page.locator('.result-stats dd'),
      page.locator('.result-highlights'),
      page.locator('.result-session-meta'),
    ],
  });
});

test('replay screen', async ({page, request}) => {
  const session = await openDefaultScenarioBriefing(page);
  await acceptRecordingConsent(page);
  await setSaveRecording(page, true);
  await startGameFromBriefing(page);
  await page.waitForTimeout(8_000);
  await retireFromGame(page);
  await waitForRetireResult(page);
  await waitForReplayVideoReady(request, session.replayId, session.writeToken);
  const replay = await waitForReplayButton(page);
  await replay.click();
  await expect(page.getByRole('tab', {name: 'タイムライン'})).toBeVisible({
    timeout: 15_000,
  });
  // 動画のロード・WebCodecs によるフィルムストリップ生成が非同期のため、
  // 落ち着くまで少し待ってから撮影する。
  await page.waitForTimeout(3_000);
  await waitForFontsReady(page);
  await page.mouse.move(0, 0);
  await expect(page).toHaveScreenshot('replay.png', {
    mask: [
      // 動画パイプラインの完了タイミング(環境依存・クライアント側で最大120s超)に
      // 依存しないよう、動画/準備中プレースホルダー/フィルムストリップを包含する
      // 左カラムごとマスクし、videoあり/準備中どちらの状態でも同じ基準画像にする。
      page.locator('.replay-main'),
      page.locator('.timeline-time'),
      page.locator('.replay-meta-duration'),
    ],
  });
});

test('hotwash screen', async ({page}) => {
  await openDefaultScenarioBriefing(page);
  await acceptRecordingConsent(page);
  await setSaveRecording(page, false);
  await startGameFromBriefing(page);
  await retireFromGame(page);
  await waitForRetireResult(page);
  await page.getByRole('button', {name: 'ふりかえり'}).click();
  await expect(page.getByRole('heading', {name: 'ふりかえり'})).toBeVisible();
  await page.getByRole('button', {name: 'AAR 生成'}).click();
  await expect(page.locator('.aar-summary dl')).toBeVisible({timeout: 30_000});
  await waitForFontsReady(page);
  await page.mouse.move(0, 0);
  await expect(page).toHaveScreenshot('hotwash.png', {
    mask: [page.locator('.aar-summary dl')],
  });
});
