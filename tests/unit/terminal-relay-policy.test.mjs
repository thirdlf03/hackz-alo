import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {classifyClientToSandboxFrame, shouldForwardClientToSandboxFrame} =
  await tsImport(
    '../../apps/worker/src/pure/terminalRelayPolicy.ts',
    import.meta.url
  );

test('classifyClientToSandboxFrame treats binary frames as stdin', () => {
  assert.equal(classifyClientToSandboxFrame(new ArrayBuffer(4)), 'stdin');
});

test('classifyClientToSandboxFrame recognizes the resize control frame', () => {
  assert.equal(
    classifyClientToSandboxFrame(
      JSON.stringify({type: 'resize', cols: 80, rows: 24})
    ),
    'resize'
  );
});

test('classifyClientToSandboxFrame treats other text frames as unknown', () => {
  assert.equal(classifyClientToSandboxFrame('not json'), 'unknown');
  assert.equal(
    classifyClientToSandboxFrame(JSON.stringify({type: 'ping'})),
    'unknown'
  );
  assert.equal(
    classifyClientToSandboxFrame(JSON.stringify('resize')),
    'unknown'
  );
  assert.equal(classifyClientToSandboxFrame(JSON.stringify(null)), 'unknown');
});

test('shouldForwardClientToSandboxFrame forwards everything for an operator', () => {
  assert.equal(shouldForwardClientToSandboxFrame('stdin', true), true);
  assert.equal(shouldForwardClientToSandboxFrame('resize', true), true);
  assert.equal(shouldForwardClientToSandboxFrame('unknown', true), true);
});

test('shouldForwardClientToSandboxFrame blocks all known frame kinds for a non-operator', () => {
  assert.equal(shouldForwardClientToSandboxFrame('stdin', false), false);
  assert.equal(shouldForwardClientToSandboxFrame('resize', false), false);
  assert.equal(shouldForwardClientToSandboxFrame('unknown', false), false);
});
