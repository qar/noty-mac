const sqlite3 = require('@vscode/sqlite3');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { notificationGroupKey } = require('./notification-groups');

const LOCAL_CHANNEL = Object.freeze({
  id: 'local-tmux', name: '本机 AI 通知', type: 'tmux-agent', transport: 'local', url: 'local://tmux',
});

function validateNotification(item) {
  if (!item || typeof item.id !== 'string' || !item.id || typeof item.channelId !== 'string'
    || typeof item.message !== 'string' || !Number.isFinite(item.timestamp) || typeof item.read !== 'boolean'
    || (item.type !== undefined && !['plane', 'tmux-agent'].includes(item.type))) {
    throw new Error('Invalid notification record');
  }
}

function deliveryKeys(item) {
  return [
    JSON.stringify(['id', item.id]),
    item.ntfyId ? JSON.stringify(['ntfy', item.channelId, item.ntfyId]) : null,
    item.metadata?.plane?.deliveryId ? JSON.stringify(['plane', item.channelId, item.metadata.plane.deliveryId]) : null,
  ].filter(Boolean);
}

function decode(row) {
  if (!row) return null;
  const item = JSON.parse(row.payload);
  item.read = Boolean(row.is_read);
  if (item.type === 'plane' || Object.hasOwn(item, 'completedAt')) item.completedAt = row.completed_at;
  return item;
}

class NotificationDatabase {
  static async open(filename, schemaPath = path.join(__dirname, '../../scripts/notification-schema.sql')) {
    await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    const file = await fs.open(filename, 'a', 0o600);
    await file.close();
    const database = await new Promise((resolve, reject) => {
      const connection = new sqlite3.Database(filename, error => error ? reject(error) : resolve(connection));
    });
    database.configure('busyTimeout', 5000);
    const repository = new NotificationDatabase(database);
    try {
      const schema = await fs.readFile(schemaPath, 'utf8');
      for (let attempt = 0; ; attempt++) {
        try { await repository._exec(schema); break; } catch (error) {
          if (!['SQLITE_BUSY', 'SQLITE_LOCKED'].includes(error.code) || attempt === 3) throw error;
          await repository._exec('ROLLBACK').catch(() => {});
          await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
        }
      }
      const version = await repository._get("SELECT value FROM notification_meta WHERE key = 'schema_version'");
      if (version?.value !== '1') throw new Error('Unsupported notification database version');
      return repository;
    } catch (error) {
      await repository.close();
      throw error;
    }
  }

  constructor(database) {
    this.database = database;
    this.queue = Promise.resolve();
  }

