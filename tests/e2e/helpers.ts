import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  centerToolTabRegions,
  inputDockRects,
  logicalHeight,
  logicalWidth,
  monitorContentRegion,
  monitorContentWidth,
  monitorContentHeight,
  monitorHeaderHeight,
  monitorLayout,
} from '../../apps/web/src/pure/canvasLayout.js';

const CANVAS_LABEL = '録画対象のゲーム画面';
const CONSENT_CHECKBOX = /録画し、振り返りに使うことに同意する/;
const SAVE_CHECKBOX = /録画データをサーバーに保存する/;
const DEFAULT_SCENARIO = /API が寝落ち/;
const DEMO_SCENARIO = /デモ: 1分復旧ドリル/;

const DESIGN_WIDTH = logicalWidth;
const DESIGN_HEIGHT = logicalHeight;
const RETIRE_RECT = inputDockRects.retire;
const RESOLVE_RECT = inputDockRects.button;
const COMMAND_INPUT_RECT = inputDockRects.input;
const TERMINAL_MONITOR = monitorLayout('terminal');

export interface CapturedSession {
  sessionId: string;
  replayId: string;
  writeToken: string;
}

export async function openScenarioBriefing(
  page: Page,
  options: {
    perf?: boolean;
    scenarioName?: RegExp;
    difficulty?: RegExp;
  } = {}
): Promise<CapturedSession> {
  const scenarioName = options.scenarioName ?? DEFAULT_SCENARIO;
  const difficulty = options.difficulty ?? /初級/;
  await page.goto(options.perf ? '/?perf=1' : '/');
  await page.getByRole('button', {name: difficulty}).click();
  const scenarioButton = page.getByRole('button', {name: scenarioName});
  const sessionResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/sessions$/.test(new URL(response.url()).pathname) &&
      response.ok(),
    {timeout: 90_000}
  );
  await scenarioButton.click();
  const response = await sessionResponse;
  const payload = await response.json();
  expect(payload.ok).toBe(true);
  const continueToBriefingButton = page.getByRole('button', {
    name: 'ブリーフィングへ',
  });
  await expect(continueToBriefingButton).toBeEnabled({timeout: 90_000});
  await continueToBriefingButton.click();
  await expect(page.getByRole('button', {name: /シフト開始/})).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByRole('button', {name: 'シフト開始中…'})).toHaveCount(
    0
  );
  return payload.data as CapturedSession;
}

export async function openDefaultScenarioBriefing(
  page: Page,
  options: {perf?: boolean} = {}
) {
  return openScenarioBriefing(page, options);
}

export async function openDemoScenarioBriefing(page: Page) {
  return openScenarioBriefing(page, {scenarioName: DEMO_SCENARIO});
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
    page.getByRole('button', {name: /シフト開始/}).click(),
  ]);

  const canvas = page.getByLabel(CANVAS_LABEL);
  await expect(canvas).toBeVisible({timeout: 30_000});
  return canvas;
}

export async function setGameSpeed(page: Page, speed: number) {
  await page
    .getByRole('group', {name: 'ゲーム速度'})
    .getByRole('button', {name: `${String(speed)}x`, exact: true})
    .click();
}

export async function focusGameCanvas(page: Page) {
  const canvas = page.getByLabel(CANVAS_LABEL);
  await canvas.focus();
  return canvas;
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

function rectCenter(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

export async function clickResolveButton(page: Page) {
  const canvas = await focusGameCanvas(page);
  const center = rectCenter(RESOLVE_RECT);
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes('/resolve') &&
        response.request().method() === 'POST',
      {timeout: 30_000}
    ),
    clickCanvasLogicalPoint(canvas, center.x, center.y),
  ]);
}

export async function retireFromGame(page: Page) {
  const canvas = page.getByLabel(CANVAS_LABEL);
  await expect(canvas).toBeVisible();

  const center = rectCenter(RETIRE_RECT);

  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes('/retire') &&
        response.request().method() === 'POST' &&
        response.ok(),
      {timeout: 30_000}
    ),
    clickCanvasLogicalPoint(canvas, center.x, center.y),
  ]);
}

