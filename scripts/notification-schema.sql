PRAGMA busy_timeout = 5000;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;

BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS notification_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK (source IN ('local', 'ntfy', 'legacy')),
  channel_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('tmux-agent', 'plane')),
  ntfy_id TEXT,
  group_key TEXT,
  timestamp INTEGER NOT NULL,
  is_read INTEGER NOT NULL CHECK (is_read IN (0, 1)),
  completed_at INTEGER,
  presented INTEGER NOT NULL DEFAULT 1 CHECK (presented IN (0, 1)),
  payload TEXT NOT NULL CHECK (json_valid(payload) AND json_type(payload) = 'object')
);
CREATE TABLE IF NOT EXISTS notification_deliveries (
  key TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_time ON notifications(timestamp DESC, seq DESC);
CREATE INDEX IF NOT EXISTS notifications_channel ON notifications(channel_id, ntfy_id);
CREATE INDEX IF NOT EXISTS notifications_channel_time ON notifications(channel_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS notifications_pending ON notifications(kind, is_read, completed_at, timestamp DESC);
CREATE INDEX IF NOT EXISTS notifications_group ON notifications(group_key, timestamp DESC);
CREATE INDEX IF NOT EXISTS notifications_local_pending ON notifications(seq) WHERE source = 'local' AND presented = 0;
INSERT OR IGNORE INTO notification_meta(key, value) VALUES ('schema_version', '1');
CREATE TEMP TABLE notification_schema_guard (version TEXT NOT NULL CHECK (version = '1'));
INSERT INTO notification_schema_guard VALUES ((SELECT value FROM notification_meta WHERE key = 'schema_version'));
DROP TABLE notification_schema_guard;
COMMIT;
