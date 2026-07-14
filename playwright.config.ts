import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testIgnore: '**/perf.spec.ts',
  timeout: 120_000,
  expect: {timeout: 15_000},
  // 並列化を workers=2 で実測したところ壁時計時間が悪化しフレークも増加したため 1 に据え置き。
  // 詳細: PR本文/作業ログ参照(sandboxリソース共有下での資源競合が原因と推定)。
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm run dev',
    env: {
      INCIDENT_DISABLE_TURNSTILE: '1',
      VITE_TURNSTILE_SITE_KEY: '',
    },
    url: 'http://127.0.0.1:5173/api/scenarios',
    reuseExistingServer: !process.env.CI,
    timeout: process.env.CI ? 300_000 : 180_000,
  },
});
