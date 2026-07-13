import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';
import {createRouteHarness, json} from './helpers/routeHarness.mjs';

const {registerReplayRoutes} = await tsImport(
  '../../apps/worker/src/routes/replayRoutes.ts',
  import.meta.url
);
const {hashWriteToken} = await tsImport(
  '../../apps/worker/src/pure/writeAuth.ts',
  import.meta.url
);

test('private replay read routes reject missing credentials', async () => {
  const {app, env} = await createReplayHarness();
  const privateReadPaths = [
    '/api/replays/repl_private',
    '/api/replays/repl_private/video',
    '/api/replays/repl_private/chunks',
    '/api/replays/repl_private/chunks/0',
    '/api/replays/repl_private/events',
    '/api/replays/repl_private/thumbnail',
    '/api/replays/repl_private/comments',
  ];

  for (const path of privateReadPaths) {
    const response = await app.fetch(new Request(`http://test${path}`), env);
    assert.equal(response.status, 401, path);
  }

  const commentResponse = await app.fetch(
    new Request('http://test/api/replays/repl_private/comments', {
      method: 'POST',
      body: JSON.stringify({atMs: 1, body: 'blocked'}),
      headers: {'content-type': 'application/json'},
    }),
    env
  );
  assert.equal(commentResponse.status, 401);
});

test('write token can read private replay metadata, media, events, and comments', async () => {
  const {app, env} = await createReplayHarness();
  const headers = {authorization: 'Bearer writer-token'};

  const metadata = await json(
    await app.fetch(
      new Request('http://test/api/replays/repl_private', {headers}),
      env
    )
  );
  assert.equal(metadata.ok, true);
  assert.equal(metadata.data.id, 'repl_private');

  const events = await json(
    await app.fetch(
      new Request('http://test/api/replays/repl_private/events', {headers}),
      env
    )
  );
  assert.equal(events.ok, true);
  assert.deepEqual(events.data.map((event) => event.visibility).toSorted(), [
    'private',
    'public_safe',
  ]);

  const comments = await json(
    await app.fetch(
      new Request('http://test/api/replays/repl_private/comments', {headers}),
      env
    )
  );
  assert.equal(comments.ok, true);
  assert.equal(comments.data[0].body, 'private comment');

  const video = await app.fetch(
    new Request('http://test/api/replays/repl_private/video', {headers}),
    env
  );
  assert.equal(video.status, 200);
  assert.equal(video.headers.get('content-type'), 'video/webm');
});

test('public replay reads filter private events and featured list excludes private replays', async () => {
  const {app, env} = await createReplayHarness();

  const events = await json(
    await app.fetch(
      new Request('http://test/api/replays/repl_public/events'),
      env
    )
  );
  assert.equal(events.ok, true);
  assert.deepEqual(
    events.data.map((event) => event.visibility),
    ['public_safe']
  );

  const featured = await json(
    await app.fetch(new Request('http://test/api/replays/featured'), env)
  );
  assert.equal(featured.ok, true);
  assert.deepEqual(
    featured.data.map((replay) => replay.id),
    ['repl_public']
  );
});

test('read token can read unlisted replay without write token', async () => {
  const {app, env} = await createReplayHarness();
  const response = await json(
    await app.fetch(
      new Request(
        'http://test/api/replays/repl_unlisted?readToken=reader-token'
      ),
      env
    )
  );
  assert.equal(response.ok, true);
  assert.equal(response.data.id, 'repl_unlisted');
});

