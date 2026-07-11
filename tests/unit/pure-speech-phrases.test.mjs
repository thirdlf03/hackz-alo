import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  buildSpeechPhrases,
  classifySpokenLog,
  describeSpeechLogAvailability,
  INCIDENT_LOG_KIND_LABELS,
  SPEECH_PHRASE_MAX_BOOST,
} = await tsImport('../../apps/web/src/pure/speechPhrases.ts', import.meta.url);

const scenario = {
  runbooks: [{id: 'r1', title: 'DB プール枯渇の復旧手順', body: ''}],
  exercise: {
    injects: [{id: 'i1', title: 'やまびこ API の 5xx 急増', body: ''}],
  },
  topology: {
    nodes: [
      {id: 'n1', label: 'やまびこ API', kind: 'service'},
      {id: 'n2', label: 'ユーザー', kind: 'external'},
    ],
    edges: [],
  },
};

test('buildSpeechPhrases extracts topology node labels with highest boost', () => {
  const phrases = buildSpeechPhrases(scenario);
  const yamabiko = phrases.find((p) => p.phrase === 'やまびこ API');
  assert.ok(yamabiko, 'node label should be present');
  assert.equal(yamabiko.boost, 3.0);
});

test('buildSpeechPhrases includes fixed metrics vocabulary', () => {
  const phrases = buildSpeechPhrases(scenario);
  for (const word of ['5xx', 'p95', 'レイテンシ']) {
    assert.ok(
      phrases.some((p) => p.phrase === word),
      `expected metrics vocab ${word}`
    );
  }
});

test('buildSpeechPhrases caps boost at the max and dedupes', () => {
  const phrases = buildSpeechPhrases(scenario);
  const seen = new Set();
  for (const {phrase, boost} of phrases) {
    assert.ok(boost <= SPEECH_PHRASE_MAX_BOOST, `${phrase} boost within cap`);
    assert.ok(!seen.has(phrase), `${phrase} appears once`);
    seen.add(phrase);
  }
});

test('buildSpeechPhrases tolerates an undefined scenario', () => {
  const phrases = buildSpeechPhrases(undefined);
  assert.ok(Array.isArray(phrases));
  assert.ok(phrases.length > 0, 'fixed vocabulary is always present');
});

test('classifySpokenLog maps the leading keyword to a kind', () => {
  assert.deepEqual(classifySpokenLog('仮説、DBプールが枯渇している'), {
    kind: 'hypothesis',
    body: 'DBプールが枯渇している',
  });
  assert.deepEqual(classifySpokenLog('判断。APIを再起動する'), {
    kind: 'decision',
    body: 'APIを再起動する',
  });
  assert.deepEqual(classifySpokenLog('連絡: ICへ共有済み'), {
    kind: 'comms',
    body: 'ICへ共有済み',
  });
  assert.deepEqual(classifySpokenLog('フォローアップ 監視を追加'), {
    kind: 'follow_up',
    body: '監視を追加',
  });
});

test('classifySpokenLog falls back to note without a keyword', () => {
  assert.deepEqual(classifySpokenLog('5xxが増えている'), {
    kind: 'note',
    body: '5xxが増えている',
  });
});

test('classifySpokenLog does not misfire on words that merely start alike', () => {
  // 「判断する」は区切り記号を伴わないためキーワード扱いしない。
  assert.deepEqual(classifySpokenLog('判断するのが難しい'), {
    kind: 'note',
    body: '判断するのが難しい',
  });
});

test('classifySpokenLog trims surrounding whitespace', () => {
  assert.deepEqual(classifySpokenLog('  メモ、あとで確認  '), {
    kind: 'note',
    body: 'あとで確認',
  });
});

test('describeSpeechLogAvailability covers every state', () => {
  for (const state of ['unsupported', 'no-phrase-support', 'ready']) {
    assert.equal(typeof describeSpeechLogAvailability(state), 'string');
    assert.ok(describeSpeechLogAvailability(state).length > 0);
  }
});

test('INCIDENT_LOG_KIND_LABELS covers every kind', () => {
  for (const kind of [
    'note',
    'decision',
    'hypothesis',
    'comms',
    'follow_up',
    'role_deviation',
  ]) {
    assert.equal(typeof INCIDENT_LOG_KIND_LABELS[kind], 'string');
  }
});
