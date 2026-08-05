const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  defaultWorktreesDirectory,
  ensureWorktreesDirectory,
  normalizeWorktreesDirectory,
  preferencesFromStored,
  preferencesFromUpdate,
} = require('../dist/main/settings-core');

test('uses a stable worktrees default while preserving stored notification preferences', () => {
  const home = path.join(path.sep, 'Users', 'tester');
  assert.equal(defaultWorktreesDirectory(home), path.join(home, 'worktrees'));
  assert.deepEqual(preferencesFromStored({ soundEnabled: false, hideRead: false }, home), {
    soundEnabled: false,
    hideRead: false,
    worktreesDirectory: path.join(home, 'worktrees'),
  });
});

test('normalizes absolute and home-relative worktrees directories', () => {
  const home = path.join(path.sep, 'Users', 'tester');
  assert.equal(
    normalizeWorktreesDirectory('~/dev/worktrees/', home),
    path.join(home, 'dev', 'worktrees')
  );
  assert.equal(
    preferencesFromUpdate({
      soundEnabled: true,
      hideRead: false,
      worktreesDirectory: path.join(home, 'trees', '..', 'worktrees'),
    }, home).worktreesDirectory,
    path.join(home, 'worktrees')
  );
});

test('rejects empty, relative, and malformed worktrees directories', () => {
  const home = path.join(path.sep, 'Users', 'tester');
  assert.throws(() => normalizeWorktreesDirectory('', home), /不能为空/);
  assert.throws(() => normalizeWorktreesDirectory('relative/worktrees', home), /绝对路径/);
  assert.throws(() => normalizeWorktreesDirectory('/tmp/bad\0path', home), /格式无效/);
  assert.throws(
    () => preferencesFromUpdate({ soundEnabled: true, worktreesDirectory: '/tmp' }, home),
    /偏好设置格式无效/
  );
});

test('creates a writable worktrees directory and rejects a file path', async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'noty-settings-'));
  t.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));

  const directory = path.join(temporaryRoot, 'nested', 'worktrees');
  await ensureWorktreesDirectory(directory);
  assert.equal((await fs.stat(directory)).isDirectory(), true);

  const file = path.join(temporaryRoot, 'not-a-directory');
  await fs.writeFile(file, 'content');
  await assert.rejects(() => ensureWorktreesDirectory(file), /不是目录/);
});
