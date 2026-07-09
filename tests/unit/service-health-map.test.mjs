import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {computeServiceHealthMap, diffServiceHealth} = await tsImport(
  '../../apps/worker/src/pure/serviceHealthMap.ts',
  import.meta.url
);

function testTopology() {
  return {
    nodes: [
      {id: 'web', label: 'Web', kind: 'service', processId: 'web'},
      {id: 'api', label: 'API', kind: 'service', processId: 'api'},
      {id: 'db', label: 'DB', kind: 'datastore', processId: 'db'},
      {id: 'cache', label: 'Cache', kind: 'datastore', processId: 'cache'},
    ],
    edges: [
      {from: 'web', to: 'api'},
      {from: 'api', to: 'db'},
      {from: 'api', to: 'cache'},
    ],
  };
}

function processStopTrigger(id, processId) {
  return {id, atMs: 0, type: 'process_stop', params: {processId}};
}

test('single down node degrades its upstream dependents', () => {
  const topology = testTopology();
  const health = computeServiceHealthMap(
    topology,
    [processStopTrigger('t1', 'db')],
    false
  );

  assert.equal(health.db, 'down');
  assert.equal(health.api, 'degraded');
  assert.equal(health.web, 'degraded');
  assert.equal(health.cache, 'healthy');
});

test('multiple down nodes propagate degraded state independently, including adjacent down nodes', () => {
  const topology = testTopology();
  const health = computeServiceHealthMap(
    topology,
    [processStopTrigger('t1', 'db'), processStopTrigger('t2', 'api')],
    false
  );

  assert.equal(health.db, 'down');
  assert.equal(health.api, 'down');
  assert.equal(health.web, 'degraded');
  assert.equal(health.cache, 'healthy');
});

test('resolved session reports all nodes healthy regardless of fired triggers', () => {
  const topology = testTopology();
  const health = computeServiceHealthMap(
    topology,
    [processStopTrigger('t1', 'db')],
    true
  );

  assert.deepEqual(health, {
    web: 'healthy',
    api: 'healthy',
    db: 'healthy',
    cache: 'healthy',
  });
});

test('undefined topology yields an empty health map', () => {
  assert.deepEqual(
    computeServiceHealthMap(undefined, [processStopTrigger('t1', 'db')], false),
    {}
  );
});

test('triggers without a matching processId are ignored', () => {
  const topology = testTopology();
  const noProcessId = {
    id: 't1',
    atMs: 0,
    type: 'queue_backlog',
    params: {count: 5},
  };
  const unknownProcessId = processStopTrigger('t2', 'unknown-service');

  const health = computeServiceHealthMap(
    topology,
    [noProcessId, unknownProcessId],
    false
  );

  assert.deepEqual(health, {
    web: 'healthy',
    api: 'healthy',
    db: 'healthy',
    cache: 'healthy',
  });
});

test('diffServiceHealth extracts only changed nodes in topology order', () => {
  const topology = testTopology();
  const before = {
    web: 'healthy',
    api: 'healthy',
    db: 'healthy',
    cache: 'healthy',
  };
  const after = {
    web: 'degraded',
    api: 'degraded',
    db: 'down',
    cache: 'healthy',
  };

  assert.deepEqual(diffServiceHealth(before, after, topology), [
    {nodeId: 'web', health: 'degraded', label: 'Web'},
    {nodeId: 'api', health: 'degraded', label: 'API'},
    {nodeId: 'db', health: 'down', label: 'DB'},
  ]);
});

test('diffServiceHealth returns empty array when nothing changed or topology is undefined', () => {
  const topology = testTopology();
  const same = {
    web: 'healthy',
    api: 'healthy',
    db: 'healthy',
    cache: 'healthy',
  };

  assert.deepEqual(diffServiceHealth(same, same, topology), []);
  assert.deepEqual(diffServiceHealth(same, same, undefined), []);
});
