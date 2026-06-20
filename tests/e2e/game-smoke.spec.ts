import { test, expect } from "@playwright/test";

test("game canvas renders first viewport", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /初級/ }).click();
  await page.getByRole("button", { name: /API が寝落ち/ }).click();
  await page.getByRole("checkbox", { name: /録画し、振り返りに使うことに同意する/ }).check();
  await page.getByRole("button", { name: "開始" }).click();
  const canvas = page.getByLabel("録画対象のゲーム画面");
  await expect(canvas).toBeVisible();
  await expect(page.getByRole("button", { name: "Replay", exact: true })).toHaveCount(0);
});

test("briefing exposes recording save opt-out", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /初級/ }).click();
  await page.getByRole("button", { name: /API が寝落ち/ }).click();
  const saveCheckbox = page.getByRole("checkbox", { name: /録画データをサーバーに保存する/ });
  await expect(saveCheckbox).toBeVisible();
  await expect(saveCheckbox).toBeEnabled();
  await saveCheckbox.uncheck();
  await page.getByRole("checkbox", { name: /録画し、振り返りに使うことに同意する/ }).check();
  await page.getByRole("button", { name: "開始" }).click();
  await expect(page.getByLabel("録画対象のゲーム画面")).toBeVisible();
});

test("result page includes replay section after resolve flow", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /初級/ }).click();
  await page.getByRole("button", { name: /API が寝落ち/ }).click();
  await page.getByRole("checkbox", { name: /録画し、振り返りに使うことに同意する/ }).check();
  await page.getByRole("button", { name: "開始" }).click();
  const canvas = page.getByLabel("録画対象のゲーム画面");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  if (!box) return;
  const retireX = box.x + ((1370 + 70) / 1920) * box.width;
  const retireY = box.y + ((878 + 48) / 1080) * box.height;
  await page.mouse.click(retireX, retireY);
  await expect(page.getByRole("heading", { name: "リプレイ動画とタイムライン" })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("heading", { name: "重要イベント" })).toBeVisible();
  await page.getByRole("button", { name: "Replay 詳細を見る" }).click();
  await expect(page.getByRole("button", { name: "共有リンクをコピー" })).toBeVisible();
});

test("shared replay link opens standalone replay", async ({ page }) => {
  let replayId: string | undefined;
  page.on("response", (response) => {
    const match = response.url().match(/\/api\/replays\/(repl_[^/?]+)/);
    if (match && response.ok()) replayId = match[1];
  });

  await page.goto("/");
  await page.getByRole("button", { name: /初級/ }).click();
  await page.getByRole("button", { name: /API が寝落ち/ }).click();
  await page.getByRole("checkbox", { name: /録画し、振り返りに使うことに同意する/ }).check();
  await page.getByRole("button", { name: "開始" }).click();
  const canvas = page.getByLabel("録画対象のゲーム画面");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  if (!box) return;
  const retireX = box.x + ((1370 + 70) / 1920) * box.width;
  const retireY = box.y + ((878 + 48) / 1080) * box.height;
  await page.mouse.click(retireX, retireY);
  await expect(page.getByRole("heading", { name: "リプレイ動画とタイムライン" })).toBeVisible({ timeout: 15000 });
  await expect.poll(() => replayId).toBeTruthy();

  await page.goto(`/?replay=${encodeURIComponent(replayId!)}`);
  await expect(page.getByRole("button", { name: "共有リンクをコピー" })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "タイムライン" })).toBeVisible();
});
