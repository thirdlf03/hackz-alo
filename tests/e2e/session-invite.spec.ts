import {expect, test} from '@playwright/test';

const DEMO_SCENARIO = /デモ: 1分復旧ドリル/;

test.describe.configure({mode: 'serial'});

test('inviting a second participant joins the same session lobby', async ({
  browser,
}) => {
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();

  // Avoid touching the real OS clipboard (flaky/permission-gated in
  // headless CI): capture what the app writes via navigator.clipboard.
  await pageA.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          (window as unknown as {__copiedText?: string}).__copiedText = text;
          return Promise.resolve();
        },
      },
    });
  });

  await pageA.goto('/');
  await pageA.getByRole('button', {name: /初級/}).click();
  const sessionResponse = pageA.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/sessions$/.test(new URL(response.url()).pathname) &&
      response.ok(),
    {timeout: 90_000}
  );
  await pageA.getByRole('button', {name: DEMO_SCENARIO}).click();
  await sessionResponse;

  await expect(
    pageA.getByRole('heading', {name: DEMO_SCENARIO})
  ).toBeVisible({timeout: 30_000});

  const inviteButton = pageA.getByRole('button', {
    name: '招待リンクをコピー',
  });
  await expect(inviteButton).toBeEnabled({timeout: 30_000});
  await inviteButton.click();

  await expect
    .poll(
      () =>
        pageA.evaluate(
          () => (window as unknown as {__copiedText?: string}).__copiedText
        ),
      {timeout: 15_000}
    )
    .toBeTruthy();
  const inviteUrl = await pageA.evaluate(
    () => (window as unknown as {__copiedText?: string}).__copiedText
  );
  expect(inviteUrl).toContain('join=');
  expect(inviteUrl).toContain('wt=');

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await pageB.goto(inviteUrl ?? '/');

  await expect(
    pageB.getByRole('heading', {name: DEMO_SCENARIO})
  ).toBeVisible({timeout: 30_000});
  // The invite tokens must not linger in the joiner's address bar.
  expect(new URL(pageB.url()).searchParams.get('join')).toBeNull();
  expect(new URL(pageB.url()).searchParams.get('wt')).toBeNull();

  await expect(pageA.locator('.participant-row')).toHaveCount(2, {
    timeout: 30_000,
  });
  await expect(pageB.locator('.participant-row')).toHaveCount(2, {
    timeout: 30_000,
  });

  await contextA.close();
  await contextB.close();
});

test('host advancing the exercise phase carries the guest along into briefing and play', async ({
  browser,
}) => {
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();

  await pageA.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          (window as unknown as {__copiedText?: string}).__copiedText = text;
          return Promise.resolve();
        },
      },
    });
  });

  await pageA.goto('/');
  await pageA.getByRole('button', {name: /初級/}).click();
  const sessionResponse = pageA.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/sessions$/.test(new URL(response.url()).pathname) &&
      response.ok(),
    {timeout: 90_000}
  );
  await pageA.getByRole('button', {name: DEMO_SCENARIO}).click();
  await sessionResponse;

  await expect(
    pageA.getByRole('heading', {name: DEMO_SCENARIO})
  ).toBeVisible({timeout: 30_000});

  const inviteButton = pageA.getByRole('button', {
    name: '招待リンクをコピー',
  });
  await expect(inviteButton).toBeEnabled({timeout: 30_000});
  await inviteButton.click();
  await expect
    .poll(
      () =>
        pageA.evaluate(
          () => (window as unknown as {__copiedText?: string}).__copiedText
        ),
      {timeout: 15_000}
    )
    .toBeTruthy();
  const inviteUrl = await pageA.evaluate(
    () => (window as unknown as {__copiedText?: string}).__copiedText
  );

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await pageB.goto(inviteUrl ?? '/');

  await expect(
    pageB.getByRole('heading', {name: DEMO_SCENARIO})
  ).toBeVisible({timeout: 30_000});

  await expect(pageA.locator('.participant-row')).toHaveCount(2, {
    timeout: 30_000,
  });
  await expect(pageB.locator('.participant-row')).toHaveCount(2, {
    timeout: 30_000,
  });

  // The lobby -> briefing gate requires every online, non-observer
  // participant to be ready once there is more than one of them.
  await pageA.getByRole('button', {name: 'Ready'}).click();
  await pageB.getByRole('button', {name: 'Ready'}).click();

  // Only the host (session creator) gets the phase-advance control; the
  // guest sees a waiting message instead (host_required gate on the server).
  await expect(
    pageB.getByText('ホストの開始を待っています', {exact: true})
  ).toBeVisible();

  const continueButton = pageA.getByRole('button', {name: 'ブリーフィングへ'});
  await expect(continueButton).toBeEnabled({timeout: 30_000});
  await continueButton.click();

  // The guest follows into the briefing screen purely from the server's
  // exercise-phase broadcast, without touching any local control itself.
  await expect(
    pageB.getByText('ホストの開始を待っています…', {exact: true})
  ).toBeVisible({timeout: 30_000});
  await expect(pageA.getByRole('button', {name: '開始'})).toBeVisible({
    timeout: 90_000,
  });

  await pageA
    .getByRole('checkbox', {name: /録画し、振り返りに使うことに同意する/})
    .check();

  await Promise.all([
    pageA.waitForResponse(
      (response) =>
        response.url().includes('/start') &&
        response.request().method() === 'POST' &&
        response.ok(),
      {timeout: 90_000}
    ),
    pageA.getByRole('button', {name: '開始'}).click(),
  ]);

  await expect(pageA.getByLabel('録画対象のゲーム画面')).toBeVisible({
    timeout: 30_000,
  });
  // The guest transitions to the play screen from the same exercise_state
  // SSE broadcast the host's /start triggers, never calling /start itself.
  // The whole game (including the terminal/sandbox mirror) renders inside a
  // single <canvas>, so there is no DOM element to assert the guest's shared
  // terminal actually connected without adding new debug instrumentation;
  // asserting the canvas mounts is the practical limit for this E2E check.
  await expect(pageB.getByLabel('録画対象のゲーム画面')).toBeVisible({
    timeout: 60_000,
  });

  await contextA.close();
  await contextB.close();
});
