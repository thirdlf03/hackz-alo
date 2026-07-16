import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tsImport} from 'tsx/esm/api';

const {classifyCommandEvent, commandEventPayload} = await tsImport(
  '../../apps/web/src/pure/replayCommands.ts',
  import.meta.url
);

test('tail with a separated count option records the file operand', () => {
  const command = 'tail -n 50 /workspace/logs/app.log';
  const type = classifyCommandEvent(command);

  assert.equal(type, 'file_opened');
  assert.deepEqual(commandEventPayload(command, type), {
    command,
    path: '/workspace/logs/app.log',
  });
});

test('file-view commands skip common options when finding the path', () => {
  const cases = [
    ['head -n 20 /tmp/app.log', '/tmp/app.log'],
    ['tail --lines 50 /tmp/app.log', '/tmp/app.log'],
    ['cat -n /tmp/app.log', '/tmp/app.log'],
    ['less -N /tmp/app.log', '/tmp/app.log'],
    ['vim -R /tmp/app.conf', '/tmp/app.conf'],
    ['vim --servername DEV /tmp/app.conf', '/tmp/app.conf'],
    ['nano -T 4 /tmp/app.conf', '/tmp/app.conf'],
  ];

  for (const [command, path] of cases) {
    const type = classifyCommandEvent(command);
    assert.equal(type, 'file_opened');
    assert.equal(commandEventPayload(command, type).path, path);
  }
});

test('file-view commands without a file operand are not classified', () => {
  assert.equal(classifyCommandEvent('tail -n 50'), null);
});
