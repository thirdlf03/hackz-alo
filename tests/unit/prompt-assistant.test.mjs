import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  askAssistant,
  askAboutSnapshot,
  askPreparedAssistant,
  appendSnapshot,
  captureCanvasSnapshot,
  checkAssistAvailability,
  createAssistantSession,
  createAssistantSessionPool,
} = await tsImport(
  '../../apps/web/src/effect/promptAssistant.ts',
  import.meta.url
);

const originalLanguageModel = globalThis.LanguageModel;
const originalDocument = globalThis.document;

afterEach(() => {
  if (originalLanguageModel === undefined) {
    delete globalThis.LanguageModel;
  } else {
    globalThis.LanguageModel = originalLanguageModel;
  }
  if (originalDocument === undefined) {
    delete globalThis.document;
  } else {
    globalThis.document = originalDocument;
  }
});

test('captureCanvasSnapshot uses the full canvas and downsizes through the shared path', () => {
  const harness = installCanvasHarness();
  const source = {width: 1920, height: 1080};

  const result = captureCanvasSnapshot(source);

  assert.equal(result.canvas.width, 960);
  assert.equal(result.canvas.height, 540);
  assert.equal(result.previewUrl, 'data:image/jpeg;quality=0.7');
  assert.deepEqual(harness.drawCalls, [
    [source, 0, 0, 1920, 1080, 0, 0, 960, 540],
  ]);
});

test('captureCanvasSnapshot crops a clamped source rectangle and preserves aspect ratio', () => {
  const harness = installCanvasHarness();
  const source = {width: 1920, height: 1080};

  const result = captureCanvasSnapshot(source, {
    x: 1200,
    y: 100,
    width: 1000,
    height: 500,
  });

  assert.equal(result.canvas.width, 720);
  assert.equal(result.canvas.height, 500);
  assert.deepEqual(harness.drawCalls, [
    [source, 1200, 100, 720, 500, 0, 0, 720, 500],
  ]);
});

test('captureCanvasSnapshot rejects an empty source rectangle', () => {
  installCanvasHarness();
  assert.throws(
    () =>
      captureCanvasSnapshot(
        {width: 1920, height: 1080},
        {x: 10, y: 10, width: 0, height: 100}
      ),
    /範囲が空/
  );
});

test('availability and create request Japanese and English image input capability', async () => {
  let availabilityOptions;
  let createOptions;
  const session = {
    promptStreaming() {},
    destroy() {},
  };
  globalThis.LanguageModel = {
    async availability(options) {
      availabilityOptions = options;
      return 'available';
    },
    async create(options) {
      createOptions = options;
      return session;
    },
  };

  assert.equal(await checkAssistAvailability(), 'available');
  assert.equal(await createAssistantSession(), session);

  const expectedInputs = [
    {type: 'text', languages: ['ja', 'en']},
    {type: 'image', languages: ['ja', 'en']},
  ];
  assert.deepEqual(availabilityOptions.expectedInputs, expectedInputs);
  assert.deepEqual(createOptions.expectedInputs, expectedInputs);
});

test('askAboutSnapshot sends the exact canvas as the latest multimodal evidence', () => {
  const canvas = {width: 1920, height: 1080};
  let received;
  const stream = {};
  const session = {
    promptStreaming(input) {
      received = input;
      return stream;
    },
    destroy() {},
  };

  assert.equal(askAboutSnapshot(session, '次に何を確認する?', canvas), stream);
  assert.equal(received[0].role, 'user');
  assert.match(received[0].content[0].value, /次に何を確認する\?/);
  assert.match(received[0].content[0].value, /最新の添付画像/);
  assert.match(received[0].content[0].value, /読めない文字は推測しない/);
  assert.match(received[0].content[0].value, /NEXT.*完全にコピー/);
  assert.match(received[0].content[0].value, /途中で切らないでください/);
  assert.match(
    received[0].content[0].value,
    /実行済みで解決していない場合は、チャットの助言など他の画面内のコマンドを次の一手にして/
  );
  assert.match(
    received[0].content[0].value,
    /次の一手のコマンドは画像内の文字列をそのままコピーし、画像にないコマンドを作らず/
  );
  assert.doesNotMatch(received[0].content[0].value, /1つの手順に限定/);
  assert.doesNotMatch(received[0].content[0].value, /このメッセージの最後/);
  assert.deepEqual(received[0].content[1], {type: 'image', value: canvas});
  assert.equal(received[0].content[1].value, canvas);
});

