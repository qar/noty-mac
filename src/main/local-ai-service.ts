import { randomUUID } from 'crypto';
import { BrowserWindow, type WebContents } from 'electron';
import {
  LOCAL_AI_DEFAULT_TIMEOUT_MS,
  assertProgramCapacity,
  buildLocalAiArguments,
  buildLocalAiEnvironment,
  isUsableLocalAiWorkingDirectory,
  normalizeLocalAiProgram,
  redactLocalAiOutput,
  resolveLocalAiExecutable,
  resolveLocalAiWorkingDirectory,
} from './local-ai-core';
import {
  startLocalAiProcess,
  type LocalAiProcessHandle,
  type LocalAiProcessResult,
} from './local-ai-process';
import {
  loadLocalAiPrograms,
  saveLocalAiPrograms,
} from './local-ai-storage';
import type {
  LocalAiCreateResult,
  LocalAiDetectionResult,
  LocalAiFinishedEvent,
  LocalAiOutputEvent,
  LocalAiProgram,
  LocalAiRunStatus,
  LocalAiStartResult,
  LocalAiTemplateId,
} from './local-ai-types';

const OUTPUT_CHANNEL = 'local-ai:output';
const FINISHED_CHANNEL = 'local-ai:finished';
const VERSION_TIMEOUT_MS = 10_000;
const MAX_PROMPT_CHARS = 1024 * 1024;
const MAX_CONCURRENT_RUNS = 8;

interface ActiveRun {
  runId: string;
  programId: string;
  ownerId: number;
  sender: WebContents;
  process: LocalAiProcessHandle;
  destroyedListener: () => void;
}

export class LocalAiService {
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly pendingRunIds = new Set<string>();

  list(): LocalAiProgram[] {
    return this.loadValidPrograms();
  }

  create(templateId: unknown): LocalAiCreateResult {
    if (!isTemplateId(templateId)) {
      throw new Error('无效的程序模板');
    }
    const programs = this.loadValidPrograms();
    assertProgramCapacity(programs);
    const created = createTemplate(templateId, randomUUID());
    programs.push(created);
    saveLocalAiPrograms(programs);
    return { programs, createdId: created.id };
  }

  duplicate(id: unknown): LocalAiCreateResult {
    const programs = this.loadValidPrograms();
    assertProgramCapacity(programs);
    const source = findProgram(programs, id);
    const created = normalizeLocalAiProgram(
      {
        ...source,
        id: randomUUID(),
        name: `${source.name} 副本`,
        environment: source.environment.map((entry) => ({ ...entry })),
        proxy: { ...source.proxy },
      }
    );
    programs.push(created);
    saveLocalAiPrograms(programs);
    return { programs, createdId: created.id };
  }

  save(value: unknown): LocalAiProgram[] {
    if (!isRecord(value) || typeof value.id !== 'string') {
      throw new Error('程序配置格式无效');
    }
    const programs = this.loadValidPrograms();
    const index = programs.findIndex((program) => program.id === value.id);
    if (index < 0) throw new Error('未找到要保存的程序');
    programs[index] = normalizeLocalAiProgram(value, programs[index].id);
    saveLocalAiPrograms(programs);
    return programs;
  }

  remove(id: unknown): LocalAiProgram[] {
    const programs = this.loadValidPrograms();
    const source = findProgram(programs, id);
    this.stopRunsForProgram(source.id);
    const next = programs.filter((program) => program.id !== source.id);
    saveLocalAiPrograms(next);
    return next;
  }

  async detect(id: unknown): Promise<LocalAiDetectionResult> {
    const program = findProgram(this.loadValidPrograms(), id);
    const { env, secrets } = buildLocalAiEnvironment(program);
    const workingDirectory = resolveLocalAiWorkingDirectory(program);
    if (!(await isUsableLocalAiWorkingDirectory(workingDirectory))) {
      return {
        available: false,
        resolvedPath: null,
        version: null,
        reason: 'working_directory_unavailable',
      };
    }

    const resolved = await resolveLocalAiExecutable(
      program.executable,
      env,
      workingDirectory
    );
    if (!resolved.path) {
      return {
        available: false,
        resolvedPath: null,
        version: null,
        reason: resolved.reason ?? 'not_found',
      };
    }
    if (program.versionArgs.length === 0) {
      return { available: true, resolvedPath: resolved.path, version: null };
    }

    return this.runVersionCheck(
      resolved.path,
      program.versionArgs,
      env,
      workingDirectory,
      secrets
    );
  }

