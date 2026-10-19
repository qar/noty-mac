const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  defaultProjectsDirectory,
  defaultWorktreesDirectory,
  ensureProjectsDirectory,
  ensureWorktreesDirectory,
  normalizeProjectsDirectory,
  normalizeWorktreesDirectory,
  preferencesFromStored,
  preferencesFromUpdate,
} = require('../dist/main/settings-core');

test('uses stable repository defaults while preserving notification preferences', () => {
  const home = path.join(path.sep, 'Users', 'tester');
  assert.equal(defaultProjectsDirectory(home), path.join(home, 'projects'));
  assert.equal(defaultWorktreesDirectory(home), path.join(home, 'worktrees'));
  assert.deepEqual(preferencesFromStored({ soundEnabled: false, hideRead: false }, home), {
    soundEnabled: false,
    hideRead: false,
    projectsDirectory: path.join(home, 'projects'),
    worktreesDirectory: path.join(home, 'worktrees'),
  });
});

test('normalizes absolute and home-relative repository directories', () => {
  const home = path.join(path.sep, 'Users', 'tester');
  assert.equal(
    normalizeProjectsDirectory('~/dev/projects/', home),
    path.join(home, 'dev', 'projects')
  );
  assert.equal(
    normalizeWorktreesDirectory('~/dev/worktrees/', home),
    path.join(home, 'dev', 'worktrees')
  );
  assert.equal(
    preferencesFromUpdate({
      soundEnabled: true,
      hideRead: false,
      projectsDirectory: path.join(home, 'projects'),
      worktreesDirectory: path.join(home, 'trees', '..', 'worktrees'),
    }, home).worktreesDirectory,
    path.join(home, 'worktrees')
  );
});

test('rejects empty, relative, and malformed repository directories', () => {
  const home = path.join(path.sep, 'Users', 'tester');
  assert.throws(() => normalizeProjectsDirectory('', home), /不能为空/);
  assert.throws(() => normalizeProjectsDirectory('relative/projects', home), /绝对路径/);
  assert.throws(() => normalizeWorktreesDirectory('', home), /不能为空/);
  assert.throws(() => normalizeWorktreesDirectory('relative/worktrees', home), /绝对路径/);
  assert.throws(() => normalizeWorktreesDirectory('/tmp/bad\0path', home), /格式无效/);
  assert.throws(
    () => preferencesFromUpdate({ soundEnabled: true, worktreesDirectory: '/tmp' }, home),
    /偏好设置格式无效/
  );
});

test('requires an existing readable projects directory without creating it', async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'noty-projects-'));
  t.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));

  const directory = path.join(temporaryRoot, 'projects');
  await fs.mkdir(directory);
  assert.equal(
    await ensureProjectsDirectory(directory),
    await fs.realpath(directory)
  );

  const missing = path.join(temporaryRoot, 'missing');
  await assert.rejects(() => ensureProjectsDirectory(missing), /不存在/);
  await assert.rejects(() => fs.stat(missing), /ENOENT/);

  const file = path.join(temporaryRoot, 'not-a-directory');
  await fs.writeFile(file, 'content');
  await assert.rejects(() => ensureProjectsDirectory(file), /不是目录/);
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
