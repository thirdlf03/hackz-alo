import {test} from '@playwright/test';
import {
  acceptRecordingConsent,
  focusGameCanvas,
  openDemoScenarioBriefing,
  retireFromGame,
  runTerminalCommand,
  setSaveRecording,
  startGameFromBriefing,
  waitForReplayButton,
  waitForReplayEvents,
  waitForRetireResult,
  waitForTerminalCommand,
} from './helpers.js';

test.describe.configure({mode: 'serial'});

test('terminal command input records command_detected on replay timeline', async ({
  page,
  request,
}) => {
  const session = await openDemoScenarioBriefing(page);
  await acceptRecordingConsent(page);
  await setSaveRecording(page, false);
  await startGameFromBriefing(page);

  await waitForTerminalCommand(page, 'echo gate2-terminal-command');
  await retireFromGame(page);
  await waitForRetireResult(page);
  await waitForReplayButton(page);

  await waitForReplayEvents(
    request,
    session.replayId,
    session.writeToken,
    (events) =>
      events.some(
        (event) =>
          event.type === 'command_detected' &&
          (event.summary ?? '').includes('echo gate2-terminal-command')
      )
  );
});

test('terminal interrupt recovers prompt for another command', async ({
  page,
  request,
}) => {
  const session = await openDemoScenarioBriefing(page);
  await acceptRecordingConsent(page);
  await setSaveRecording(page, false);
  await startGameFromBriefing(page);

  await waitForTerminalCommand(page, 'sleep 30');
  await focusGameCanvas(page);
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(1_500);
  await runTerminalCommand(page, 'echo gate2-terminal-recovered');
  await retireFromGame(page);
  await waitForRetireResult(page);
  await waitForReplayButton(page);

  await waitForReplayEvents(
    request,
    session.replayId,
    session.writeToken,
    (events) =>
      events.some(
        (event) =>
          event.type === 'command_detected' &&
          (event.summary ?? '').includes('gate2-terminal-recovered')
      )
  );
});