  async start(
    id: unknown,
    prompt: unknown,
    runId: unknown,
    sender: WebContents
  ): Promise<LocalAiStartResult> {
    if (
      typeof runId !== 'string' ||
      !/^[A-Za-z0-9-]{8,128}$/.test(runId) ||
      this.activeRuns.has(runId) ||
      this.pendingRunIds.has(runId)
    ) {
      return { started: false, runId: typeof runId === 'string' ? runId : '', error: '运行 ID 无效' };
    }
    if (typeof prompt !== 'string' || prompt.length > MAX_PROMPT_CHARS || prompt.includes('\0')) {
      return { started: false, runId, error: '测试 Prompt 无效或过长' };
    }
    if (this.activeRuns.size + this.pendingRunIds.size >= MAX_CONCURRENT_RUNS) {
      return { started: false, runId, error: '同时运行的本地 AI 测试过多' };
    }

    this.pendingRunIds.add(runId);
    try {
      return await this.startPending(id, prompt, runId, sender);
    } finally {
      this.pendingRunIds.delete(runId);
    }
  }

  private async startPending(
    id: unknown,
    prompt: string,
    runId: string,
    sender: WebContents
  ): Promise<LocalAiStartResult> {
    let program: LocalAiProgram;
    try {
      program = findProgram(this.loadValidPrograms(), id);
    } catch (error) {
      return { started: false, runId, error: errorMessage(error) };
    }
    if (!program.enabled) {
      return { started: false, runId, error: '请先启用并保存该程序' };
    }

    const { env, secrets } = buildLocalAiEnvironment(program);
    const workingDirectory = resolveLocalAiWorkingDirectory(program);
    if (!(await isUsableLocalAiWorkingDirectory(workingDirectory))) {
      return { started: false, runId, error: '工作目录不存在或不是目录' };
    }
    const resolved = await resolveLocalAiExecutable(
      program.executable,
      env,
      workingDirectory
    );
    if (!resolved.path) {
      return {
        started: false,
        runId,
        error: resolved.reason === 'not_executable' ? '命令不可执行' : '未找到可执行命令',
      };
    }
    const ownerWindow = BrowserWindow.fromWebContents(sender);
    if (ownerWindow && !ownerWindow.isVisible()) {
      return { started: false, runId, error: '设置窗口已关闭，运行已取消' };
    }

    let processHandle: LocalAiProcessHandle;
    try {
      processHandle = startLocalAiProcess(
        {
          executable: resolved.path,
          args: buildLocalAiArguments(program, prompt),
          promptMode: program.promptMode,
          prompt,
          workingDirectory,
          env,
          secrets,
          timeoutMs: program.timeoutMs,
        },
        (output) => {
          const event: LocalAiOutputEvent = { runId, ...output };
          safeSend(sender, OUTPUT_CHANNEL, event);
        }
      );
    } catch (error) {
      return { started: false, runId, error: redactLocalAiOutput(errorMessage(error), secrets) };
    }

    const destroyedListener = (): void => this.stopRunsForOwner(sender.id);
    const run: ActiveRun = {
      runId,
      programId: program.id,
      ownerId: sender.id,
      sender,
      process: processHandle,
      destroyedListener,
    };
    this.activeRuns.set(runId, run);
    sender.once('destroyed', destroyedListener);

    void processHandle.completion.then((result) => this.finishRun(run, result));

    return { started: true, runId };
  }

  cancel(runId: unknown, ownerId: number): boolean {
    if (typeof runId !== 'string') return false;
    const run = this.activeRuns.get(runId);
    if (!run || run.ownerId !== ownerId) return false;
    this.requestStop(runId, 'cancelled');
    return true;
  }

  stopRunsForOwner(ownerId: number): void {
    for (const run of this.activeRuns.values()) {
      if (run.ownerId === ownerId) this.requestStop(run.runId, 'cancelled');
    }
  }

  stopAll(): void {
    for (const run of this.activeRuns.values()) {
      run.process.cancel('cancelled', true);
    }
  }

  private loadValidPrograms(): LocalAiProgram[] {
    const valid: LocalAiProgram[] = [];
    for (const value of loadLocalAiPrograms()) {
      try {
        valid.push(normalizeLocalAiProgram(value));
      } catch (error) {
        console.warn('[local-ai] ignored invalid saved configuration:', errorMessage(error));
      }
    }
    return valid;
  }

