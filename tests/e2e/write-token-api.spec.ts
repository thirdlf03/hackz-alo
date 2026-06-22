import {test, expect} from '@playwright/test';

test('session create returns write token used by protected routes', async ({
  request,
}) => {
  const createResponse = await request.post('/api/sessions', {
    data: {scenarioId: 'disk-full-001'},
  });
  expect(createResponse.ok()).toBeTruthy();
  const payload = await createResponse.json();
  expect(payload.ok).toBe(true);
  expect(payload.data.writeToken).toBeTruthy();
  expect(payload.data.sessionId).toMatch(/^sess_/);
  expect(payload.data.replayId).toMatch(/^repl_/);

  const replayId = payload.data.replayId as string;
  const unauthChunk = await request.post(
    `/api/replays/${encodeURIComponent(replayId)}/events?seq=0`,
    {
      data: [{id: 'evt_test', type: 'player_note', at: 0, actor: 'player'}],
      headers: {'content-type': 'application/json'},
    }
  );
  expect(unauthChunk.status()).toBe(401);

  const authedChunk = await request.post(
    `/api/replays/${encodeURIComponent(replayId)}/events?seq=0`,
    {
      data: [
        {
          id: 'evt_test',
          replayId,
          type: 'player_note',
          at: 0,
          actor: 'player',
          payload: {},
          visibility: 'public_safe',
        },
      ],
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${payload.data.writeToken as string}`,
      },
    }
  );
  expect(authedChunk.ok()).toBeTruthy();
});
