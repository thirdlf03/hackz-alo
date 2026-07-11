import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {
  parseAppendLogArgs,
  parseCreateTaskArgs,
  parseFireInjectArgs,
  summarizeIncidentState,
  WEBMCP_TOOL_DEFS,
} = await tsImport('../../apps/web/src/pure/webmcpTools.ts', import.meta.url);

function buildGameState() {
  const metrics = {
    at: 0,
    cpu: 42,
    memory: 60,
    disk: 30,
    http5xxRate: 0.2,
    latencyP95Ms: 480,
    rps: 120,
    dbConnections: 20,
    queueDepth: 4,
  };
  return {
    session: {
      sessionId: 'sess_1',
      replayId: 'rep_1',
      scenarioId: 'scn_1',
      scenarioTitle: 'DB接続枯渇',
      difficulty: 'beginner',
      status: 'running',
    },
    clock: {elapsedMs: 90_500, timeLimitMs: 600_000, speed: 2},
    monitors: {
      left: {
        metrics,
        metricsHistory: [metrics],
        metricsSource: 'live',
        edgeRttMs: null,
        edgeRttHistory: [],
        alerts: [
          {
            id: 'a1',
            atMs: 0,
            severity: 'critical',
            message: 'HTTP 5xx が急増',
            source: 'monitor',
          },
        ],
        serviceHealth: {api: 'degraded', db: 'down'},
      },
      center: {
        activeTool: 'terminal',
        terminal: {
          cols: 80,
          rows: 24,
          lines: ['$ systemctl status api', 'active (running)', '', '  ', ''],
          cursor: {x: 0, y: 0, visible: true},
          commandDraft: '',
          commandHistory: [{at: 0, command: 'systemctl status api'}],
        },
        editor: {},
      },
      right: {
        activePanelTab: 'runbook',
        activeRunbookIndex: 0,
        chatMessages: [],
      },
    },
    navigation: {},
    notifications: {},
    seenChatIds: [],
    playerChatMessages: [],
    chatCompose: {active: false, draft: ''},
    openedRunbookIds: [],
    alertFlashMs: 0,
    world: {narrativeHour: 2, expandedMonitor: null},
    commandInputFocused: false,
    cursor: {x: 0, y: 0, visible: false},
    room: {
      participants: [
        {
          participantId: 'p1',
          displayName: 'Alice',
          role: 'ops',
          ready: true,
          online: true,
          joinedAt: '',
          lastSeenAt: '',
        },
      ],
      tasks: [
        {
          id: 't1',
          title: 'DB接続数を確認',
          status: 'open',
          createdAt: '',
          updatedAt: '',
        },
      ],
      incidentLog: [
        {id: 'l1', kind: 'note', body: '5xx増加を確認', createdAt: ''},
      ],
      injects: [{id: 'i1', title: '追加障害', body: '...', fired: false}],
    },
    clickEffects: [],
    recording: {status: 'idle', chunkCount: 0, saveEnabled: false},
  };
}

test('summarizeIncidentState returns undefined without game state', () => {
  assert.equal(summarizeIncidentState(undefined), undefined);
});

test('summarizeIncidentState builds a compact overview', () => {
  const overview = summarizeIncidentState(buildGameState());
  assert.equal(overview.scenario.title, 'DB接続枯渇');
  assert.equal(overview.clock.elapsedSeconds, 91);
  assert.equal(overview.clock.timeLimitSeconds, 600);
  assert.equal(overview.metrics.source, 'live');
  assert.equal(overview.metrics.latencyP95Ms, 480);
  assert.deepEqual(overview.serviceHealth, {api: 'degraded', db: 'down'});
  assert.deepEqual(overview.alerts, [
    {severity: 'critical', message: 'HTTP 5xx が急増'},
  ]);
  assert.deepEqual(overview.terminal.recentLines, [
    '$ systemctl status api',
    'active (running)',
  ]);
  assert.deepEqual(overview.terminal.recentCommands, ['systemctl status api']);
  assert.deepEqual(overview.tasks, [
    {id: 't1', title: 'DB接続数を確認', status: 'open'},
  ]);
  assert.deepEqual(overview.incidentLog, [
    {kind: 'note', body: '5xx増加を確認'},
  ]);
  assert.deepEqual(overview.injects, [
    {id: 'i1', title: '追加障害', fired: false},
  ]);
  assert.deepEqual(overview.participants, [
    {name: 'Alice', role: 'ops', online: true},
  ]);
});

test('tool definitions expose valid JSON schema and required fields', () => {
  for (const def of Object.values(WEBMCP_TOOL_DEFS)) {
    assert.match(def.name, /^[a-z_]+$/);
    assert.ok(def.description.length > 0);
    assert.equal(def.inputSchema.type, 'object');
  }
  assert.deepEqual(WEBMCP_TOOL_DEFS.createTask.inputSchema.required, ['title']);
  assert.deepEqual(WEBMCP_TOOL_DEFS.fireInject.inputSchema.required, [
    'injectId',
  ]);
  assert.equal(WEBMCP_TOOL_DEFS.overview.annotations.readOnlyHint, true);
});

test('parseCreateTaskArgs validates and trims titles', () => {
  assert.deepEqual(parseCreateTaskArgs({title: '  復旧手順を確認 '}), {
    title: '復旧手順を確認',
  });
  assert.equal(parseCreateTaskArgs({title: '   '}), undefined);
  assert.equal(parseCreateTaskArgs({title: 12}), undefined);
  assert.equal(parseCreateTaskArgs(null), undefined);
  assert.equal(parseCreateTaskArgs('title'), undefined);
  assert.equal(
    parseCreateTaskArgs({title: 'あ'.repeat(300)}).title.length,
    200
  );
});

test('parseAppendLogArgs defaults kind to note and rejects bad kinds', () => {
  assert.deepEqual(parseAppendLogArgs({body: '観測メモ'}), {
    body: '観測メモ',
    kind: 'note',
  });
  assert.deepEqual(parseAppendLogArgs({body: '判断', kind: 'decision'}), {
    body: '判断',
    kind: 'decision',
  });
  assert.deepEqual(parseAppendLogArgs({body: 'x', kind: 'role_deviation'}), {
    body: 'x',
    kind: 'note',
  });
  assert.equal(parseAppendLogArgs({body: ''}), undefined);
  assert.equal(parseAppendLogArgs({kind: 'note'}), undefined);
});

test('parseFireInjectArgs requires a non-empty injectId', () => {
  assert.deepEqual(parseFireInjectArgs({injectId: ' i1 '}), {injectId: 'i1'});
  assert.equal(parseFireInjectArgs({injectId: ''}), undefined);
  assert.equal(parseFireInjectArgs({}), undefined);
  assert.equal(parseFireInjectArgs(undefined), undefined);
});
