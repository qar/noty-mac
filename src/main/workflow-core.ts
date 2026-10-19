import { randomUUID } from 'node:crypto';
import type {
  WorkflowDefinition,
  WorkflowRun,
  WorkflowRunInput,
  WorkflowTaskDefinition,
  WorkflowTaskRun,
} from './workflow-types';

const TERMINAL = new Set(['succeeded', 'skipped']);

export function validateWorkflowDefinition(value: WorkflowDefinition): void {
  if (!value.name.trim()) throw new Error('工作流名称不能为空');
  if (value.stages.length === 0) throw new Error('工作流至少需要一个阶段');
  const aliases = new Set<string>();
  for (const repository of value.repositories) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(repository.alias)) {
      throw new Error(`仓库别名无效：${repository.alias}`);
    }
    if (aliases.has(repository.alias)) throw new Error(`仓库别名重复：${repository.alias}`);
    if (!repository.projectId || !repository.baseBranch) throw new Error('仓库和基线分支不能为空');
    aliases.add(repository.alias);
  }
  const taskIds = new Set<string>();
  for (const stage of value.stages) {
    if (!stage.name.trim() || stage.tasks.length === 0) throw new Error('阶段名称和任务不能为空');
    for (const task of stage.tasks) {
      if (!task.id || taskIds.has(task.id)) throw new Error(`任务 ID 重复：${task.id}`);
      taskIds.add(task.id);
      validateTask(task, aliases);
    }
  }
}

function validateTask(task: WorkflowTaskDefinition, aliases: Set<string>): void {
  if (!task.name.trim()) throw new Error('任务名称不能为空');
  if (task.repositoryAlias && !aliases.has(task.repositoryAlias)) {
    throw new Error(`任务引用了未知仓库：${task.repositoryAlias}`);
  }
  if (task.kind === 'command' && (!task.executable || !Array.isArray(task.args))) {
    throw new Error(`命令任务“${task.name}”缺少 executable 或 args`);
  }
  if (task.kind === 'ai' && (!task.aiProgramId || !task.prompt)) {
    throw new Error(`AI 任务“${task.name}”缺少程序或提示词`);
  }
}

export function taskDependencies(definition: WorkflowDefinition): Record<string, string[]> {
  const dependencies: Record<string, string[]> = {};
  let previousStage: string[] = [];
  for (const stage of definition.stages) {
    let previousTask = [...previousStage];
    for (const task of stage.tasks) {
      dependencies[task.id] = stage.mode === 'serial' ? [...previousTask] : [...previousStage];
      if (stage.mode === 'serial') previousTask = [task.id];
    }
    previousStage = stage.tasks.map((task) => task.id);
  }
  return dependencies;
}

export function createWorkflowRun(
  definition: WorkflowDefinition,
  input: WorkflowRunInput,
  now = Date.now()
): WorkflowRun {
  validateWorkflowDefinition(definition);
  if (!input.title.trim()) throw new Error('执行标题不能为空');
  const snapshot = structuredClone(definition);
  const dependencies = taskDependencies(snapshot);
  const tasks: Record<string, WorkflowTaskRun> = {};
  for (const stage of snapshot.stages) {
    for (const task of stage.tasks) {
      tasks[task.id] = {
        taskId: task.id,
        status: dependencies[task.id].length === 0 ? 'ready' : 'blocked',
        attempts: [],
      };
    }
  }
  return {
    id: randomUUID(), workflowId: definition.id, definition: snapshot,
    input: { ...input, title: input.title.trim() }, status: 'active', tasks,
    contexts: [], createdAt: now, updatedAt: now, completedAt: null,
  };
}

export function settleWorkflowRun(run: WorkflowRun, now = Date.now()): WorkflowRun {
  const next = structuredClone(run);
  const dependencies = taskDependencies(next.definition);
  for (const task of Object.values(next.tasks)) {
    if (task.status !== 'blocked') continue;
    if (dependencies[task.taskId].every((id) => TERMINAL.has(next.tasks[id].status))) {
      task.status = 'ready';
    }
  }
  const all = Object.values(next.tasks);
  if (all.every((task) => TERMINAL.has(task.status))) {
    next.status = all.some((task) => task.status === 'skipped')
      ? 'completed_with_skips' : 'completed';
    next.completedAt = now;
  }
  next.updatedAt = now;
  return next;
}

export function completeWorkflowTask(
  run: WorkflowRun,
  taskId: string,
  values: { note?: string; evidence?: string },
  now = Date.now()
): WorkflowRun {
  const next = structuredClone(run);
  const task = next.tasks[taskId];
  if (!task || task.status !== 'ready') throw new Error('任务当前不可完成');
  const definition = findTask(next.definition, taskId);
  if (definition.kind !== 'manual' && definition.kind !== 'approval') {
    throw new Error('自动任务必须通过执行器完成');
  }
  task.status = 'succeeded';
  task.note = values.note?.trim() || undefined;
  task.evidence = values.evidence?.trim() || undefined;
  return settleWorkflowRun(next, now);
}

export function skipWorkflowTask(run: WorkflowRun, taskId: string, reason: string): WorkflowRun {
  const next = structuredClone(run);
  const task = next.tasks[taskId];
  if (!task || !['ready', 'failed', 'interrupted'].includes(task.status)) {
    throw new Error('任务当前不可跳过');
  }
  if (!reason.trim()) throw new Error('跳过任务必须填写原因');
  task.status = 'skipped';
  task.skipReason = reason.trim();
  return settleWorkflowRun(next);
}

export function findTask(definition: WorkflowDefinition, taskId: string): WorkflowTaskDefinition {
  for (const stage of definition.stages) {
    const task = stage.tasks.find((candidate) => candidate.id === taskId);
    if (task) return task;
  }
  throw new Error('任务不存在');
}
