import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {computeTopologyLayout} = await tsImport(
  '../../apps/web/src/pure/topologyLayout.ts',
  import.meta.url
);

const WIDTH = 496;
const HEIGHT = 240;

test('computeTopologyLayout places a linear chain with monotonically increasing x per depth', () => {
  const topology = {
    nodes: [
      {id: 'user', label: 'ユーザー', kind: 'external'},
      {id: 'api', label: 'API', kind: 'service', processId: 'api'},
      {id: 'db', label: 'DB', kind: 'datastore', processId: 'db'},
    ],
    edges: [
      {from: 'user', to: 'api'},
      {from: 'api', to: 'db'},
    ],
  };

  const layout = computeTopologyLayout(topology, WIDTH, HEIGHT);
  assert.equal(layout.nodes.length, 3);
  const byId = Object.fromEntries(layout.nodes.map((node) => [node.id, node]));

  assert.equal(byId.user.x < byId.api.x, true);
  assert.equal(byId.api.x < byId.db.x, true);

  for (const node of layout.nodes) {
    assert.equal(node.x >= 0 && node.x <= WIDTH, true);
    assert.equal(node.y >= 0 && node.y <= HEIGHT, true);
  }

  assert.equal(layout.edges.length, 2);
});

test('computeTopologyLayout spreads sibling nodes at the same depth vertically', () => {
  const topology = {
    nodes: [
      {id: 'user', label: 'ユーザー', kind: 'external'},
      {id: 'api', label: 'API', kind: 'service', processId: 'api'},
      {id: 'db', label: 'DB', kind: 'datastore', processId: 'db'},
      {id: 'cache', label: 'Cache', kind: 'datastore', processId: 'cache'},
    ],
    edges: [
      {from: 'user', to: 'api'},
      {from: 'api', to: 'db'},
      {from: 'api', to: 'cache'},
    ],
  };

  const layout = computeTopologyLayout(topology, WIDTH, HEIGHT);
  const byId = Object.fromEntries(layout.nodes.map((node) => [node.id, node]));

  assert.equal(byId.db.x, byId.cache.x);
  assert.notEqual(byId.db.y, byId.cache.y);
});

test('computeTopologyLayout returns empty arrays when topology is undefined', () => {
  const layout = computeTopologyLayout(undefined, WIDTH, HEIGHT);
  assert.deepEqual(layout, {nodes: [], edges: []});
});
