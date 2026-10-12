const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  TMUX_SESSION_SNAPSHOT_FORMAT,
  TMUX_PANE_SNAPSHOT_FORMAT,
  parseTmuxPaneSnapshots,
  parseTmuxSessionSnapshots,
} = require('../dist/main/tmux-workspace');

test('uses a single tmux format for session names and active pane paths', () => {
  assert.equal(
    TMUX_SESSION_SNAPSHOT_FORMAT,
    '#{session_name}\t#{pane_current_path}'
  );
});

test('parses live tmux panes without accepting malformed targets', () => {
  assert.equal(TMUX_PANE_SNAPSHOT_FORMAT, '#{pane_id}\t#{pane_pid}\t#{session_name}\t#{window_name}\t#{pane_index}');
  assert.deepEqual(parseTmuxPaneSnapshots('%1\t100\tproject\tmain\t0\n%2\t101\tproject\ttests\t1\ninvalid\t102\tproject\tx\t2'), [
    { id: '%1', pid: 100, sessionName: 'project', windowName: 'main', paneIndex: 0 },
    { id: '%2', pid: 101, sessionName: 'project', windowName: 'tests', paneIndex: 1 },
  ]);
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
