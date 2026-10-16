const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function navigation({ project = 'noty-mac', root = '/work/noty-mac', gitFails = false } = {}) {
  const state = { notifications: [{ id: 'one', channelId: 'ai', read: false, message: 'Done',
    metadata: { tmux: { target: '%31' }, ...(project ? { project: { name: project } } : {}) } }] };
  const commands = [];
  const handlers = new Map();
  const context = {
    module: { exports: {} }, __dirname: '/app/dist/main', process, console, setTimeout,
    require(name) {
      if (name === 'electron') return {
        app: { on() {}, whenReady: () => ({ then() {} }) },
        ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} },
      };
      if (name === 'child_process') return { execFile(file, args, options, callback) {
        commands.push([file, ...args]);
        if (file.endsWith('git')) return callback(gitFails ? new Error('Not a repository') : null, `${root}\n`);
        if (args[0] === 'display-message') {
          const value = args.at(-1) === '#{pane_current_path}' ? `${root}/src` : args.at(-1) === '#S' ? 'session' : 'session:1';
          return callback(null, `${value}\n`);
        }
        if (args[0] === 'list-clients') return callback(null, '/dev/ttys001\tsession\txterm-kitty\t123\n');
        return callback(null, '');
      } };
      if (name === './store') return { get: key => structuredClone(state[key]), set: (key, value) => { state[key] = value; } };
      if (name === './notification-core') return require('../dist/main/notification-core');
      if (name === './window') return { getWindow: () => null };
      if (name.startsWith('./')) return {};
      return require(name);
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/main/index'), 'utf8') + '\nupdateTrayIcon = () => {}; setupIPC();', context);
  return { commands, state, jump: (options) => handlers.get('jump-to-notification-target')({}, 'one', options) };
}

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
