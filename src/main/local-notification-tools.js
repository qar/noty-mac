const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

async function writeAtomic(filename, content, mode) {
  try { if (await fs.readFile(filename, 'utf8') === content) return; } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, content, { mode, flag: 'wx' });
    await fs.rename(temporary, filename);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function prepareLocalNotificationTools(directory, bundleRoot, databasePath = path.join(directory, 'notifications.sqlite3')) {
  const script = await fs.readFile(path.join(bundleRoot, 'scripts/ntfy-notify.example.sh'), 'utf8');
  const schema = await fs.readFile(path.join(bundleRoot, 'scripts/notification-schema.sql'), 'utf8');
  const version = crypto.createHash('sha256').update(script).update(schema).update(databasePath).digest('hex').slice(0, 20);
  const root = path.join(directory, 'notification-tools');
  const versionDirectory = path.join(root, version);
  await fs.mkdir(versionDirectory, { recursive: true, mode: 0o700 });
  await writeAtomic(path.join(versionDirectory, 'noty-notify'), script, 0o755);
  await writeAtomic(path.join(versionDirectory, 'notification-schema.sql'), schema, 0o600);
  await writeAtomic(path.join(versionDirectory, 'database-path'), `${databasePath}\n`, 0o600);
  // Switch only after both assets are complete, including during publication.
  const temporary = path.join(root, `current.${crypto.randomUUID()}`);
  try {
    await fs.symlink(version, temporary);
    await fs.rename(temporary, path.join(root, 'current'));
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return path.join(root, 'current/noty-notify');
}

module.exports = { prepareLocalNotificationTools };
