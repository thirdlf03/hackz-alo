import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {askAboutSnapshot, checkAssistAvailability, createAssistantSession} =
  await tsImport(
    '../../apps/web/src/effect/promptAssistant.ts',
    import.meta.url
  );

const originalLanguageModel = globalThis.LanguageModel;

afterEach(() => {
  if (originalLanguageModel === undefined) {
    delete globalThis.LanguageModel;
  } else {
    globalThis.LanguageModel = originalLanguageModel;
  }
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
  assert.deepEqual(received[0].content[1], {type: 'image', value: canvas});
  assert.equal(received[0].content[1].value, canvas);
});
