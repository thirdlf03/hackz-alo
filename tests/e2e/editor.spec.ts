import {expect, test} from '@playwright/test';
import {
  acceptRecordingConsent,
  clickCenterTool,
  clickEditorFile,
  openDefaultScenarioBriefing,
  retireFromGame,
  setSaveRecording,
  startGameFromBriefing,
  waitForReplayButton,
  waitForReplayEvents,
  waitForRetireResult,
  waitForTerminalCommand,
} from './helpers.js';

test('editor file open edit save updates sandbox file and replay timeline', async ({
  page,
  request,
}) => {
  const session = await openDefaultScenarioBriefing(page);
  await acceptRecordingConsent(page);
  await setSaveRecording(page, false);
  await startGameFromBriefing(page);

  const filePath = '/workspace/run/gate2-editor-e2e.txt';
  const marker = `gate2-editor-${Date.now()}`;
  await waitForTerminalCommand(
    page,
    `mkdir -p /workspace/run && printf "seed\\n" > ${filePath}`
  );

  const filesResponse = await request.get(
    `/api/sessions/${encodeURIComponent(session.sessionId)}/files`,
    {headers: {authorization: `Bearer ${session.writeToken}`}}
  );
  expect(filesResponse.ok()).toBeTruthy();
  const filesPayload = await filesResponse.json();
  expect(
    filesPayload.data.files.some(
      (file: {path: string}) => file.path === filePath
    )
  ).toBe(true);

  await clickCenterTool(page, 'editor');
  const editor = page.getByRole('textbox', {name: /を編集$/});
  await expect(editor).toBeVisible({timeout: 30_000});

  let openedPath: string | undefined;
  for (let index = 0; index < 14; index += 1) {
    await clickEditorFile(page, index);
    await expect(editor).toBeEnabled({timeout: 30_000});
    const label = await editor.getAttribute('aria-label');
    if (label === `${filePath} を編集`) {
      openedPath = filePath;
      break;
    }
  }
  expect(openedPath).toBe(filePath);

  await editor.click();
  await editor.fill(marker);
  await expect(editor).toHaveValue(marker);
  const saveCombo = process.platform === 'darwin' ? 'Meta+s' : 'Control+s';
  await editor.press(saveCombo);
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `/api/sessions/${encodeURIComponent(session.sessionId)}/file?path=${encodeURIComponent(openedPath!)}`,
          {headers: {authorization: `Bearer ${session.writeToken}`}}
        );
        if (!response.ok()) return '';
        const payload = await response.json();
        return payload.ok ? (payload.data.content as string) : '';
      },
      {timeout: 30_000}
    )
    .toContain(marker);

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
          event.type === 'file_saved' && (event.summary ?? '').length > 0
      )
  );
});
