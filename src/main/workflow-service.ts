import { app, type WebContents } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  buildLocalAiArguments,
  buildLocalAiEnvironment,
  normalizeLocalAiProgram,
  resolveLocalAiExecutable,
} from './local-ai-core';
import { startLocalAiProcess, type LocalAiProcessHandle } from './local-ai-process';
import { loadLocalAiPrograms } from './local-ai-storage';
import { preferencesFromStored } from './settings-core';
import {
  completeWorkflowTask, createWorkflowRun, findTask, settleWorkflowRun,
  skipWorkflowTask, validateWorkflowDefinition,
} from './workflow-core';
import type {
  CompleteWorkflowTaskInput, WorkflowDefinition, WorkflowRun,
  WorkflowRunInput, WorkflowSnapshot, WorkflowTaskAttempt,
} from './workflow-types';
import { createWorkflowContexts, removeCleanWorkflowContexts } from './workflow-worktree';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const store = require('./store');

export class WorkflowService {
  private active = new Map<string, LocalAiProcessHandle>();

  constructor() {
    this.recoverInterruptedRuns();
  }

  snapshot(): WorkflowSnapshot {
    return { definitions: this.definitions(), runs: this.runs() };
  }

  saveDefinition(input: WorkflowDefinition): WorkflowDefinition {
    const definitions = this.definitions();
    const existing = definitions.find((item) => item.id === input.id);
    const now = Date.now();
    const next: WorkflowDefinition = {
      ...structuredClone(input), id: input.id || randomUUID(),
      name: input.name.trim(), version: existing ? existing.version + 1 : 1,
      createdAt: existing?.createdAt ?? now, updatedAt: now,
    };
    validateWorkflowDefinition(next);
    const index = definitions.findIndex((item) => item.id === next.id);
    if (index < 0) definitions.push(next); else definitions[index] = next;
    store.set('workflowDefinitions', definitions);
    return next;
  }

  async createRun(workflowId: string, input: WorkflowRunInput): Promise<WorkflowRun> {
    const definition = this.definitions().find((item) => item.id === workflowId && !item.archived);
    if (!definition) throw new Error('工作流不存在或已归档');
    let run = createWorkflowRun(definition, input);
    const preferences = preferencesFromStored(store.get('settings'), app.getPath('home'));
    run.contexts = await createWorkflowContexts({
      repositories: run.definition.repositories, runInput: run.input,
      workflowName: run.definition.name, runId: run.id,
      rootDirectory: preferences.worktreesDirectory,
    });
    const runs = this.runs();
    runs.unshift(run);
    this.writeRuns(runs);
    return run;
  }

  complete(runId: string, taskId: string, input: CompleteWorkflowTaskInput): WorkflowRun {
    return this.updateRun(runId, (run) => completeWorkflowTask(run, taskId, input));
  }

  skip(runId: string, taskId: string, reason: string): WorkflowRun {
    return this.updateRun(runId, (run) => skipWorkflowTask(run, taskId, reason));
  }

