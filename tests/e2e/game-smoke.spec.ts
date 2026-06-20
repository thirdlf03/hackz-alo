import { test, expect } from "@playwright/test";

test("game canvas renders first viewport", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /API が寝落ちした夜/ }).click();
  await page.getByRole("button", { name: "開始" }).click();
  const canvas = page.getByLabel("録画対象のゲーム画面");
  await expect(canvas).toBeVisible();
});
