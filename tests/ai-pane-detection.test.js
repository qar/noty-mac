const test = require('node:test');
const assert = require('node:assert/strict');
const { detectAiPanes } = require('../dist/main/ai-pane-detection');

test('detects AI processes beneath live tmux panes, including wrapped commands', () => {
  const panes = [
    { id: '%1', pid: 100 },
    { id: '%2', pid: 200 },
    { id: '%3', pid: 300 },
  ];
  const processes = [
    '100 1 /bin/zsh',
    '101 100 /usr/bin/env',
    '102 101 claude',
    '200 1 /bin/zsh',
    '201 200 /opt/homebrew/bin/codex',
    '300 1 /bin/zsh',
    '301 300 node',
    '400 1 claude',
  ].join('\n');

  assert.deepEqual([...detectAiPanes(panes, processes)], [
    ['%1', 'Claude'],
    ['%2', 'Codex'],
  ]);
});