  private stopRunsForProgram(programId: string): void {
    for (const run of this.activeRuns.values()) {
      if (run.programId === programId) this.requestStop(run.runId, 'cancelled');
    }
  }

  private requestStop(
    runId: string,
    status: Extract<LocalAiRunStatus, 'cancelled' | 'timed_out'>
  ): void {
    const run = this.activeRuns.get(runId);
    if (!run) return;
    run.process.cancel(status);
  }

  private finishRun(run: ActiveRun, result: LocalAiProcessResult): void {
    if (!this.activeRuns.has(run.runId)) return;
    run.sender.removeListener('destroyed', run.destroyedListener);
    this.activeRuns.delete(run.runId);

    const event: LocalAiFinishedEvent = {
      runId: run.runId,
      ...result,
    };
    safeSend(run.sender, FINISHED_CHANNEL, event);
  }

  private runVersionCheck(
    executable: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    workingDirectory: string | undefined,
    secrets: string[]
  ): Promise<LocalAiDetectionResult> {
    let handle: LocalAiProcessHandle;
    try {
      handle = startLocalAiProcess({
        executable,
        args,
        promptMode: 'none',
        prompt: '',
        workingDirectory,
        env,
        secrets,
        timeoutMs: VERSION_TIMEOUT_MS,
        outputLimit: 16 * 1024,
      });
    } catch (error) {
      return Promise.resolve({
        available: false,
        resolvedPath: executable,
        version: null,
        reason: 'spawn_failed',
        detail: redactLocalAiOutput(errorMessage(error), secrets),
      });
    }

    return handle.completion.then((result) => {
      const text = (result.stdout.trim() || result.stderr.trim()).replace(
        /\n\[输出已截断\]$/,
        ''
      );
      if (result.status === 'timed_out') {
        return {
          available: false,
          resolvedPath: executable,
          version: null,
          reason: 'timed_out',
        };
      }
      if (result.status === 'success') {
        return {
          available: true,
          resolvedPath: executable,
          version: text.split(/\r?\n/, 1)[0]?.slice(0, 500) || null,
        };
      }
      return {
        available: false,
        resolvedPath: executable,
        version: null,
        reason: result.status === 'spawn_error' ? 'spawn_failed' : 'version_failed',
        detail: result.error || text.slice(0, 500) || `退出码 ${result.exitCode ?? '未知'}`,
      };
    });
  }
}

function createTemplate(templateId: LocalAiTemplateId, id: string): LocalAiProgram {
  const common = {
    id,
    workingDirectory: '',
    environment: [],
    proxy: {
      mode: 'inherit' as const,
      httpProxy: '',
      httpsProxy: '',
      allProxy: '',
      noProxy: '',
    },
    timeoutMs: LOCAL_AI_DEFAULT_TIMEOUT_MS,
    enabled: true,
    versionArgs: ['--version'],
  };
  const templates: Record<LocalAiTemplateId, LocalAiProgram> = {
    blank: {
      ...common,
      name: '本地 AI',
      executable: 'ai',
      args: ['{{prompt}}'],
      promptMode: 'argument',
    },
    claude: {
      ...common,
      name: 'Claude Code',
      executable: 'claude',
      args: ['-p', '{{prompt}}'],
      promptMode: 'argument',
    },
    codex: {
      ...common,
      name: 'Codex CLI',
      executable: 'codex',
      args: ['exec', '{{prompt}}'],
      promptMode: 'argument',
    },
    gemini: {
      ...common,
      name: 'Gemini CLI',
      executable: 'gemini',
      args: ['-p', '{{prompt}}'],
      promptMode: 'argument',
    },
    ollama: {
      ...common,
      name: 'Ollama',
      executable: 'ollama',
      args: ['run', 'llama3.2', '{{prompt}}'],
      promptMode: 'argument',
    },
  };
  return normalizeLocalAiProgram(templates[templateId]);
}

function findProgram(programs: LocalAiProgram[], id: unknown): LocalAiProgram {
  if (typeof id !== 'string' || !id) throw new Error('程序 ID 无效');
  const program = programs.find((item) => item.id === id);
  if (!program) throw new Error('未找到本地 AI 程序');
  return program;
}

function isTemplateId(value: unknown): value is LocalAiTemplateId {
  return value === 'blank' || value === 'claude' || value === 'codex' || value === 'gemini' || value === 'ollama';
}

function safeSend(sender: WebContents, channel: string, value: unknown): void {
  if (!sender.isDestroyed()) sender.send(channel, value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