test('appendSnapshot appends an image-only user message to the session', async () => {
  const canvas = {width: 1920, height: 1080};
  let received;
  const session = {
    promptStreaming() {},
    async append(input) {
      received = input;
    },
    destroy() {},
  };

  await appendSnapshot(session, canvas);
  assert.deepEqual(received, [
    {
      role: 'user',
      content: [{type: 'image', value: canvas}],
    },
  ]);
});

test('askPreparedAssistant sends the same instruction text as askAssistant image path, without the image', () => {
  const canvas = {width: 1920, height: 1080};
  let imagePathInput;
  let preparedInput;
  const imageSession = {
    promptStreaming(input) {
      imagePathInput = input;
    },
    destroy() {},
  };
  const preparedSession = {
    promptStreaming(input) {
      preparedInput = input;
    },
    async append() {},
    destroy() {},
  };

  askAssistant(imageSession, '次にやることは?', canvas);
  askPreparedAssistant(preparedSession, '次にやることは?');

  assert.equal(preparedInput[0].role, 'user');
  assert.equal(preparedInput[0].content.length, 1);
  assert.equal(preparedInput[0].content[0].type, 'text');
  assert.equal(preparedInput[0].content[0].value, imagePathInput[0].content[0].value);
});

test('askAssistant sends text only when no screenshot is attached', () => {
  let received;
  const stream = {};
  const session = {
    promptStreaming(input) {
      received = input;
      return stream;
    },
    destroy() {},
  };

  assert.equal(askAssistant(session, '状況整理のコツは?'), stream);
  assert.deepEqual(received, [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          value:
            '画像はありません。質問文だけを根拠にしてください。回答に「画面」「画像」「添付」を含めず、具体的な数値、固有名詞、コマンドを作らないでください。\n質問: 状況整理のコツは?',
        },
      ],
    },
  ]);
});

test('assistant session pool prewarms once and clones a fresh session per ask', async () => {
  const pool = createAssistantSessionPool();
  let createCount = 0;
  let cloneCount = 0;
  let cloneDestroyed = 0;
  let resolveCreate;
  const baseSession = {
    destroy() {},
    promptStreaming() {},
    async clone() {
      cloneCount += 1;
      return {
        promptStreaming() {},
        async clone() {
          throw new Error('unexpected nested clone');
        },
        destroy() {
          cloneDestroyed += 1;
        },
      };
    },
  };
  const create = () => {
    createCount += 1;
    return new Promise((resolve) => {
      resolveCreate = resolve;
    });
  };

  const prewarm = pool.prewarm(create);
  const ask = pool.acquire(create);
  assert.equal(createCount, 1);
  resolveCreate(baseSession);
  await prewarm;
  const first = await ask;
  const second = await pool.acquire(create);
  assert.equal(createCount, 1);
  assert.equal(cloneCount, 2);
  assert.notEqual(first, second);
  pool.release(first);
  pool.release(second);
  assert.equal(cloneDestroyed, 2);
});

test('assistant session pool destroys a session that resolves after unmount', async () => {
  const pool = createAssistantSessionPool();
  let destroyed = 0;
  let resolveCreate;
  const pending = pool.prewarm(
    () =>
      new Promise((resolve) => {
        resolveCreate = resolve;
      })
  );
  pool.destroy();
  resolveCreate({
    destroy() {
      destroyed += 1;
    },
    async clone() {
      throw new Error('unexpected clone');
    },
    promptStreaming() {},
  });
  await assert.rejects(pending, /destroyed/);
  assert.equal(destroyed, 1);
  await assert.rejects(
    pool.acquire(async () => undefined),
    /destroyed/
  );
});

function installCanvasHarness() {
  const drawCalls = [];
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext(kind) {
          assert.equal(kind, '2d');
          return {
            drawImage(...args) {
              drawCalls.push(args);
            },
          };
        },
        toDataURL(type, quality) {
          return `data:${type};quality=${String(quality)}`;
        },
      };
    },
  };
  return {drawCalls};
}
