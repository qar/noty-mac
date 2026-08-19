const test = require('node:test');
const assert = require('node:assert/strict');

const {
  completeWorkflowTask,
  createWorkflowRun,
  settleWorkflowRun,
  skipWorkflowTask,
  taskDependencies,
  validateWorkflowDefinition,
} = require('../dist/main/workflow-core');

function definition(stages) {
  return {
    id: 'workflow-1',
    name: '维护统计图表',
    description: '',
    version: 1,
    repositories: [],
    stages,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

const manual = (id) => ({ id, name: id, kind: 'manual' });

test('compiles serial and parallel stages into deterministic dependencies', () => {
  const workflow = definition([
    { id: 's1', name: '开发', mode: 'parallel', tasks: [manual('a'), manual('b')] },
    { id: 's2', name: '提测', mode: 'serial', tasks: [manual('c'), manual('d')] },
  ]);
  assert.deepEqual(taskDependencies(workflow), {
    a: [], b: [], c: ['a', 'b'], d: ['c'],
  });
});

test('takes an immutable definition snapshot and unlocks downstream tasks', () => {
  const workflow = definition([
    { id: 's1', name: '开发', mode: 'parallel', tasks: [manual('a'), manual('b')] },
    { id: 's2', name: '发布', mode: 'serial', tasks: [manual('c')] },
  ]);
  let run = createWorkflowRun(workflow, { title: 'v1.2.4' }, 10);
  workflow.name = '后来修改的名称';
  assert.equal(run.definition.name, '维护统计图表');
  assert.equal(run.tasks.a.status, 'ready');
  assert.equal(run.tasks.c.status, 'blocked');
  run = completeWorkflowTask(run, 'a', {}, 20);
  assert.equal(run.tasks.c.status, 'blocked');
  run = completeWorkflowTask(run, 'b', { evidence: 'commit abc' }, 30);
  assert.equal(run.tasks.c.status, 'ready');
  run = completeWorkflowTask(run, 'c', {}, 40);
  assert.equal(run.status, 'completed');
  assert.equal(run.completedAt, 40);
});

test('failure blocks dependants while retry state can later settle', () => {
  const workflow = definition([
    { id: 's1', name: '构建', mode: 'serial', tasks: [
      { id: 'build', name: '构建', kind: 'command', executable: 'npm', args: ['test'] },
      manual('publish'),
    ] },
  ]);
  let run = createWorkflowRun(workflow, { title: 'build' });
  run.tasks.build.status = 'failed';
  run = settleWorkflowRun(run);
  assert.equal(run.tasks.publish.status, 'blocked');
  run.tasks.build.status = 'succeeded';
  run = settleWorkflowRun(run);
  assert.equal(run.tasks.publish.status, 'ready');
});

test('requires a reason to skip and marks the run completed with skips', () => {
  const workflow = definition([
    { id: 's1', name: '发布', mode: 'serial', tasks: [manual('mail')] },
  ]);
  const run = createWorkflowRun(workflow, { title: 'release' });
  assert.throws(() => skipWorkflowTask(run, 'mail', '   '), /原因/);
  const skipped = skipWorkflowTask(run, 'mail', '平台维护');
  assert.equal(skipped.status, 'completed_with_skips');
  assert.equal(skipped.tasks.mail.skipReason, '平台维护');
});

test('rejects invalid repository references and incomplete automatic tasks', () => {
  assert.throws(() => validateWorkflowDefinition(definition([
    { id: 's', name: '开发', mode: 'serial', tasks: [
      { id: 'task', name: '修改', kind: 'command', repositoryAlias: 'missing' },
    ] },
  ])), /未知仓库/);
});