test('write token can issue replay share link with scope and expiry', async () => {
  const {app, env, replays} = await createReplayHarness();
  const response = await json(
    await app.fetch(
      new Request('http://test/api/replays/repl_private/share-links', {
        method: 'POST',
        headers: {
          authorization: 'Bearer writer-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ttlHours: 48}),
      }),
      env
    )
  );
  assert.equal(response.ok, true);
  assert.equal(response.data.scope, 'read');
  assert.equal(response.data.visibility, 'unlisted');
  assert.match(response.data.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(response.data.sharePath, /^\/\?replay=repl_private&readToken=/);
  assert.equal(typeof response.data.readToken, 'string');
  assert.equal(replays.get('repl_private').visibility, 'unlisted');

  const readResponse = await json(
    await app.fetch(
      new Request(
        `http://test/api/replays/repl_private?readToken=${encodeURIComponent(response.data.readToken)}`
      ),
      env
    )
  );
  assert.equal(readResponse.ok, true);
  assert.equal(readResponse.data.id, 'repl_private');
});

test('protected replay event upload rejects malformed auth and malformed body independently', async () => {
  const {app, env} = await createReplayHarness();
  const path = 'http://test/api/replays/repl_private/events?seq=0';

  const badAuth = await app.fetch(
    new Request(path, {
      method: 'POST',
      headers: {
        authorization: 'Bearer wrong-token',
        'content-type': 'application/json',
      },
      body: '{',
    }),
    env
  );
  assert.equal(badAuth.status, 401);

  const malformedJson = await json(
    await app.fetch(
      new Request(path, {
        method: 'POST',
        headers: {
          authorization: 'Bearer writer-token',
          'content-type': 'application/json',
        },
        body: '{',
      }),
      env
    )
  );
  assert.equal(malformedJson.ok, false);
  assert.equal(malformedJson.error.code, 'bad_request');
  assert.match(malformedJson.error.message, /invalid json/);

  const unknownType = await json(
    await app.fetch(
      new Request(path, {
        method: 'POST',
        headers: {
          authorization: 'Bearer writer-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify([
          {
            id: 'evt_bad',
            type: 'unknown',
            at: 0,
            actor: 'player',
            payload: {},
            visibility: 'public_safe',
          },
        ]),
      }),
      env
    )
  );
  assert.equal(unknownType.ok, false);
  assert.equal(unknownType.error.code, 'bad_request');
  assert.match(unknownType.error.message, /unknown event type/);

  const oversized = await json(
    await app.fetch(
      new Request(path, {
        method: 'POST',
        headers: {
          authorization: 'Bearer writer-token',
          'content-type': 'application/json',
        },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(300 * 1024));
            controller.close();
          },
        }),
        duplex: 'half',
      }),
      env
    )
  );
  assert.equal(oversized.ok, false);
  assert.equal(oversized.error.code, 'payload_too_large');
});

async function createReplayHarness() {
  const writerHash = await hashWriteToken('writer-token');
  const readerHash = await hashWriteToken('reader-token');
  const replays = new Map(
    ['repl_private', 'repl_public', 'repl_unlisted'].map((id) => [
      id,
      replayRow({
        id,
        visibility:
          id === 'repl_public'
            ? 'public'
            : id === 'repl_unlisted'
              ? 'unlisted'
              : 'private',
        featured: id === 'repl_unlisted' ? 0 : 1,
      }),
    ])
  );
  const readTokens = new Map([
    [
      'repl_unlisted',
      new Map([[readerHash, {expiresAt: '2099-01-01T00:00:00.000Z'}]]),
    ],
  ]);
  const env = {
    DB: fakeDb({
      replays,
      writeTokenHash: writerHash,
      readTokenHash: readerHash,
      readTokens,
    }),
    REPLAY_BUCKET: fakeReplayBucket(),
  };
  const app = createRouteHarness(env);
  registerReplayRoutes(app);
  return {app, env, replays, readTokens};
}

function replayRow({id, visibility, featured}) {
  return {
    id,
    session_id: `sess_${id}`,
    scenario_id: 'disk-full-001',
    difficulty: 'beginner',
    started_at: '2026-06-20T00:00:00.000Z',
    finished_at: null,
    duration_ms: null,
    result: null,
    ending_id: null,
    video_object_key: null,
    event_log_object_key: null,
    thumbnail_object_key: `replays/${id}/thumbnail.webp`,
    featured,
    visibility,
    browser_info_json: null,
    recording_status: 'ready',
    mime_type: 'video/webm',
    created_at: '2026-06-20T00:00:00.000Z',
    updated_at: '2026-06-20T00:00:00.000Z',
    video_duration_ms: null,
    consent_recorded_at: null,
  };
}

