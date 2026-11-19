const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NotificationDatabase, migrateLegacyStore } = require('../dist/main/notification-database');

function item(id, extra = {}) {
  return { id, channelId: 'test', type: 'tmux-agent', message: `Message ${id}`, timestamp: 100, read: false, ...extra };
}

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noty-sqlite-'));
  const filename = path.join(root, 'notifications.sqlite3');
  const connections = [];
  const open = async () => {
    const database = await NotificationDatabase.open(filename);
    connections.push(database);
    return database;
  };
  t.after(async () => {
    for (const connection of connections) if (!connection.closed) await connection.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { database: await open(), open, filename, root };
}

test('legacy migration preserves every field and never resurrects cleared records', async t => {
  const { database, open } = await fixture(t);
  const legacy = [item('new', { message: '中文\n{"quoted":"\'"}', metadata: { custom: { value: [1, 2] } } }),
    item('plane', { type: 'plane', read: true, completedAt: 50, metadata: { plane: { rawPayload: '{"event":"issue_comment"}' } } }),
    item('old', { read: true })];
  assert.equal(await database.migrateLegacy(legacy), true);
  assert.deepEqual(await database.list(), legacy);
  await database.clearRead();
  const reopened = await open();
  assert.equal(await reopened.migrateLegacy(legacy), false);
  assert.deepEqual(await reopened.list(), legacy.slice(0, 2));
  assert.equal(await reopened.migrateLegacy([item('late-old-version-record'), ...legacy]), true);
  const updated = await reopened.list();
  assert.equal(updated.length, 3);
  assert.ok(updated.some(entry => entry.id === 'late-old-version-record'));
  assert.ok(!updated.some(entry => entry.id === 'old'));
});

test('failed migration rolls back all imported rows and can be retried', async t => {
  const { database } = await fixture(t);
  await assert.rejects(database.migrateLegacy([{ bad: true }, item('valid')]));
  assert.deepEqual(await database.list(), []);
  assert.equal(await database.migrateLegacy([item('valid')]), true);
  assert.equal((await database.list()).length, 1);
});

test('JSON store is backed up before migration and removed only after successful import', async t => {
  const { database, root } = await fixture(t);
  const original = [item('plane', { type: 'plane', read: true, completedAt: 123 }), item('tmux')];
  let legacy = original;
  const store = { get: () => legacy, delete: () => { legacy = undefined; } };
  await migrateLegacyStore(database, store, root);
  assert.equal(legacy, undefined);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'notifications-legacy-backup.json'), 'utf8')), original);
  assert.deepEqual(await database.list(), original);
  assert.equal(fs.statSync(path.join(root, 'notifications-legacy-backup.json')).mode & 0o777, 0o600);
});

test('failed import leaves the active JSON data and its backup intact', async t => {
  const { database, root } = await fixture(t);
  const original = [item('conflict', { message: 'First' }), item('conflict', { message: 'Second' })];
  const store = { get: () => original, delete: () => assert.fail('Failed migration must not delete legacy data') };
  await assert.rejects(migrateLegacyStore(database, store, root), /Conflicting legacy/);
  assert.deepEqual(await database.list(), []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'notifications-legacy-backup.json'), 'utf8')), original);
});

test('delivery deduplication survives clearing and keeps separate events for one task', async t => {
  const { database } = await fixture(t);
  assert.equal(await database.insert(item('one', { ntfyId: 'delivery' })), true);
  assert.equal(await database.insert(item('duplicate', { ntfyId: 'delivery' })), false);
  await database.markRead(['one']);
  await database.clearRead();
  assert.equal(await database.insert(item('replay', { ntfyId: 'delivery' })), false);
  for (const id of ['comment-a', 'comment-b']) assert.equal(await database.insert(item(id, {
    type: 'plane', ntfyId: id, completedAt: null,
    metadata: { plane: { issueId: 'same-task', deliveryId: id, rawPayload: '{}' } },
  })), true);
  assert.equal(await database.insert(item('plane-replay', { type: 'plane',
    metadata: { plane: { deliveryId: 'comment-a' } } })), false);
  assert.equal((await database.list()).length, 2);
});

test('content enrichment cannot overwrite acknowledgement or concurrent local arrivals', async t => {
  const { database, open } = await fixture(t);
  const sender = await open();
  const plane = item('plane', { type: 'plane', completedAt: null });
  await database.insert(plane);
  const snapshot = await database.list();
  await database.dismiss(['plane'], true, 123);
  await sender.insert(item('local', { channelId: 'local-tmux' }), 'local');
  snapshot[0].title = 'Enriched title';
  await database.updateContent(snapshot);
  const actual = await database.get('plane');
  assert.equal(actual.title, 'Enriched title');
  assert.equal(actual.read, true);
  assert.equal(actual.completedAt, 123);
  assert.deepEqual((await database.list({ pendingOnly: true })).map(entry => entry.id), ['local']);
  await database.dismiss(['plane'], false);
  assert.equal((await database.get('plane')).completedAt, null);
});

test('concurrent database connections publish and claim each offline local notification once', async t => {
  const { database, open } = await fixture(t);
  const other = await open();
  const records = Array.from({ length: 40 }, (_, index) => item(`local-${index}`, { channelId: 'local-tmux' }));
  await Promise.all(records.map((record, index) => (index % 2 ? other : database).insert(record, 'local')));
  const claimed = (await Promise.all([database.takeLocal(), other.takeLocal()])).flat();
  assert.equal(claimed.length, records.length);
  assert.equal(new Set(claimed.map(record => record.id)).size, records.length);
  assert.deepEqual(await database.takeLocal(), []);
  assert.equal((await database.list()).length, records.length);
});

test('indexed tray count matches task and pane grouping after acknowledgement and restore', async t => {
  const { database } = await fixture(t);
  for (const id of ['pane-a', 'pane-b']) await database.insert(item(id, { metadata: { tmux: { target: '%94' } } }));
  for (const id of ['comment-a', 'comment-b']) await database.insert(item(id, {
    type: 'plane', completedAt: null, metadata: { plane: { issueId: 'same-task', workspaceSlug: 'company' } },
  }));
  assert.equal(await database.pendingGroupCount(), 2);
  await database.dismiss(['pane-a', 'pane-b'], true);
  assert.equal(await database.pendingGroupCount(), 1);
  await database.dismiss(['comment-a'], true, 1000);
  assert.equal(await database.pendingGroupCount(), 1);
  await database.dismiss(['comment-b'], true, 1000);
  assert.equal(await database.pendingGroupCount(), 0);
  await database.dismiss(['pane-a'], false);
  assert.equal(await database.pendingGroupCount(), 1);
});
