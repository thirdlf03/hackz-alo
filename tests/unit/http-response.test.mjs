import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {err, errorResponse, HttpError, jsonErr, jsonOk, messageFrom, ok} =
  await tsImport('../../apps/worker/src/http/response.ts', import.meta.url);

test('ok and err build API result envelopes', () => {
  assert.deepEqual(ok({value: 1}), {ok: true, data: {value: 1}});
  assert.deepEqual(err('bad_request', 'invalid input'), {
    ok: false,
    error: {code: 'bad_request', message: 'invalid input'},
  });
});

test('jsonOk and jsonErr serialize API responses', async () => {
  const success = jsonOk({value: 1}, {status: 201, headers: {'x-test': '1'}});
  assert.equal(success.status, 201);
  assert.equal(success.headers.get('x-test'), '1');
  assert.match(success.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await success.json(), {ok: true, data: {value: 1}});

  const failure = jsonErr('teapot', 'short and stout', 418);
  assert.equal(failure.status, 418);
  assert.deepEqual(await failure.json(), {
    ok: false,
    error: {code: 'teapot', message: 'short and stout'},
  });
});

test('errorResponse preserves HttpError details and normalizes unknown errors', async () => {
  const notFound = errorResponse(new HttpError(404, 'not_found', 'missing'));
  assert.equal(notFound.status, 404);
  assert.deepEqual(await notFound.json(), {
    ok: false,
    error: {code: 'not_found', message: 'missing'},
  });

  const internal = errorResponse(new Error('boom'));
  assert.equal(internal.status, 500);
  assert.deepEqual(await internal.json(), {
    ok: false,
    error: {code: 'internal_error', message: 'boom'},
  });
  assert.equal(messageFrom('nope'), 'session request failed');
});
