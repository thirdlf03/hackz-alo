import { chromium } from "playwright";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:5173";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto(baseUrl);
  await page.getByRole("button", { name: /初級/ }).click();
  await page.getByRole("button", { name: "開始" }).click();
  const canvas = page.getByLabel("録画対象のゲーム画面");
  await canvas.waitFor({ state: "visible", timeout: 30_000 });
  await canvas.click();
  await page.waitForTimeout(3000);

  await page.keyboard.type("sleep 30");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  await page.keyboard.press("Control+C");
  await page.waitForTimeout(2000);

  console.log("debug-terminal-sigint: done");
} finally {
  await browser.close();
}
