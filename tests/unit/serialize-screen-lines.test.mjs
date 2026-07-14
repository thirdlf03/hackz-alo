import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';
import {baseScenario, createPlayState} from '../helpers/game-fixtures.mjs';

const {serializeScreenLines} = await tsImport(
  '../../apps/web/src/pure/serializeScreenLines.ts',
  import.meta.url
);
const {buildCanvasViewModel} = await tsImport(
  '../../apps/web/src/pure/canvasViewModel.ts',
  import.meta.url
);
const {groundAssistNextStep} = await tsImport(
  '../../apps/web/src/pure/assistGrounding.ts',
  import.meta.url
);

function stateWithMonitors(monitorsOverride) {
  const initial = createPlayState();
  return {
    ...initial,
    monitors: {
      ...initial.monitors,
      ...monitorsOverride,
    },
  };
}

test('serializeScreenLines formats a blind metric as NO DATA', () => {
  const state = stateWithMonitors({
    left: {
      ...createPlayState().monitors.left,
      metrics: {
        ...createPlayState().monitors.left.metrics,
        cpu: null,
        memory: null,
      },
    },
  });
  const viewModel = buildCanvasViewModel(state, baseScenario());

  const lines = serializeScreenLines(state, viewModel);

  assert.ok(lines.includes('CPU   NO DATA'));
  assert.ok(lines.includes('MEMORY   NO DATA'));
});

test('serializeScreenLines emits TERMINAL lines (tail 30, ANSI stripped) when activeTool is terminal', () => {
  const initial = createPlayState();
  const allLines = Array.from({length: 35}, (_, index) => `line ${index}`);
  allLines[34] = '[32m✓ done[0m';
  const state = stateWithMonitors({
    center: {
      ...initial.monitors.center,
      activeTool: 'terminal',
      terminal: {...initial.monitors.center.terminal, lines: allLines},
    },
  });
  const viewModel = buildCanvasViewModel(state, baseScenario());

  const lines = serializeScreenLines(state, viewModel);
  const terminalLines = lines.filter((line) => line.startsWith('TERMINAL: '));

  assert.equal(terminalLines.length, 30);
  assert.equal(terminalLines[0], 'TERMINAL: line 5');
  assert.equal(terminalLines[29], 'TERMINAL: ✓ done');
  assert.ok(!lines.some((line) => line === 'TERMINAL: line 0'));
});

test('serializeScreenLines emits EDITOR lines (head 30) when activeTool is editor, and omits TERMINAL', () => {
  const initial = createPlayState();
  const editorContent = Array.from(
    {length: 35},
    (_, index) => `const x${index} = 1;`
  ).join('\n');
  const state = stateWithMonitors({
    center: {
      ...initial.monitors.center,
      activeTool: 'editor',
      terminal: {
        ...initial.monitors.center.terminal,
        lines: ['should not appear'],
      },
      editor: {...initial.monitors.center.editor, content: editorContent},
    },
  });
  const viewModel = buildCanvasViewModel(state, baseScenario());

  const lines = serializeScreenLines(state, viewModel);
  const editorLines = lines.filter((line) => line.startsWith('EDITOR: '));

  assert.equal(editorLines.length, 30);
  assert.equal(editorLines[0], 'EDITOR: const x0 = 1;');
  assert.equal(editorLines[29], 'EDITOR: const x29 = 1;');
  assert.ok(!lines.some((line) => line.startsWith('TERMINAL: ')));
});

test('serializeScreenLines splits RUNBOOK body into multiple lines and skips blank lines', () => {
  const scenario = {
    ...baseScenario(),
    runbooks: [
      {
        id: 'rb-1',
        title: 'Restart the API',
        body: 'Step 1: check logs\n\nStep 2: restart\n',
      },
    ],
  };
  const state = createPlayState(scenario);
  const viewModel = buildCanvasViewModel(state, scenario);

  const lines = serializeScreenLines(state, viewModel);
  const runbookLines = lines.filter((line) => line.startsWith('RUNBOOK: '));

  assert.deepEqual(runbookLines, [
    'RUNBOOK: Restart the API',
    'RUNBOOK: Step 1: check logs',
    'RUNBOOK: Step 2: restart',
  ]);
});

test('serializeScreenLines emits recentChatMessages as CHAT lines when activePanelTab is chat, and omits RUNBOOK', () => {
  const scenario = {
    ...baseScenario(),
    runbooks: [{id: 'rb-1', title: 'Restart the API', body: 'restart it'}],
  };
  const initial = createPlayState(scenario);
  const state = stateWithMonitors({
    right: {
      ...initial.monitors.right,
      activePanelTab: 'chat',
      activeRunbook: initial.monitors.right.activeRunbook,
      chatMessages: [
        {id: 'srv-1', from: 'bot', body: 'ss -ltnp を見て', atMs: 1_000},
      ],
    },
  });
  const merged = {
    ...state,
    monitors: {...state.monitors, right: {...state.monitors.right}},
  };
  const viewModel = buildCanvasViewModel(merged, scenario);

  const lines = serializeScreenLines(merged, viewModel);

  assert.ok(lines.includes('CHAT: bot: ss -ltnp を見て'));
  assert.ok(!lines.some((line) => line.startsWith('RUNBOOK: ')));
});

