const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { NotificationDatabase } = require('../dist/main/notification-database');
const LocalNotifications = require('../dist/main/local-notifications');
const { prepareLocalNotificationTools } = require('../dist/main/local-notification-tools');

function publish(filename, input, extraEnv = {}, script = path.resolve('scripts/ntfy-notify.example.sh')) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [script], {
      env: { ...process.env, NOTY_TRANSPORT: 'local', NOTY_DATABASE_PATH: filename, ...extraEnv },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Publisher exited ${code}: ${stderr}`)));
    child.stdin.end(JSON.stringify({ title: 'Codex update', message: 'Done', target: '%94', ...input }));
  });
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noty-local-'));
  const filename = path.join(root, 'data with spaces', 'notifications.sqlite3');
  const databases = [];
  t.after(async () => {
    for (const database of databases) await database.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, filename, open: async () => {
    const database = await NotificationDatabase.open(filename);
    databases.push(database);
    return database;
  } };
}

test('offline local publishing needs no topic, preserves JSON content and never invokes curl', async t => {
  const { root, filename, open } = fixture(t);
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\nexit 77\n', { mode: 0o755 });
  const message = '中文\n{"quote":"\'","command":"$(must not execute)"}';
  await publish(filename, { id: 'offline', message }, { NTFY_CHANNEL: '', PATH: `${bin}:${process.env.PATH}` });
  const database = await open();
  const saved = await database.get('offline');
  assert.equal(saved.message.includes(message), true);
  assert.equal(saved.metadata.tmux.target, '%94');
  assert.equal(saved.channelId, 'local-tmux');
  assert.equal(saved.read, false);
  const received = [];
  const client = new LocalNotifications(database, item => received.push(item));
  await client.poll();
  await client.poll();
  assert.deepEqual(received.map(item => item.id), ['offline']);
  assert.equal((await database.get('offline')).read, false);
  await publish(filename, { id: 'offline', message: 'Replay must not replace the event' });
  assert.deepEqual((await database.list()).map(item => item.id), ['offline']);
  assert.equal((await database.get('offline')).message, saved.message);
  assert.deepEqual(await database.takeLocal(), []);
  await database.markRead(['offline']);
  await database.clearRead();
  await publish(filename, { id: 'offline', message: 'Replay after clearing must stay cleared' });
  assert.deepEqual(await database.list(), []);
});

test('simultaneous shell producers retain every event and stable pane grouping', async t => {
  const { filename, open } = fixture(t);
  await Promise.all(Array.from({ length: 20 }, (_, index) => publish(filename, { id: `event-${index}` })));
  const database = await open();
  const received = await database.takeLocal();
  assert.equal(received.length, 20);
  assert.equal(new Set(received.map(item => item.id)).size, 20);
  assert.ok(received.every(item => item.metadata.tmux.target === '%94' && !item.read));
});

test('a transient SQLite lock retries the same event without duplicating it', async t => {
  const { root, filename } = fixture(t);
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'sqlite3'), '#!/bin/sh\nif [ ! -f "$NOTY_TEST_RETRY_MARKER" ]; then\n  touch "$NOTY_TEST_RETRY_MARKER"\n  echo "database is locked" >&2\n  exit 1\nfi\nexec /usr/bin/sqlite3 "$@"\n', { mode: 0o755 });
  await publish(filename, { id: 'retry-event' }, { PATH: `${bin}:${process.env.PATH}`, NOTY_TEST_RETRY_MARKER: path.join(root, 'retry-marker') });
  const database = await NotificationDatabase.open(filename);
  t.after(() => database.close());
  assert.deepEqual((await database.list()).map(item => item.id), ['retry-event']);
});

test('local receipt observes new writes while running and does not repeat them after restart', async t => {
  const { filename, open } = fixture(t);
  const database = await open();
  const received = [];
  const client = new LocalNotifications(database, item => received.push(item), { interval: 10 });
  await client.start();
  t.after(() => client.stop());
  await publish(filename, { id: 'live' });
  for (let attempt = 0; attempt < 100 && !received.length; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(received.map(item => item.id), ['live']);
  await client.stop();
  await database.dismiss(['live'], true);
  const restarted = new LocalNotifications(database, () => assert.fail('A received event must not alert twice'));
  await restarted.poll();
  assert.equal((await database.get('live')).read, true);
});

test('the installed command keeps its path across upgrades and finds its own database and schema', async t => {
  const { root, filename } = fixture(t);
  const appData = path.join(root, 'app data');
  const command = await prepareLocalNotificationTools(appData, path.resolve('.'), filename);
  const previousVersion = fs.realpathSync(command);
  const link = path.join(root, 'linked-command');
  fs.symlinkSync(command, link);
  await publish('', { id: 'before-upgrade' }, {}, link);
  const bundle = path.join(root, 'new bundle');
  fs.mkdirSync(path.join(bundle, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(bundle, 'scripts/ntfy-notify.example.sh'), `${fs.readFileSync('scripts/ntfy-notify.example.sh', 'utf8')}\n# updated publisher\n`);
  fs.copyFileSync('scripts/notification-schema.sql', path.join(bundle, 'scripts/notification-schema.sql'));
  assert.equal(await prepareLocalNotificationTools(appData, bundle, filename), command);
  assert.notEqual(fs.realpathSync(command), previousVersion);
  await publish('', { id: 'after-upgrade' }, {}, link);
  const database = await NotificationDatabase.open(filename);
  t.after(() => database.close());
  assert.deepEqual(new Set((await database.list()).map(item => item.id)), new Set(['before-upgrade', 'after-upgrade']));
});
