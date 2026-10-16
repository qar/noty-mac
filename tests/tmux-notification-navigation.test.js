const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function navigation({ project = 'noty-mac', root = '/work/noty-mac', gitFails = false, tmuxUnavailable = false,
  target = '%31', branch, duplicateAgent = false, branchChanges = false } = {}) {
  const state = { notifications: [{ id: 'one', channelId: 'ai', title: 'Codex update', read: false, message: 'Done',
    metadata: { ...(target ? { tmux: { target } } : {}), ...(project ? { project: { name: project, branch } } : {}) } }] };
  const commands = [];
  const handlers = new Map();
  let branchReads = 0;
  const context = {
    module: { exports: {} }, __dirname: '/app/dist/main', process, console, setTimeout,
    require(name) {
      if (name === 'electron') return {
        app: { on() {}, whenReady: () => ({ then() {} }) },
        ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} },
      };
      if (name === 'child_process') return { execFile(file, args, options, callback) {
        commands.push([file, ...args]);
        if (file === '/bin/ps') return callback(null, `100 1 /bin/zsh\n101 100 codex\n200 1 /bin/zsh\n${duplicateAgent ? '201 200 codex' : ''}`);
        if (args[0] === 'list-panes') return callback(tmuxUnavailable ? new Error('No tmux server') : null,
          args.at(-1).includes('#{pane_pid}') ? '%89\t100\thl-test-reports\tmain\t0\n%90\t200\thl-test-reports\tmain\t1\n' : '%31\thl-sensor\n%48\tnoty-mac\n');
        if (file.endsWith('git')) return callback(gitFails ? new Error('Not a repository') : null,
          `${args.includes('branch') ? (branchChanges && branchReads++ > 0 ? 'changed' : branch) : root}\n`);
        if (args[0] === 'display-message') {
          const value = args.at(-1) === '#{pane_current_path}' ? `${root}/src` : args.at(-1) === '#S' ? 'session' : 'session:1';
          return callback(null, `${value}\n`);
        }
        if (args[0] === 'list-clients') return callback(null, '/dev/ttys001\tsession\txterm-kitty\t123\n');
        return callback(null, '');
      } };
      if (name === './store') return { get: key => structuredClone(state[key]), set: (key, value) => { state[key] = value; } };
      if (name === './notification-core') return require('../dist/main/notification-core');
      if (name === './tmux-notification-target') return require('../dist/main/tmux-notification-target');
      if (name === './tmux-workspace') return require('../dist/main/tmux-workspace');
      if (name === './window') return { getWindow: () => null };
      if (name.startsWith('./')) return {};
      return require(name);
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/main/index'), 'utf8') + '\nupdateTrayIcon = () => {}; setupIPC();', context);
  return { commands, state, jump: (options) => handlers.get('jump-to-notification-target')({}, 'one', options),
    notifications: () => handlers.get('get-notifications')() };
}

test('a historical targetless reminder recovers the unique matching project and branch agent', async () => {
  const app = navigation({ project: 'hl-test-reports', root: '/work/hl-test-reports', branch: 'hl-test-reports', target: null });
  app.state.notifications.push({ ...app.state.notifications[0], id: 'other' });
  const result = await app.jump({ notificationIds: ['one', 'other'] });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.ok(app.commands.some(command => command.includes('select-pane') && command.includes('%89')));
  assert.equal(app.state.notifications[0].read, true);
  assert.equal(app.state.notifications[1].read, false);
});

test('target recovery never guesses between multiple agents in the same checkout', async () => {
  const app = navigation({ project: 'hl-test-reports', root: '/work/hl-test-reports', branch: 'hl-test-reports', target: null, duplicateAgent: true });
  assert.equal((await app.jump()).reason, 'source_ambiguous');
  assert.equal(app.commands.some(command => command.includes('select-pane') || command[0] === '/usr/bin/open'), false);
  assert.equal(app.state.notifications[0].read, false);
});

test('a recovered pane is revalidated before navigation if its checkout changes', async () => {
  const app = navigation({ project: 'hl-test-reports', root: '/work/hl-test-reports', branch: 'hl-test-reports', target: null, branchChanges: true });
  assert.equal((await app.jump()).reason, 'source_project_unverified');
  assert.equal(app.state.notifications[0].read, false);
  assert.equal(app.commands.some(command => command.includes('select-pane')), false);
});

test('missing source details or an offline tmux server return explicit failure and retain the reminder', async () => {
  for (const options of [{ target: null }, { target: null, branch: 'main', tmuxUnavailable: true }]) {
    const app = navigation(options);
    const result = await app.jump();
    assert.equal(result.success, false);
    assert.ok(result.reason);
    assert.equal(app.state.notifications[0].read, false);
  }
});

test('historical notifications with a wrong project target neither switch panes nor dismiss', async () => {
  const app = navigation({ project: 'app', root: '/work/hl-sensor' });
  const result = await app.jump();
  assert.equal(result.success, false);
  assert.equal(result.reason, 'source_project_mismatch');
  assert.equal(app.commands.some(command => command.includes('switch-client') || command[0] === '/usr/bin/open'), false);
  assert.equal(app.state.notifications[0].read, false);
});

test('matching project targets navigate successfully and dismiss the reminder', async () => {
  const app = navigation();
  assert.equal((await app.jump()).success, true);
  assert.ok(app.commands.some(command => command.includes('select-pane') && command.includes('%31')));
  assert.equal(app.state.notifications[0].read, true);
});

test('legacy targets without project metadata remain jumpable', async () => {
  const app = navigation({ project: null });
  assert.equal((await app.jump()).success, true);
  assert.equal(app.commands.some(command => command[0].endsWith('git')), false);
});

test('an unavailable source checkout preserves the reminder without opening a terminal', async () => {
  const app = navigation({ gitFails: true });
  assert.equal((await app.jump()).reason, 'source_project_unverified');
  assert.equal(app.state.notifications[0].read, false);
  assert.equal(app.commands.some(command => command[0] === '/usr/bin/open'), false);
});

test('successful navigation never dismisses another project sharing a corrupted target', async () => {
  const app = navigation();
  app.state.notifications.push({ ...app.state.notifications[0], id: 'other',
    metadata: { tmux: { target: '%31' }, project: { name: 'other-project' } } });
  assert.equal((await app.jump({ notificationIds: ['one', 'other'] })).success, true);
  assert.equal(app.state.notifications[0].read, true);
  assert.equal(app.state.notifications[1].read, false);
});

test('notification display resolves session names without changing stored routing, content or state', async () => {
  const app = navigation();
  app.state.notifications[0].message = 'tmux: %31\nOriginal content';
  app.state.notifications.push({ id: 'legacy', message: 'tmux: %48\nLegacy content', read: false });
  const original = structuredClone(app.state.notifications);
  const items = await app.notifications();
  assert.equal(items[0].metadata.tmux.session, 'hl-sensor');
  assert.equal(items[0].metadata.tmux.target, '%31');
  assert.equal(items[0].message, original[0].message);
  assert.equal(items[1].metadata.tmux.session, 'noty-mac');
  assert.deepEqual(app.state.notifications, original);
  assert.equal(app.commands.filter(command => command.includes('list-panes')).length, 1);
});

test('notification display remains available when tmux is stopped', async () => {
  const app = navigation({ tmuxUnavailable: true });
  app.state.notifications[0].metadata.tmux.session = 'known-session';
  const [item] = await app.notifications();
  assert.equal(item.metadata.tmux.session, 'known-session');
  assert.equal(item.metadata.tmux.target, '%31');
  assert.equal(item.read, false);
});