test('serializeScreenLines with {allPanels: true} also includes the inactive EDITOR lines when activeTool is terminal', () => {
  const initial = createPlayState();
  const state = stateWithMonitors({
    center: {
      ...initial.monitors.center,
      activeTool: 'terminal',
      terminal: {...initial.monitors.center.terminal, lines: ['$ ss -ltnp']},
      editor: {
        ...initial.monitors.center.editor,
        content: 'const x = 1;',
      },
    },
  });
  const viewModel = buildCanvasViewModel(state, baseScenario());

  const defaultLines = serializeScreenLines(state, viewModel);
  assert.ok(defaultLines.some((line) => line.startsWith('TERMINAL: ')));
  assert.ok(!defaultLines.some((line) => line.startsWith('EDITOR: ')));

  const allPanelsLines = serializeScreenLines(state, viewModel, {
    allPanels: true,
  });
  assert.ok(allPanelsLines.some((line) => line.startsWith('TERMINAL: ')));
  assert.ok(allPanelsLines.includes('EDITOR: const x = 1;'));
});

test('serializeScreenLines with {allPanels: true} also includes the inactive TERMINAL lines when activeTool is editor', () => {
  const initial = createPlayState();
  const state = stateWithMonitors({
    center: {
      ...initial.monitors.center,
      activeTool: 'editor',
      terminal: {...initial.monitors.center.terminal, lines: ['$ ss -ltnp']},
      editor: {...initial.monitors.center.editor, content: 'const x = 1;'},
    },
  });
  const viewModel = buildCanvasViewModel(state, baseScenario());

  const allPanelsLines = serializeScreenLines(state, viewModel, {
    allPanels: true,
  });
  assert.ok(allPanelsLines.includes('EDITOR: const x = 1;'));
  assert.ok(allPanelsLines.includes('TERMINAL: $ ss -ltnp'));
});

test('serializeScreenLines with {allPanels: true} also includes the inactive RUNBOOK lines when activePanelTab is chat', () => {
  const scenario = {
    ...baseScenario(),
    runbooks: [{id: 'rb-1', title: 'Restart the API', body: 'restart it'}],
  };
  const initial = createPlayState(scenario);
  const state = stateWithMonitors({
    right: {
      ...initial.monitors.right,
      activePanelTab: 'chat',
      activeRunbook: initial.monitors.right.activeRunbook,
      chatMessages: [
        {id: 'srv-1', from: 'bot', body: 'ss -ltnp を見て', atMs: 1_000},
      ],
    },
  });
  const merged = {
    ...state,
    monitors: {...state.monitors, right: {...state.monitors.right}},
  };
  const viewModel = buildCanvasViewModel(merged, scenario);

  const defaultLines = serializeScreenLines(merged, viewModel);
  assert.ok(!defaultLines.some((line) => line.startsWith('RUNBOOK: ')));

  const allPanelsLines = serializeScreenLines(merged, viewModel, {
    allPanels: true,
  });
  assert.ok(allPanelsLines.includes('CHAT: bot: ss -ltnp を見て'));
  assert.ok(allPanelsLines.includes('RUNBOOK: Restart the API'));
});

test('serializeScreenLines with {allPanels: true} also includes the inactive CHAT lines when activePanelTab is runbook', () => {
  const scenario = {
    ...baseScenario(),
    runbooks: [{id: 'rb-1', title: 'Restart the API', body: 'restart it'}],
  };
  const initial = createPlayState(scenario);
  const state = stateWithMonitors({
    right: {
      ...initial.monitors.right,
      activePanelTab: 'runbook',
      activeRunbook: initial.monitors.right.activeRunbook,
      chatMessages: [
        {id: 'srv-1', from: 'bot', body: 'ss -ltnp を見て', atMs: 1_000},
      ],
    },
  });
  const merged = {
    ...state,
    monitors: {...state.monitors, right: {...state.monitors.right}},
  };
  const viewModel = buildCanvasViewModel(merged, scenario);

  // The chat message also surfaces once via the always-present notification
  // panel summary (independent of activePanelTab), so presence alone can't
  // distinguish the right-panel CHAT section; count occurrences instead.
  const countChatLine = (lines) =>
    lines.filter((line) => line === 'CHAT: bot: ss -ltnp を見て').length;

  const defaultLines = serializeScreenLines(merged, viewModel);
  assert.equal(countChatLine(defaultLines), 1);

  const allPanelsLines = serializeScreenLines(merged, viewModel, {
    allPanels: true,
  });
  assert.ok(allPanelsLines.includes('RUNBOOK: Restart the API'));
  assert.equal(countChatLine(allPanelsLines), 2);
});

test('groundAssistNextStep accepts a next-step copied verbatim from serialized TERMINAL lines', () => {
  const initial = createPlayState();
  const state = stateWithMonitors({
    center: {
      ...initial.monitors.center,
      activeTool: 'terminal',
      terminal: {
        ...initial.monitors.center.terminal,
        lines: [
          '$ ss -ltnp',
          'LISTEN 0 128 0.0.0.0:8080 users:(("api",pid=1))',
        ],
      },
    },
  });
  const viewModel = buildCanvasViewModel(state, baseScenario());
  const lines = serializeScreenLines(state, viewModel);

  const answer =
    '次の一手: ss -ltnp を実行してポート占有を確認する\n根拠: ターミナルの表示より';
  const result = groundAssistNextStep(answer, lines);

  assert.equal(result.status, 'ok');
});

test('groundAssistNextStep rejects a next-step command absent from the serialized screen', () => {
  const initial = createPlayState();
  const state = stateWithMonitors({
    center: {
      ...initial.monitors.center,
      activeTool: 'terminal',
      terminal: {...initial.monitors.center.terminal, lines: ['$ ss -ltnp']},
    },
  });
  const viewModel = buildCanvasViewModel(state, baseScenario());
  const lines = serializeScreenLines(state, viewModel);

  const answer =
    '次の一手: kubectl rollout restart deployment/api\n根拠: 一般的な復旧手順のため';
  const result = groundAssistNextStep(answer, lines);

  assert.equal(result.status, 'rejected');
});
