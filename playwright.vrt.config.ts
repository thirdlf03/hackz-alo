import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: 'tests/vrt',
  timeout: 120_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {maxDiffPixelRatio: 0.01, animations: 'disabled'},
  },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    actionTimeout: 15_000,
    viewport: {width: 1440, height: 900},
    deviceScaleFactor: 1,
    contextOptions: {reducedMotion: 'reduce'},
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
