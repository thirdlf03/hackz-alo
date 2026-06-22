import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /perf\.spec\.ts/,
  timeout: 120_000,
  expect: {timeout: 15_000},
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    actionTimeout: 15_000,
    screenshot: 'only-on-failure',
  },
});
