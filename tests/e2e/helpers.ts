import {expect, type Locator, type Page} from '@playwright/test';

const CANVAS_LABEL = '録画対象のゲーム画面';
const CONSENT_CHECKBOX = /録画し、振り返りに使うことに同意する/;
const SAVE_CHECKBOX = /録画データをサーバーに保存する/;
const DEFAULT_SCENARIO = /API が寝落ち/;

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;
const RETIRE_RECT = {x: 1370, y: 878, width: 140, height: 96};

export async function openDefaultScenarioBriefing(page: Page) {
  await page.goto('/');
  await page.getByRole('button', {name: /初級/}).click();

  const scenarioButton = page.getByRole('button', {name: DEFAULT_SCENARIO});
  await scenarioButton.click();
  await expect(page.getByRole('button', {name: '開始'})).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByRole('button', {name: '開始中…'})).toHaveCount(0);
}

export async function acceptRecordingConsent(page: Page) {
  await page.getByRole('checkbox', {name: CONSENT_CHECKBOX}).check();
}

export async function setSaveRecording(page: Page, enabled: boolean) {
  const saveCheckbox = page.getByRole('checkbox', {name: SAVE_CHECKBOX});
  await expect(saveCheckbox).toBeEnabled();
  if (enabled) {
    await saveCheckbox.check();
  } else {
    await saveCheckbox.uncheck();
  }
}

export async function startGameFromBriefing(page: Page) {
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes('/start') &&
        response.request().method() === 'POST' &&
        response.ok(),
      {timeout: 90_000}
    ),
    page.getByRole('button', {name: '開始'}).click(),
  ]);

  const canvas = page.getByLabel(CANVAS_LABEL);
  await expect(canvas).toBeVisible({timeout: 30_000});
  return canvas;
}

function retirePosition(box: {width: number; height: number}) {
  return {
    x: ((RETIRE_RECT.x + RETIRE_RECT.width / 2) / DESIGN_WIDTH) * box.width,
    y: ((RETIRE_RECT.y + RETIRE_RECT.height / 2) / DESIGN_HEIGHT) * box.height,
  };
}

async function clickCanvasLogicalPoint(
  canvas: Locator,
  logicalX: number,
  logicalY: number
) {
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  if (!box) return;

  const position = {
    x: (logicalX / DESIGN_WIDTH) * box.width,
    y: (logicalY / DESIGN_HEIGHT) * box.height,
  };
  await canvas.scrollIntoViewIfNeeded();
  await canvas.click({position});
}

export async function retireFromGame(page: Page) {
  const canvas = page.getByLabel(CANVAS_LABEL);
  await expect(canvas).toBeVisible();

  const logicalX = RETIRE_RECT.x + RETIRE_RECT.width / 2;
  const logicalY = RETIRE_RECT.y + RETIRE_RECT.height / 2;

  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes('/retire') &&
        response.request().method() === 'POST' &&
        response.ok(),
      {timeout: 30_000}
    ),
    clickCanvasLogicalPoint(canvas, logicalX, logicalY),
  ]);
}

export async function waitForRetireResult(page: Page) {
  await expect(page.locator('#result-heading')).toBeVisible({timeout: 30_000});
  await expect(page.getByText('解雇！', {exact: true})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'ハイライト'})).toBeVisible();
  await expect(page.getByRole('button', {name: '再挑戦'})).toBeVisible();
}

export async function waitForReplayButton(page: Page) {
  const replay = page.getByRole('button', {name: 'Replay', exact: true});
  await expect(replay).toBeVisible({timeout: 30_000});
  await expect(replay).toBeEnabled({timeout: 30_000});
  return replay;
}
