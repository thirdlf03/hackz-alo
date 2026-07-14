import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';
import {createPlayState} from '../helpers/game-fixtures.mjs';

const {shouldBumpStateVersion, withStateVersion} = await tsImport(
  '../../apps/web/src/pure/stateVersionPolicy.ts',
  import.meta.url
);

function base() {
  return createPlayState();
}

test('shouldBumpStateVersion is false for an unchanged state', () => {
  const state = base();
  assert.equal(shouldBumpStateVersion(state, state), false);
});

test('shouldBumpStateVersion is true when alerts change', () => {
  const prev = base();
  const next = {
    ...prev,
    monitors: {
      ...prev.monitors,
      left: {...prev.monitors.left, alerts: [...prev.monitors.left.alerts, {}]},
    },
  };
  assert.equal(shouldBumpStateVersion(prev, next), true);
});

test('shouldBumpStateVersion is true when chatMessages change', () => {
  const prev = base();
  const next = {
    ...prev,
    monitors: {
      ...prev.monitors,
      right: {...prev.monitors.right, chatMessages: []},
    },
  };
  assert.equal(shouldBumpStateVersion(prev, next), true);
});

test('shouldBumpStateVersion is true when terminal lines change', () => {
  const prev = base();
  const next = {
    ...prev,
    monitors: {
      ...prev.monitors,
      center: {
        ...prev.monitors.center,
        terminal: {...prev.monitors.center.terminal, lines: ['new line']},
      },
    },
  };
  assert.equal(shouldBumpStateVersion(prev, next), true);
});

test('shouldBumpStateVersion is true when terminal commandHistory changes', () => {
  const prev = base();
  const next = {
    ...prev,
    monitors: {
      ...prev.monitors,
      center: {
        ...prev.monitors.center,
        terminal: {
          ...prev.monitors.center.terminal,
          commandHistory: [{at: 0, command: 'ls'}],
        },
      },
    },
  };
  assert.equal(shouldBumpStateVersion(prev, next), true);
});

test('shouldBumpStateVersion is true when metrics change', () => {
  const prev = base();
  const next = {
    ...prev,
    monitors: {
      ...prev.monitors,
      left: {...prev.monitors.left, metrics: {...prev.monitors.left.metrics}},
    },
  };
  assert.equal(shouldBumpStateVersion(prev, next), true);
});

test('shouldBumpStateVersion is true when runbookProgress changes', () => {
  const prev = base();
  const next = {
    ...prev,
    runbookProgress: {runbookId: 'rb', bodyHash: 'h', steps: []},
  };
  assert.equal(shouldBumpStateVersion(prev, next), true);
});

test('shouldBumpStateVersion is true when recovery changes', () => {
  const prev = base();
  const next = {...prev, recovery: {checking: true}};
  assert.equal(shouldBumpStateVersion(prev, next), true);
});

test('shouldBumpStateVersion is true when activeTool changes', () => {
  const prev = base();
  const next = {
    ...prev,
    monitors: {
      ...prev.monitors,
      center: {...prev.monitors.center, activeTool: 'editor'},
    },
  };
  assert.equal(shouldBumpStateVersion(prev, next), true);
});

test('shouldBumpStateVersion is true when activePanelTab changes', () => {
  const prev = base();
  const next = {
    ...prev,
    monitors: {
      ...prev.monitors,
      right: {...prev.monitors.right, activePanelTab: 'chat'},
    },
  };
  assert.equal(shouldBumpStateVersion(prev, next), true);
});

test('shouldBumpStateVersion is false when only room.participants (cursor-carrying) changes', () => {
  const prev = base();
  const next = {
    ...prev,
    room: {
      ...prev.room,
      participants: [
        {
          participantId: 'p1',
          online: true,
          cursor: {x: 1, y: 2, visible: true, updatedAt: 1},
        },
      ],
    },
  };
  assert.equal(shouldBumpStateVersion(prev, next), false);
});

test('shouldBumpStateVersion is false when only clickEffects change', () => {
  const prev = base();
  const next = {
    ...prev,
    clickEffects: [{id: 'a', x: 1, y: 1, ageMs: 0}],
  };
  assert.equal(shouldBumpStateVersion(prev, next), false);
});

test('withStateVersion bumps from undefined to 1 on a meaningful change', () => {
  const prev = base();
  assert.equal(prev.stateVersion, undefined);
  const next = {
    ...prev,
    monitors: {
      ...prev.monitors,
      right: {...prev.monitors.right, chatMessages: []},
    },
  };
  const versioned = withStateVersion(prev, next);
  assert.equal(versioned.stateVersion, 1);
});

test('withStateVersion increments an existing stateVersion on a meaningful change', () => {
  const prev = {...base(), stateVersion: 5};
  const next = {
    ...prev,
    monitors: {
      ...prev.monitors,
      right: {...prev.monitors.right, chatMessages: []},
    },
  };
  const versioned = withStateVersion(prev, next);
  assert.equal(versioned.stateVersion, 6);
});

test('withStateVersion carries stateVersion forward unchanged when nothing bump-worthy changed', () => {
  const prev = {...base(), stateVersion: 5};
  const next = {
    ...prev,
    clickEffects: [{id: 'a', x: 1, y: 1, ageMs: 0}],
  };
  const versioned = withStateVersion(prev, next);
  assert.equal(versioned.stateVersion, 5);
});

test('withStateVersion returns next unchanged (no new allocation) when its stateVersion already matches', () => {
  const prev = {...base(), stateVersion: 5};
  const next = {...prev, stateVersion: 5, clickEffects: []};
  assert.equal(withStateVersion(prev, next), next);
});
