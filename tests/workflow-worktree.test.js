const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const exec = promisify(execFile);
const {
  createWorkflowContexts,
  removeCleanWorkflowContexts,
} = require('../dist/main/workflow-worktree');

async function repository(root, name) {
  const directory = path.join(root, name);
  await fs.mkdir(directory);
  await exec('git', ['init', '-b', 'main', directory]);
  await exec('git', ['-C', directory, 'config', 'user.email', 'test@example.com']);
  await exec('git', ['-C', directory, 'config', 'user.name', 'Test']);
  await fs.writeFile(path.join(directory, 'README.md'), name);
  await exec('git', ['-C', directory, 'add', 'README.md']);
  await exec('git', ['-C', directory, 'commit', '-m', 'initial']);
  return directory;
}

test('creates one isolated context per repository and preserves branches on cleanup', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'noty-workflow-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repo = await repository(root, 'repo');
  const worktrees = path.join(root, 'worktrees');
  const contexts = await createWorkflowContexts({
    repositories: [{ alias: 'app', projectId: repo, baseBranch: 'main' }],
    runInput: { title: 'Release 1' }, workflowName: 'Charts',
    runId: '12345678-abcd', rootDirectory: worktrees,
  });
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].directory.startsWith(`${worktrees}${path.sep}`), true);
  assert.equal((await fs.stat(contexts[0].directory)).isDirectory(), true);
  assert.match(contexts[0].branch, /^noty\//);
  await removeCleanWorkflowContexts(contexts);
  await assert.rejects(() => fs.stat(contexts[0].directory), /ENOENT/);
  await exec('git', ['-C', repo, 'rev-parse', '--verify', contexts[0].branch]);
});

test('refuses to remove a dirty execution context', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'noty-workflow-dirty-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repo = await repository(root, 'repo');
  const contexts = await createWorkflowContexts({
    repositories: [{ alias: 'app', projectId: repo, baseBranch: 'main' }],
    runInput: { title: 'Dirty' }, workflowName: 'Charts',
    runId: 'abcdef12-rest', rootDirectory: path.join(root, 'worktrees'),
  });
  await fs.writeFile(path.join(contexts[0].directory, 'change.txt'), 'dirty');
  await assert.rejects(() => removeCleanWorkflowContexts(contexts), /未提交修改/);
  assert.equal((await fs.stat(contexts[0].directory)).isDirectory(), true);
});

test('rolls back contexts when a later repository is invalid', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'noty-workflow-rollback-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repo = await repository(root, 'repo');
  const worktrees = path.join(root, 'worktrees');
  await assert.rejects(() => createWorkflowContexts({
    repositories: [
      { alias: 'good', projectId: repo, baseBranch: 'main' },
      { alias: 'bad', projectId: path.join(root, 'missing'), baseBranch: 'main' },
    ],
    runInput: { title: 'Rollback' }, workflowName: 'Charts',
    runId: '99887766-rest', rootDirectory: worktrees,
  }));
  assert.deepEqual(await fs.readdir(worktrees), []);
  const branches = (await exec('git', ['-C', repo, 'branch', '--list', 'noty/*'])).stdout.trim();
  assert.equal(branches, '');
});
