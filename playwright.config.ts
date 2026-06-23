import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testIgnore: '**/perf.spec.ts',
  timeout: 120_000,
  expect: {timeout: 15_000},
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    actionTimeout: 15_000,
    trace: 'on-first-retry',
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
