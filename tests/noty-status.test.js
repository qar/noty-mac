const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('noty-status keeps separate state for two panes in one workspace', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noty-status-'));
  try {
    const bin = path.join(root, 'bin');
    const workspace = path.join(root, 'workspaces', 'one');
    fs.mkdirSync(bin);
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\ncase "$*" in *pane_pid*) echo 123 ;; *) echo project ;; esac\n', { mode: 0o755 });
    fs.writeFileSync(path.join(workspace, 'workspace.json'), JSON.stringify({ tmuxSessionName: 'project' }, null, 2));
    const script = path.join(__dirname, '..', 'scripts', 'noty-status');
    const report = (pane, state) => execFileSync(script, [state], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        TMUX_PANE: pane,
        NOTY_WORKSPACES_DIR: path.dirname(workspace),
      },
    });

    report('%1', 'running');
    report('%2', 'waiting_input');
    assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, 'agent-status-%1.json'))).state, 'running');
    assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, 'agent-status-%2.json'))).state, 'waiting_input');
    assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, 'agent-status-%2.json'))).panePid, 123);
    assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, 'agent-status.json'))).state, 'waiting_input');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
