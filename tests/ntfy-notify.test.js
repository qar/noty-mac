const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function publish(input, { panes, pane = '%31', codexThread = 'test-thread', session, sessionRaw, ancestors = [], parentSessions = [] }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noty-hook-'));
  try {
    const bin = path.join(root, 'bin');
    const capture = path.join(root, 'payload.json');
    fs.mkdirSync(bin);
    const sessions = path.join(root, 'codex', 'sessions', '2026', '10', '16');
    fs.mkdirSync(sessions, { recursive: true });
    if (session || sessionRaw) fs.writeFileSync(path.join(sessions, `rollout-2026-10-16T00-00-00-${codexThread}.jsonl`),
      sessionRaw ?? JSON.stringify({ type: 'session_meta', payload: { id: codexThread, ...session } }) + '\n');
    for (const payload of parentSessions) fs.writeFileSync(path.join(sessions, `rollout-2026-10-16T00-00-00-${payload.id}.jsonl`),
      JSON.stringify({ type: 'session_meta', payload }) + '\n');
    fs.writeFileSync(path.join(bin, 'ps'), `#!${process.execPath}
const args=process.argv.slice(2), entries=JSON.parse(process.env.TEST_ANCESTORS);
const pid=args[args.indexOf('-p')+1], field=args[args.indexOf('-o')+1];
const p=entries.find(p=>String(p.pid)===pid)||{parent:entries[0]?.pid||1,command:'/bin/zsh'};
if(field==='ppid=') console.log(p.parent||1);
else console.log(p.command+(args.includes('eww')&&p.thread?' CODEX_THREAD_ID='+p.thread:''));
`, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'tmux'), `#!${process.execPath}
const args = process.argv.slice(2);
const panes = JSON.parse(process.env.TEST_PANES);
const format = args[args.indexOf('-F') + 1] || args.at(-1);
function render(pane, format) {
  return format.replace(/#\\{([^}]+)\\}|#([SIP])/g, (_, key, short) => String(pane[key || ({S:'session_name',I:'window_index',P:'pane_index'})[short]] ?? ''));
}
if (args[0] === 'list-panes') console.log(panes.map(p => render(p, format)).join('\\n'));
else if (args[0] === 'display-message') {
  const target = args.includes('-t') ? args[args.indexOf('-t') + 1] : '%31';
  const pane = panes.find(p => p.pane_id === target);
  if (!pane) process.exit(1);
  console.log(render(pane, args.at(-1)));
} else if (args[0] === 'list-clients') console.log('999\\t/dev/ttys001');
`, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'curl'), `#!${process.execPath}
const args = process.argv.slice(2);
require('node:fs').writeFileSync(process.env.TEST_CAPTURE, args[args.indexOf('-d') + 1]);
`, { mode: 0o755 });
    execFileSync('bash', [path.join(__dirname, '..', 'scripts', 'ntfy-notify.example.sh')], {
      input: JSON.stringify({ title: 'Test notification', message: 'Done', ...input }),
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, NTFY_CHANNEL: 'test-topic', NTFY_SERVER: 'https://invalid.example',
        TMUX_PANE: pane, TMUX: '/tmp/test-tmux/default,123,0', CODEX_THREAD_ID: codexThread,
        CODEX_HOME: path.join(root, 'codex'),
        TEST_PANES: JSON.stringify(panes), TEST_CAPTURE: capture, TEST_ANCESTORS: JSON.stringify(ancestors) },
    });
    return JSON.parse(fs.readFileSync(capture, 'utf8'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const panes = [
  { pane_id: '%31', pane_current_path: '/work/hl-sensor', session_name: 'hl-sensor', window_index: '1', pane_index: '1' },
  { pane_id: '%48', pane_current_path: '/work/noty-mac', session_name: 'noty-mac', window_index: '1', pane_index: '1' },
];

test('publishing from different projects does not reuse a shared daemon pane', () => {
  const source = publish({ cwd: '/work/hl-sensor' }, { panes });
  const other = publish({ cwd: '/work/noty-mac' }, { panes });
  assert.equal(source.tmux.target, '%31');
  assert.equal(other.tmux.target, '%48');
  assert.match(other.message, /tmux: %48/);
});

test('explicit pane targets override inherited context, including same-checkout ambiguity', () => {
  const duplicate = [...panes, { ...panes[1], pane_id: '%49' }];
  assert.equal(publish({ cwd: '/work/noty-mac', tmux: { target: '%49' } }, { panes: duplicate }).tmux.target, '%49');
  assert.equal(publish({ cwd: '/work/noty-mac', tmux: { pane: '%49' } }, { panes: duplicate }).tmux.target, '%49');
  assert.equal(publish({ cwd: '/work/noty-mac', tmux: { session: 'noty', window: '2', pane: '1' } }, { panes: duplicate }).tmux.target, 'noty:2.1');
});

test('ambiguous shared-daemon sources never guess a pane, even within the same checkout', () => {
  const duplicate = [...panes, { ...panes[1], pane_id: '%49' }];
  for (const pane of ['%31', '%48']) {
    const payload = publish({ cwd: '/work/noty-mac' }, { panes: duplicate, pane });
    assert.equal(payload.tmux, undefined);
    assert.doesNotMatch(payload.message, /tmux:/);
    assert.match(payload.message, /Done/);
  }
});

test('a unique Codex pane remains routable beside ordinary shells in the same checkout', () => {
  const candidates = [...panes,
    { ...panes[1], pane_id: '%89', pane_current_path: '/work/hl-test-reports', pane_current_command: 'codex' },
    { ...panes[1], pane_id: '%90', pane_current_path: '/work/hl-test-reports', pane_current_command: 'zsh' },
  ];
  const payload = publish({ cwd: '/work/hl-test-reports', title: 'Codex update' }, { panes: candidates });
  assert.equal(payload.tmux?.target, '%89');
  assert.match(payload.message, /tmux: %89/);
  for (const command of ['codex', 'node', '']) {
    candidates[3].pane_current_command = command;
    assert.equal(publish({ cwd: '/work/hl-test-reports' }, { panes: candidates }).tmux, undefined);
  }
});

test('direct terminal hooks preserve their matching pane even with multiple project panes', () => {
  const duplicate = [...panes, { ...panes[1], pane_id: '%49' }];
  assert.equal(publish({ cwd: '/work/noty-mac' }, { panes: duplicate, pane: '%49', codexThread: '' }).tmux.target, '%49');
});

test('missing or stale context never falls back to the active client', () => {
  for (const pane of ['', '%999']) {
    const payload = publish({ cwd: '/work/unrelated' }, { panes, pane });
    assert.equal(payload.tmux, undefined);
    assert.doesNotMatch(payload.message, /tmux:/);
  }
});

const reviewThread = '11111111-2222-3333-4444-555555555555';
const parentThread = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const reviewPanes = [
  { ...panes[0], pane_current_command: 'codex' },
  { ...panes[1], pane_id: '%34', pane_current_path: '/work/hl-trv-app', pane_current_command: 'codex' },
  { ...panes[1], pane_id: '%36', pane_current_path: '/work/hl-trv-app', pane_current_command: 'zsh' },
  { ...panes[1], pane_id: '%99', pane_current_path: '/work/rtm-review-283', pane_current_command: 'codex' },
];

test('temporary review notifications follow the thread origin, not tool cwd or inherited daemon pane', () => {
  const payload = publish({ cwd: '/work/rtm-review-283' }, {
    panes: reviewPanes, codexThread: reviewThread, session: { cwd: '/work/hl-trv-app' },
  });
  assert.equal(payload.tmux?.target, '%34');
  assert.equal(payload.tmux.sourceProject, 'hl-trv-app');
  assert.match(payload.message, /tmux-source: \{"project":"hl-trv-app"\}/);
  assert.doesNotMatch(payload.message, /\/work\//);
});

test('headless Codex exec notifications follow the launching thread instead of their worktree', () => {
  const payload = publish({ cwd: '/work/rtm-review-283' }, {
    panes: reviewPanes, codexThread: reviewThread, session: { cwd: '/work/rtm-review-283', source: 'exec' },
    ancestors: [{ pid: 101, parent: 1, command: 'codex exec --json -C /work/rtm-review-283', thread: parentThread }],
    parentSessions: [{ id: parentThread, cwd: '/work/hl-trv-app', source: 'vscode' }],
  });
  assert.equal(payload.tmux?.target, '%34');
  assert.equal(payload.tmux.sourceProject, 'hl-trv-app');
});

test('native subagents follow structured parent threads without using the shared daemon environment', () => {
  const payload = publish({ cwd: '/work/rtm-review-283' }, {
    panes: reviewPanes, codexThread: reviewThread,
    session: { cwd: '/work/rtm-review-283', source: { subagent: { thread_spawn: { parent_thread_id: parentThread } } } },
    parentSessions: [{ id: parentThread, cwd: '/work/hl-trv-app', source: 'vscode' }],
  });
  assert.equal(payload.tmux?.target, '%34');
});

test('headless origin discovery stops at the shared app-server boundary', () => {
  const payload = publish({ cwd: '/work/rtm-review-283' }, {
    panes: reviewPanes.filter(p => p.pane_id !== '%99'), codexThread: reviewThread,
    session: { cwd: '/work/rtm-review-283', source: 'exec' },
    ancestors: [{ pid: 101, parent: 102, command: 'codex app-server', thread: parentThread },
      { pid: 102, parent: 1, command: 'codex exec', thread: parentThread }],
    parentSessions: [{ id: parentThread, cwd: '/work/hl-trv-app', source: 'vscode' }],
  });
  assert.equal(payload.tmux, undefined);
});

test('nested exec processes retain their terminal ancestor and reject cyclic native parents', () => {
  const outerThread = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
  const payload = publish({ cwd: '/work/rtm-review-283' }, {
    panes: reviewPanes, codexThread: reviewThread, session: { cwd: '/work/rtm-review-283', source: 'exec' },
    ancestors: [{ pid: 101, parent: 102, command: 'codex exec --json', thread: parentThread },
      { pid: 102, parent: 1, command: '/opt/bin/codex exec --json', thread: outerThread }],
    parentSessions: [{ id: parentThread, cwd: '/work/intermediate', source: 'exec' },
      { id: outerThread, cwd: '/work/hl-trv-app', source: 'vscode' }],
  });
  assert.equal(payload.tmux?.target, '%34');
  for (const parents of [[], [{ id: parentThread, cwd: '/work/hl-trv-app',
    source: { subagent: { thread_spawn: { parent_thread_id: reviewThread } } } }]]) {
    assert.equal(publish({ cwd: '/work/rtm-review-283' }, {
      panes: reviewPanes, codexThread: reviewThread,
      session: { cwd: '/work/rtm-review-283', source: { subagent: { thread_spawn: { parent_thread_id: parentThread } } } },
      parentSessions: parents,
    }).tmux, undefined);
  }
});

test('a known origin that is ambiguous or unavailable never falls back to the tool checkout', () => {
  for (const candidates of [reviewPanes.filter(p => !['%34', '%36'].includes(p.pane_id)),
    [...reviewPanes, { ...reviewPanes[1], pane_id: '%35' }]]) {
    assert.equal(publish({ cwd: '/work/rtm-review-283' }, {
      panes: candidates, codexThread: reviewThread, session: { cwd: '/work/hl-trv-app' },
    }).tmux, undefined);
  }
});

test('explicit targets retain precedence over thread origin', () => {
  const payload = publish({ cwd: '/work/rtm-review-283', tmux: { target: '%99' } }, {
    panes: reviewPanes, codexThread: reviewThread, session: { cwd: '/work/hl-trv-app' },
  });
  assert.equal(payload.tmux.target, '%99');
  assert.equal(payload.tmux.sourceProject, undefined);
});

test('invalid or mismatched session headers do not invent a different source', () => {
  for (const sessionRaw of ['invalid json\n', JSON.stringify({ type: 'session_meta', payload: { id: 'other', cwd: '/work/hl-trv-app' } }),
    JSON.stringify({ type: 'session_meta', payload: { id: reviewThread, cwd: 'relative' } })]) {
    const payload = publish({ cwd: '/work/rtm-review-283' }, { panes: reviewPanes, codexThread: reviewThread, sessionRaw });
    assert.equal(payload.tmux.target, '%99');
    assert.equal(payload.tmux.sourceProject, undefined);
  }
});

test('source directory matching respects path boundaries and spaces', () => {
  const candidates = [
    { ...panes[0], pane_current_path: '/work/noty-mac-old' },
    { ...panes[1], pane_current_path: '/work/noty mac' },
  ];
  assert.equal(publish({ cwd: '/work/noty mac' }, { panes: candidates }).tmux.target, '%48');
  assert.equal(publish({ cwd: '/work/noty-mac' }, { panes: candidates }).tmux, undefined);
});
