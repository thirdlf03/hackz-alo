import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  appendRecentSay,
  buildNpcReplyPrompt,
  filterNpcReply,
  NPC_NAME,
  NPC_RECENT_SAY_LIMIT,
  NPC_RESPONSE_SCHEMA,
  parseNpcReply,
} = await tsImport('../../apps/web/src/pure/npcColleague.ts', import.meta.url);

const overview = {
  scenario: {
    id: 's1',
    title: 'API が寝落ちした夜',
    difficulty: 'beginner',
    status: 'running',
  },
  clock: {elapsedSeconds: 30, timeLimitSeconds: 300, speed: 1},
  metrics: {
    source: 'live',
    cpu: 90,
    memory: 20,
    disk: 10,
    http5xxRate: 0.5,
    latencyP95Ms: 900,
    rps: 12,
    dbConnections: 3,
    queueDepth: 0,
  },
  serviceHealth: {},
  alerts: [{severity: 'critical', message: 'CPU 90%'}],
  terminal: {recentLines: [], recentCommands: []},
  tasks: [],
  incidentLog: [],
  injects: [],
  participants: [],
};

test('NPC_RESPONSE_SCHEMA constrains say/suggestTask only', () => {
  assert.equal(NPC_RESPONSE_SCHEMA.type, 'object');
  assert.deepEqual(Object.keys(NPC_RESPONSE_SCHEMA.properties), [
    'say',
    'suggestTask',
  ]);
  assert.equal(NPC_RESPONSE_SCHEMA.additionalProperties, false);
});

test('parseNpcReply parses plain json', () => {
  const reply = parseNpcReply(
    '{"say":"CPUが90%です。プロセスを見ます","suggestTask":"api プロセスの状態確認"}'
  );
  assert.deepEqual(reply, {
    say: 'CPUが90%です。プロセスを見ます',
    suggestTask: 'api プロセスの状態確認',
  });
});

test('parseNpcReply extracts json wrapped in prose/code fences', () => {
  const reply = parseNpcReply(
    '了解です!\n```json\n{"say":"見てみます","suggestTask":""}\n```'
  );
  assert.deepEqual(reply, {say: '見てみます'});
});

test('parseNpcReply drops empty strings and rejects garbage', () => {
  assert.equal(parseNpcReply('{"say":"","suggestTask":"  "}'), undefined);
  assert.equal(parseNpcReply('not json at all'), undefined);
  assert.equal(parseNpcReply('[1,2,3]'), undefined);
});

test('parseNpcReply caps overly long text', () => {
  const long = 'あ'.repeat(500);
  const reply = parseNpcReply(JSON.stringify({say: long, suggestTask: long}));
  assert.ok(reply.say.length <= 160);
  assert.ok(reply.suggestTask.length <= 80);
});

test('filterNpcReply drops repeated says and duplicate tasks', () => {
  assert.equal(
    filterNpcReply(
      {say: '同じ発言', suggestTask: '既存タスク'},
      ['同じ発言'],
      ['既存タスク']
    ),
    undefined
  );
  assert.deepEqual(
    filterNpcReply(
      {say: '新しい発言', suggestTask: '既存タスク'},
      [],
      ['既存タスク']
    ),
    {say: '新しい発言'}
  );
});

test('appendRecentSay keeps only the newest entries', () => {
  let recent = [];
  for (let i = 0; i < NPC_RECENT_SAY_LIMIT + 3; i++) {
    recent = appendRecentSay(recent, `say-${String(i)}`);
  }
  assert.equal(recent.length, NPC_RECENT_SAY_LIMIT);
  assert.equal(recent.at(-1), `say-${String(NPC_RECENT_SAY_LIMIT + 2)}`);
});

test('NPC_NAME is a stable display name', () => {
  assert.equal(typeof NPC_NAME, 'string');
  assert.ok(NPC_NAME.length > 0);
});

test('buildNpcReplyPrompt embeds overview json and the player message', () => {
  const prompt = buildNpcReplyPrompt(overview, 'ソラ、状況どう?', []);
  assert.ok(prompt.includes('API が寝落ちした夜'));
  assert.ok(prompt.includes('ソラ、状況どう?'));
});

test('buildNpcReplyPrompt includes repetition note only when recent says exist', () => {
  const withRecent = buildNpcReplyPrompt(overview, 'ソラ、状況どう?', [
    'CPUが高いですね',
  ]);
  assert.ok(withRecent.includes('繰り返さないで'));
  assert.ok(withRecent.includes('CPUが高いですね'));

  const withoutRecent = buildNpcReplyPrompt(overview, 'ソラ、状況どう?', []);
  assert.ok(!withoutRecent.includes('繰り返さないで'));
});