  async execute(runId: string, taskId: string, sender: WebContents): Promise<WorkflowRun> {
    const key = `${runId}:${taskId}`;
    if (this.active.has(key)) throw new Error('任务已经在运行');
    let run = this.requireRun(runId);
    const taskRun = run.tasks[taskId];
    if (!taskRun || !['ready', 'failed', 'interrupted'].includes(taskRun.status)) {
      throw new Error('任务当前不可执行');
    }
    const definition = findTask(run.definition, taskId);
    if (definition.kind !== 'command' && definition.kind !== 'ai') throw new Error('该任务需要人工完成');
    const attempt: WorkflowTaskAttempt = {
      id: randomUUID(), startedAt: Date.now(), finishedAt: null,
      status: 'running', exitCode: null, logFile: null,
    };
    run = this.updateRun(runId, (next) => {
      next.tasks[taskId].status = 'running';
      next.tasks[taskId].attempts.push(attempt);
      return next;
    });
    sender.send('workflow:updated');
    try {
      const cwd = definition.repositoryAlias
        ? run.contexts.find((item) => item.repositoryAlias === definition.repositoryAlias)?.directory
        : undefined;
      if (definition.repositoryAlias && !cwd) throw new Error('任务执行上下文不存在');
      const prompt = interpolate(definition.prompt ?? '', run);
      let executable: string;
      let args: string[];
      let promptMode: 'argument' | 'stdin' | 'none' = 'none';
      let env = process.env;
      let secrets: string[] = [];
      let timeoutMs = 30 * 60_000;
      if (definition.kind === 'command') {
        executable = interpolate(definition.executable!, run);
        args = definition.args!.map((arg) => interpolate(arg, run));
      } else {
        const raw = loadLocalAiPrograms().find((item) =>
          typeof item === 'object' && item !== null && (item as { id?: unknown }).id === definition.aiProgramId
        );
        const program = normalizeLocalAiProgram(raw);
        if (!program.enabled) throw new Error('AI 程序已禁用');
        const environment = buildLocalAiEnvironment(program);
        env = environment.env; secrets = environment.secrets; timeoutMs = program.timeoutMs;
        const resolved = await resolveLocalAiExecutable(program.executable, env, cwd);
        if (!resolved.path) throw new Error('AI 程序不可执行');
        executable = resolved.path;
        args = buildLocalAiArguments(program, prompt);
        promptMode = program.promptMode;
      }
      const resolvedCommand = definition.kind === 'command'
        ? await resolveLocalAiExecutable(executable, env, cwd) : { path: executable };
      if (!resolvedCommand.path) throw new Error(`找不到可执行程序：${executable}`);
      const handle = startLocalAiProcess({
        executable: resolvedCommand.path, args, promptMode, prompt, workingDirectory: cwd,
        env, secrets, timeoutMs,
      }, (event) => {
        sender.send('workflow:task-output', { runId, taskId, attemptId: attempt.id, ...event });
      });
      this.active.set(key, handle);
      const result = await handle.completion;
      const logFile = await this.writeLog(runId, taskId, attempt.id, result.stdout, result.stderr);
      return this.updateRun(runId, (next) => {
        const current = next.tasks[taskId];
        const saved = current.attempts.find((item) => item.id === attempt.id)!;
        saved.finishedAt = Date.now(); saved.exitCode = result.exitCode; saved.logFile = logFile;
        saved.status = result.status === 'success'
          ? 'succeeded'
          : result.status === 'cancelled' ? 'interrupted' : 'failed';
        saved.error = result.error;
        current.status = result.status === 'success'
          ? 'succeeded'
          : result.status === 'cancelled' ? 'interrupted' : 'failed';
        return settleWorkflowRun(next);
      });
    } catch (error) {
      return this.updateRun(runId, (next) => {
        const saved = next.tasks[taskId].attempts.find((item) => item.id === attempt.id)!;
        saved.finishedAt = Date.now(); saved.status = 'failed';
        saved.error = error instanceof Error ? error.message : String(error);
        next.tasks[taskId].status = 'failed';
        return next;
      });
    } finally {
      this.active.delete(key);
    }
  }

  cancel(runId: string, taskId: string): boolean {
    const handle = this.active.get(`${runId}:${taskId}`);
    if (!handle) return false;
    handle.cancel();
    return true;
  }

  async cleanup(runId: string): Promise<WorkflowRun> {
    const run = this.requireRun(runId);
    if (run.status === 'active') throw new Error('进行中的执行不能清理上下文');
    await removeCleanWorkflowContexts(run.contexts);
    return this.updateRun(runId, (next) => { next.contexts = []; return next; });
  }

  private definitions(): WorkflowDefinition[] { return store.get('workflowDefinitions') ?? []; }
  private runs(): WorkflowRun[] { return store.get('workflowRuns') ?? []; }
  private writeRuns(runs: WorkflowRun[]): void { store.set('workflowRuns', runs); }
  private requireRun(id: string): WorkflowRun {
    const run = this.runs().find((item) => item.id === id);
    if (!run) throw new Error('执行不存在');
    return run;
  }
  private updateRun(id: string, update: (run: WorkflowRun) => WorkflowRun): WorkflowRun {
    const runs = this.runs();
    const index = runs.findIndex((item) => item.id === id);
    if (index < 0) throw new Error('执行不存在');
    const next = update(structuredClone(runs[index]));
    next.updatedAt = Date.now(); runs[index] = next; this.writeRuns(runs); return next;
  }
  private async writeLog(runId: string, taskId: string, attemptId: string, stdout: string, stderr: string): Promise<string> {
    const directory = path.join(app.getPath('userData'), 'workflow-runs', runId, taskId);
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, `${attemptId}.log`);
    await fs.writeFile(file, `STDOUT\n${stdout}\n\nSTDERR\n${stderr}\n`, 'utf8');
    return file;
  }
  private recoverInterruptedRuns(): void {
    const runs = this.runs(); let changed = false;
    for (const run of runs) for (const task of Object.values(run.tasks)) {
      if (task.status !== 'running') continue;
      task.status = 'interrupted'; changed = true;
      const attempt = task.attempts.at(-1);
      if (attempt?.status === 'running') { attempt.status = 'interrupted'; attempt.finishedAt = Date.now(); }
    }
    if (changed) this.writeRuns(runs);
  }
}

function interpolate(value: string, run: WorkflowRun): string {
  const variables: Record<string, string> = {
    'run.title': run.input.title, 'run.version': run.input.version ?? '', 'run.workItem': run.input.workItem ?? '',
  };
  for (const context of run.contexts) {
    variables[`repo.${context.repositoryAlias}.path`] = context.directory;
    variables[`repo.${context.repositoryAlias}.branch`] = context.branch;
  }
  return value.replace(/\{\{([^}]+)\}\}/g, (_match, key: string) => {
    if (!(key in variables)) throw new Error(`未知或缺失的模板变量：${key}`);
    return variables[key];
  });
}