function fakeDb({replays, writeTokenHash, readTokenHash, readTokens}) {
  const events = new Map(
    [...replays.keys()].map((replayId) => [
      replayId,
      [
        {
          event_id: `${replayId}_public`,
          type: 'session_start',
          at_ms: 0,
          summary: 'session_start',
          visibility: 'public_safe',
        },
        {
          event_id: `${replayId}_private`,
          type: 'terminal_input',
          at_ms: 1,
          summary: 'command: secret',
          visibility: 'private',
        },
      ],
    ])
  );
  return {
    prepare(sql) {
      return {
        binds: [],
        bind(...values) {
          this.binds = values;
          return this;
        },
        async first() {
          const replayId = this.binds[0];
          if (sql.includes('from replays') && sql.includes('where id = ?')) {
            return replays.get(replayId) ?? null;
          }
          if (sql.includes('from play_sessions')) {
            return replays.has(replayId)
              ? {write_token_hash: writeTokenHash}
              : null;
          }
          if (sql.includes('from replay_read_tokens')) {
            const tokenHash = this.binds[1];
            const now = this.binds[2];
            const replayTokens = readTokens.get(replayId);
            const stored = replayTokens?.get(tokenHash);
            return stored && now < stored.expiresAt
              ? {token_hash: tokenHash}
              : null;
          }
          if (sql.includes('from replay_chunks')) {
            return {
              object_key: `replays/${replayId}/chunks/000000.webm`,
            };
          }
          return null;
        },
        async all() {
          const replayId = this.binds[0];
          if (sql.includes('from replay_events_index')) {
            const rows = events.get(replayId) ?? [];
            return {
              results: sql.includes("visibility = 'public_safe'")
                ? rows.filter((event) => event.visibility === 'public_safe')
                : rows,
            };
          }
          if (sql.includes('from replay_comments')) {
            return {
              results: [
                {
                  id: 'cmt_1',
                  at_ms: 1,
                  body: 'private comment',
                  created_at: '2026-06-20T00:00:00.000Z',
                },
              ],
            };
          }
          if (sql.includes('from replay_chunks')) {
            return {
              results: [
                {
                  seq: 0,
                  object_key: `replays/${replayId}/chunks/000000.webm`,
                  byte_size: 5,
                  started_at_ms: 0,
                  ended_at_ms: 1,
                },
              ],
            };
          }
          if (sql.includes('from replays') && sql.includes('featured = 1')) {
            return {
              results: [...replays.values()]
                .filter(
                  (replay) =>
                    replay.featured === 1 && replay.visibility === 'public'
                )
                .map((replay) => ({
                  id: replay.id,
                  scenario_id: replay.scenario_id,
                  difficulty: replay.difficulty,
                  result: replay.result,
                  duration_ms: replay.duration_ms,
                  video_duration_ms: replay.video_duration_ms,
                  thumbnail_object_key: replay.thumbnail_object_key,
                  created_at: replay.created_at,
                })),
            };
          }
          return {results: []};
        },
        async run() {
          if (sql.includes('insert into replay_read_tokens')) {
            const [id, replayId, tokenHash, , expiresAt] = this.binds;
            const tokens = readTokens.get(replayId) ?? new Map();
            tokens.set(tokenHash, {id, expiresAt});
            readTokens.set(replayId, tokens);
            return {};
          }
          if (sql.includes('update replays') && sql.includes('visibility')) {
            const [visibility, , replayId] = this.binds;
            const replay = replays.get(replayId);
            if (replay) replay.visibility = visibility;
            return {};
          }
          return {};
        },
      };
    },
  };
}

function fakeReplayBucket() {
  return {
    async head() {
      return {
        size: 5,
        httpMetadata: {contentType: 'video/webm'},
      };
    },
    async get(key) {
      return {
        body: new Blob([key.includes('thumbnail') ? 'image' : 'video']),
        httpMetadata: {
          contentType: key.includes('thumbnail') ? 'image/webp' : 'video/webm',
        },
      };
    },
  };
}