  _enqueue(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  _run(sql, values = []) {
    return new Promise((resolve, reject) => this.database.run(sql, values, function (error) {
      error ? reject(error) : resolve({ changes: this.changes, lastID: this.lastID });
    }));
  }

  _get(sql, values = []) {
    return new Promise((resolve, reject) => this.database.get(sql, values, (error, row) => error ? reject(error) : resolve(row)));
  }

  _all(sql, values = []) {
    return new Promise((resolve, reject) => this.database.all(sql, values, (error, rows) => error ? reject(error) : resolve(rows)));
  }

  _exec(sql) {
    return new Promise((resolve, reject) => this.database.exec(sql, error => error ? reject(error) : resolve()));
  }

  async _transaction(operation) {
    await this._exec('BEGIN IMMEDIATE');
    try {
      const result = await operation();
      await this._exec('COMMIT');
      return result;
    } catch (error) {
      await this._exec('ROLLBACK');
      throw error;
    }
  }

  async _insert(item, source, presented = true) {
    validateNotification(item);
    return this._run(`INSERT INTO notifications
      (id, source, channel_id, kind, ntfy_id, group_key, timestamp, is_read, completed_at, presented, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`, [
      item.id, source, item.channelId, item.type || 'tmux-agent', item.ntfyId || null,
      notificationGroupKey(item), item.timestamp, Number(item.read), item.completedAt ?? null,
      Number(presented), JSON.stringify(item),
    ]);
  }

  async _rememberDelivery(item) {
    for (const key of deliveryKeys(item)) {
      await this._run('INSERT OR IGNORE INTO notification_deliveries(key, notification_id) VALUES (?, ?)', [key, item.id]);
    }
  }

  migrateLegacy(items) {
    return this._enqueue(() => this._transaction(async () => {
      const firstImport = !await this._get("SELECT 1 FROM notification_meta WHERE key = 'legacy_imported'");
      if (!Array.isArray(items)) throw new Error('Legacy notifications must be an array');
      const identities = new Map();
      for (const item of items) {
        validateNotification(item);
        const content = JSON.stringify(item);
        if (identities.has(item.id) && identities.get(item.id) !== content) throw new Error(`Conflicting legacy notification ID: ${item.id}`);
        identities.set(item.id, content);
      }
      let imported = 0;
      // Preserve equal-timestamp ordering from the original newest-first list.
      for (const item of [...items].reverse()) {
        if (await this._get('SELECT 1 FROM notification_deliveries WHERE key = ?', [JSON.stringify(['id', item.id])])) continue;
        const result = await this._insert(item, 'legacy');
        if (!result.changes && JSON.stringify(decode(await this._get('SELECT * FROM notifications WHERE id = ?', [item.id]))) !== JSON.stringify(item)) {
          throw new Error(`Conflicting legacy notification ID: ${item.id}`);
        }
        await this._rememberDelivery(item);
        imported += result.changes;
      }
      await this._run("INSERT OR IGNORE INTO notification_meta(key, value) VALUES ('legacy_imported', ?)", [String(Date.now())]);
      return firstImport || imported > 0;
    }));
  }

  list({ pendingOnly = false, channelId, type } = {}) {
    const conditions = [], values = [];
    if (pendingOnly) conditions.push("((kind = 'plane' AND COALESCE(completed_at, 0) = 0) OR (kind != 'plane' AND is_read = 0))");
    if (channelId !== undefined) { conditions.push('channel_id = ?'); values.push(channelId); }
    if (type !== undefined) { conditions.push('kind = ?'); values.push(type); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return this._enqueue(async () => (await this._all(`SELECT * FROM notifications ${where} ORDER BY timestamp DESC, seq DESC`, values)).map(decode));
  }

  get(id) {
    return this._enqueue(async () => decode(await this._get('SELECT * FROM notifications WHERE id = ?', [id])));
  }

  findNtfy(channelId, ntfyId) {
    return this._enqueue(async () => decode(await this._get('SELECT * FROM notifications WHERE channel_id = ? AND ntfy_id = ?', [channelId, ntfyId])));
  }

  pendingGroupCount() {
    return this._enqueue(async () => (await this._get(`SELECT COUNT(DISTINCT COALESCE(group_key, id)) AS count FROM notifications
      WHERE (kind = 'plane' AND COALESCE(completed_at, 0) = 0) OR (kind != 'plane' AND is_read = 0)`)).count);
  }

  insert(item, source = 'ntfy') {
    return this._enqueue(() => this._transaction(async () => {
      for (const key of deliveryKeys(item)) {
        if (await this._get('SELECT 1 FROM notification_deliveries WHERE key = ?', [key])) return false;
      }
      const result = await this._insert(item, source, source !== 'local');
      if (result.changes) await this._rememberDelivery(item);
      return Boolean(result.changes);
    }));
  }

  updateContent(items) {
    return this._enqueue(() => this._transaction(async () => {
      let changes = 0;
      for (const item of items) {
        validateNotification(item);
        // Read/completion columns remain authoritative during async enrichment.
        const result = await this._run('UPDATE notifications SET payload = ?, group_key = ? WHERE id = ? AND payload != ?',
          [JSON.stringify(item), notificationGroupKey(item), item.id, JSON.stringify(item)]);
        changes += result.changes;
      }
      return changes;
    }));
  }

  markRead(ids = null) {
    return this._updateSelected(ids, 'is_read = 1');
  }

  dismiss(ids, dismissed, now = Date.now()) {
    return this._updateSelected(ids,
      `is_read = ?, completed_at = CASE WHEN kind = 'plane' THEN ${dismissed ? 'COALESCE(completed_at, ?)' : 'NULL'} ELSE completed_at END`,
      dismissed ? [1, now] : [0]);
  }

  complete(id, completed, now = Date.now()) {
    return this._enqueue(() => this._run(`UPDATE notifications SET completed_at = ?, is_read = CASE WHEN ? THEN 1 ELSE is_read END
      WHERE id = ? AND kind = 'plane'`, [completed ? now : null, Number(completed), id]));
  }

  _updateSelected(ids, assignment, values = []) {
    return this._enqueue(() => this._transaction(async () => {
      if (ids === null) return (await this._run(`UPDATE notifications SET ${assignment}`, values)).changes;
      if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) throw new Error('Invalid notification IDs');
      let changes = 0;
      // Bound parameter counts for large reminder groups.
      for (let offset = 0; offset < ids.length; offset += 400) {
        const batch = ids.slice(offset, offset + 400);
        changes += (await this._run(`UPDATE notifications SET ${assignment} WHERE id IN (${batch.map(() => '?').join(',')})`, [...values, ...batch])).changes;
      }
      return changes;
    }));
  }

  clearRead() {
    return this._enqueue(() => this._run("DELETE FROM notifications WHERE kind != 'plane' AND is_read = 1"));
  }

  takeLocal(limit = 100) {
    return this._enqueue(async () => {
      if (!await this._get("SELECT 1 FROM notifications WHERE source = 'local' AND presented = 0 LIMIT 1")) return [];
      return this._transaction(async () => {
        const rows = await this._all("SELECT * FROM notifications WHERE source = 'local' AND presented = 0 ORDER BY seq LIMIT ?", [limit]);
        for (const row of rows) await this._run('UPDATE notifications SET presented = 1 WHERE seq = ?', [row.seq]);
        return rows.map(decode);
      });
    });
  }

  close() {
    return this._enqueue(() => new Promise((resolve, reject) => this.database.close(error => {
      if (error) reject(error);
      else { this.closed = true; resolve(); }
    })));
  }
}

async function migrateLegacyStore(database, store, directory) {
  const legacy = store.get('notifications');
  if (Array.isArray(legacy) && legacy.length) {
    const backup = path.join(directory, 'notifications-legacy-backup.json');
    const serialized = JSON.stringify(legacy);
    try {
      await fs.writeFile(backup, serialized, { mode: 0o600, flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (await fs.readFile(backup, 'utf8') !== serialized) {
        const digest = crypto.createHash('sha256').update(serialized).digest('hex').slice(0, 16);
        await fs.writeFile(path.join(directory, `notifications-legacy-backup-${digest}.json`), serialized, { mode: 0o600, flag: 'wx' })
          .catch(error => { if (error.code !== 'EEXIST') throw error; });
      }
    }
  }
  await database.migrateLegacy(legacy ?? []);
  if (legacy !== undefined) store.delete('notifications');
}

module.exports = { NotificationDatabase, migrateLegacyStore, LOCAL_CHANNEL };
