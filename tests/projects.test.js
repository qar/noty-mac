const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  discoverProjects,
  projectIdForWorkingDirectory,
} = require('../dist/main/project-core');

test('discovers only immediate non-hidden ordinary directories', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'noty-project-scan-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await Promise.all([
    fs.mkdir(path.join(root, 'alpha')),
    fs.mkdir(path.join(root, 'project2')),
    fs.mkdir(path.join(root, 'project10')),
    fs.mkdir(path.join(root, '.hidden')),
    fs.writeFile(path.join(root, 'README.md'), 'not a project'),
  ]);
  await fs.mkdir(path.join(root, 'alpha', 'nested'));
  await fs.symlink(path.join(root, 'alpha'), path.join(root, 'linked-project'));

  const projects = await discoverProjects(root);
  const canonicalRoot = await fs.realpath(root);
  assert.deepEqual(
    projects.map((project) => project.name),
    ['alpha', 'project2', 'project10']
  );
  assert.deepEqual(
    projects.map((project) => project.id),
    projects.map((project) => project.directory)
  );
  assert.equal(
    projects.every((project) =>
      project.directory.startsWith(`${canonicalRoot}${path.sep}`)
    ),
    true
  );
});

test('maps a working directory to its immediate project with path boundaries', () => {
  const root = path.join(path.sep, 'Users', 'tester', 'projects');
  const project = path.join(root, 'noty-mac');

  assert.equal(projectIdForWorkingDirectory(root, project), project);
  assert.equal(
    projectIdForWorkingDirectory(root, path.join(project, 'src', 'main')),
    project
  );
  assert.equal(projectIdForWorkingDirectory(root, root), null);
  assert.equal(
    projectIdForWorkingDirectory(
      root,
      path.join(path.dirname(root), 'projects-old', 'noty-mac')
    ),
    null
  );
  assert.equal(
    projectIdForWorkingDirectory(root, path.join(root, '.hidden', 'src')),
    null
  );
  assert.equal(projectIdForWorkingDirectory(root, 'relative/project'), null);
  assert.equal(projectIdForWorkingDirectory(root, null), null);
});
