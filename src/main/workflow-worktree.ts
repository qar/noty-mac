import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { WorkflowExecutionContext, WorkflowRepository, WorkflowRunInput } from './workflow-types';

const execFileAsync = promisify(execFile);

export async function createWorkflowContexts(input: {
  repositories: WorkflowRepository[];
  runInput: WorkflowRunInput;
  workflowName: string;
  runId: string;
  rootDirectory: string;
}): Promise<WorkflowExecutionContext[]> {
  const root = path.resolve(input.rootDirectory);
  await fs.mkdir(root, { recursive: true });
  const contexts: WorkflowExecutionContext[] = [];
  try {
    for (const repository of input.repositories) {
      const baseBranch = input.runInput.baseBranches?.[repository.alias] ?? repository.baseBranch;
      const slug = safeSlug(`${input.workflowName}-${input.runInput.title}-${repository.alias}`);
      const directory = path.join(root, `${slug}-${input.runId.slice(0, 8)}`);
      const relative = path.relative(root, directory);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('worktree 路径越界');
      const branch = `noty/${slug}-${input.runId.slice(0, 8)}`;
      await execFileAsync('git', ['-C', repository.projectId, 'rev-parse', '--verify', baseBranch]);
      await execFileAsync('git', ['-C', repository.projectId, 'worktree', 'add', '-b', branch, directory, baseBranch]);
      contexts.push({ repositoryAlias: repository.alias, projectId: repository.projectId, baseBranch, branch, directory });
    }
    return contexts;
  } catch (error) {
    await rollbackWorkflowContexts(contexts);
    throw error;
  }
}

export async function removeCleanWorkflowContexts(contexts: WorkflowExecutionContext[]): Promise<void> {
  for (const context of contexts) {
    const { stdout } = await execFileAsync('git', ['-C', context.directory, 'status', '--porcelain']);
    if (stdout.trim()) throw new Error(`${context.repositoryAlias} 的 worktree 有未提交修改`);
  }
  for (const context of contexts) {
    await execFileAsync('git', ['-C', context.projectId, 'worktree', 'remove', context.directory]);
  }
}

async function rollbackWorkflowContexts(contexts: WorkflowExecutionContext[]): Promise<void> {
  for (const context of [...contexts].reverse()) {
    try { await execFileAsync('git', ['-C', context.projectId, 'worktree', 'remove', '--force', context.directory]); } catch { /* best effort */ }
    try { await execFileAsync('git', ['-C', context.projectId, 'branch', '-D', context.branch]); } catch { /* branch was created only for this failed run */ }
  }
}

function safeSlug(value: string): string {
  return value.normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'workflow';
}
