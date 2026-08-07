const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  TMUX_SESSION_SNAPSHOT_FORMAT,
  parseTmuxSessionSnapshots,
} = require('../dist/main/tmux-workspace');

test('uses a single tmux format for session names and active pane paths', () => {
  assert.equal(
    TMUX_SESSION_SNAPSHOT_FORMAT,
    '#{session_name}\t#{pane_current_path}'
  );
});

test('parses tmux session snapshots and preserves paths with spaces', () => {
  const project = path.join(path.sep, 'Users', 'tester', 'My Project');
  assert.deepEqual(
    parseTmuxSessionSnapshots(
      `alpha\t${project}\nbeta\trelative/path\nname-only\n\n`
    ),
    [
      { name: 'alpha', workingDirectory: project },
      { name: 'beta', workingDirectory: null },
      { name: 'name-only', workingDirectory: null },
    ]
  );
  assert.deepEqual(parseTmuxSessionSnapshots(''), []);
  assert.deepEqual(parseTmuxSessionSnapshots(null), []);
});
