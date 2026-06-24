import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  readJsonBody,
  readJsonObjectBody,
  readRequestBody,
  RequestBodyError,
  requestBodyErrorResponse,
} = await tsImport('../../apps/worker/src/http/body.ts', import.meta.url);

test('readRequestBody enforces streaming body size without content-length', async () => {
  const request = new Request('http://test/upload', {
    method: 'POST',
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(4));
        controller.enqueue(new Uint8Array(4));
        controller.close();
      },
    }),
    duplex: 'half',
  });

  await assert.rejects(
    () => readRequestBody(request, 7),
    (error) => {
      assert.equal(error instanceof RequestBodyError, true);
      assert.equal(error.status, 413);
      assert.equal(error.code, 'payload_too_large');
      return true;
    }
  );
});

test('readJsonBody returns stable errors for invalid and empty bodies', async () => {
  await assert.rejects(
    () =>
      readJsonBody(
        new Request('http://test/json', {method: 'POST', body: '{'}),
        1024
      ),
    (error) => {
      assert.equal(error instanceof RequestBodyError, true);
      assert.equal(error.status, 400);
      assert.equal(error.code, 'bad_request');
      return true;
    }
  );
  assert.deepEqual(
    await readJsonBody(
      new Request('http://test/json', {method: 'POST', body: ''}),
      1024,
      {emptyValue: {}}
    ),
    {}
  );
});

test('readJsonObjectBody rejects valid json that is not an object', async () => {
  await assert.rejects(
    () =>
      readJsonObjectBody(
        new Request('http://test/json', {method: 'POST', body: 'null'}),
        1024
      ),
    (error) => {
      assert.equal(error instanceof RequestBodyError, true);
      assert.equal(error.status, 400);
      assert.equal(error.code, 'bad_request');
      assert.match(error.message, /json object/);
      return true;
    }
  );

  assert.deepEqual(
    await readJsonObjectBody(
      new Request('http://test/json', {method: 'POST', body: ''}),
      1024,
      {emptyValue: {}}
    ),
    {}
  );
});

test('requestBodyErrorResponse returns stable API error envelope', async () => {
  const c = {
    json(payload, status) {
      return new Response(JSON.stringify(payload), {status});
    },
  };
  const response = requestBodyErrorResponse(
    c,
    new RequestBodyError(413, 'payload_too_large', 'request body too large')
  );
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {code: 'payload_too_large', message: 'request body too large'},
  });
});

test('readRouteJsonObject maps body errors to route responses', async () => {
  const {readRouteJsonObject} = await tsImport(
    '../../apps/worker/src/http/routeBody.ts',
    import.meta.url
  );
  const c = {
    req: {
      raw: new Request('http://test/json', {method: 'POST', body: '[]'}),
    },
    json(payload, status) {
      return new Response(JSON.stringify(payload), {status});
    },
  };
  const response = await readRouteJsonObject(c, 1024);
  assert.equal(response instanceof Response, true);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {code: 'bad_request', message: 'request body must be a json object'},
  });
});