export async function clickCenterTool(page: Page, tool: 'terminal' | 'editor') {
  const canvas = await focusGameCanvas(page);
  const tab = centerToolTabRegions().find((item) => item.id === tool);
  if (!tab) throw new Error(`unknown center tool: ${tool}`);
  await clickCanvasLogicalPoint(
    canvas,
    tab.x + tab.width / 2,
    tab.y + tab.height / 2
  );
}

export async function clickEditorFile(page: Page, index = 0) {
  const canvas = await focusGameCanvas(page);
  const content = monitorContentRegion(
    TERMINAL_MONITOR,
    monitorHeaderHeight('terminal')
  );
  const scale = Math.min(
    content.width / monitorContentWidth,
    content.height / monitorContentHeight
  );
  const fileListTop = 66;
  const x = content.x + 20 * scale;
  const y = content.y + (fileListTop + 8 + index * 28 + 4) * scale;
  await clickCanvasLogicalPoint(canvas, x, y);
}

export async function runTerminalCommand(page: Page, command: string) {
  const canvas = await focusGameCanvas(page);
  const inputCenter = rectCenter(COMMAND_INPUT_RECT);
  await clickCanvasLogicalPoint(canvas, inputCenter.x, inputCenter.y);
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');
}

export async function waitForSandboxReady(page: Page, timeoutMs = 15_000) {
  await page.waitForTimeout(timeoutMs);
}

export async function waitForTerminalCommand(
  page: Page,
  command: string,
  options: {skipWarmup?: boolean} = {}
) {
  if (!options.skipWarmup) {
    await waitForSandboxReady(page);
  }
  await runTerminalCommand(page, command);
}

export async function waitForResolveSuccess(page: Page) {
  await expect(page.locator('#result-heading')).toBeVisible({timeout: 30_000});
  await expect(page.getByText('無事退勤', {exact: true})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'ハイライト'})).toBeVisible();
}

export async function waitForFalseResolveResult(page: Page) {
  await expect(page.locator('#result-heading')).toBeVisible({timeout: 30_000});
  await expect(page.locator('.result-stamp')).toHaveText('解雇');
  await expect(page.getByText('未復旧のまま宣言')).toBeVisible();
}

export async function waitForRetireResult(page: Page) {
  await expect(page.locator('#result-heading')).toBeVisible({timeout: 30_000});
  await expect(page.locator('.result-stamp')).toHaveText('解雇');
  await expect(page.getByRole('heading', {name: 'ハイライト'})).toBeVisible();
  await expect(page.getByRole('button', {name: '再挑戦'})).toBeVisible();
}

export async function waitForReplayButton(page: Page) {
  const replay = page.getByRole('button', {
    name: 'リプレイを見る',
    exact: true,
  });
  await expect(replay).toBeVisible({timeout: 30_000});
  await expect(replay).toBeEnabled({timeout: 30_000});
  return replay;
}

export async function waitForReplayEvents(
  request: APIRequestContext,
  replayId: string,
  writeToken: string,
  predicate: (events: Array<{type: string; summary?: string | null}>) => boolean
) {
  const path = `/api/replays/${encodeURIComponent(replayId)}/events`;
  await expect
    .poll(
      async () => {
        const response = await request.get(path, {
          headers: {authorization: `Bearer ${writeToken}`},
        });
        if (!response.ok()) return false;
        const payload = await response.json();
        if (!payload.ok) return false;
        return predicate(payload.data);
      },
      {timeout: 60_000}
    )
    .toBe(true);
}

export async function waitForReplayVideoReady(
  request: APIRequestContext,
  replayId: string,
  writeToken: string
) {
  const path = `/api/replays/${encodeURIComponent(replayId)}/video`;
  await expect
    .poll(
      async () => {
        const response = await request.head(path, {
          headers: {authorization: `Bearer ${writeToken}`},
        });
        return response.ok();
      },
      {timeout: 120_000}
    )
    .toBe(true);
}
