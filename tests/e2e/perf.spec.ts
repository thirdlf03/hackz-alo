import {mkdir, writeFile} from 'node:fs/promises';
import {expect, test} from '@playwright/test';
import {
  acceptRecordingConsent,
  openDefaultScenarioBriefing,
  setSaveRecording,
  startGameFromBriefing,
} from './helpers.js';

test('perf journey exposes marks and browser snapshot', async ({page}) => {
  await openDefaultScenarioBriefing(page);
  await acceptRecordingConsent(page);
  await setSaveRecording(page, false);
  await startGameFromBriefing(page);

  await expect
    .poll(
      async () => {
        const snapshot = await page.evaluate(() =>
          window.__incidentPerf?.snapshot()
        );
        return Boolean(
          snapshot?.marks.some(
            (mark) =>
              mark.name === 'incident.app.journey.canvas_first_draw' ||
              mark.name === 'incident.app.journey.terminal_ready'
          )
        );
      },
      {timeout: 30_000}
    )
    .toBe(true);

  const snapshot = await page.evaluate(() => window.__incidentPerf?.snapshot());
  expect(snapshot?.enabled).toBe(true);
  expect(snapshot?.frameSamples.length).toBeGreaterThan(0);
  expect(
    snapshot?.marks.some(
      (mark) => mark.name === 'incident.app.journey.game_started'
    )
  ).toBe(true);

  await mkdir('perf-reports', {recursive: true});
  await writeFile(
    'perf-reports/browser-snapshot.json',
    JSON.stringify(snapshot, null, 2)
  );
});
