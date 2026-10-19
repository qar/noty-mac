import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { StringDecoder } from 'string_decoder';
import {
  LOCAL_AI_MAX_OUTPUT_CHARS,
  redactLocalAiOutput,
  redactLocalAiStreamingOutput,
} from './local-ai-core';
import type { LocalAiPromptMode, LocalAiRunStatus } from './local-ai-types';

const FORCE_KILL_DELAY_MS = 1_500;

export interface LocalAiProcessRequest {
  executable: string;
  args: string[];
  promptMode: LocalAiPromptMode;
  prompt: string;
  workingDirectory?: string;
  env: NodeJS.ProcessEnv;
  secrets: string[];
  timeoutMs: number;
  outputLimit?: number;
}

export interface LocalAiProcessOutput {
  stream: 'stdout' | 'stderr';
  output: string;
  truncated: boolean;
}

export interface LocalAiProcessResult {
  status: LocalAiRunStatus;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  error?: string;
}

export interface LocalAiProcessHandle {
  completion: Promise<LocalAiProcessResult>;
  cancel(
    status?: Extract<LocalAiRunStatus, 'cancelled' | 'timed_out'>,
    force?: boolean
  ): void;
}

export function startLocalAiProcess(
  request: LocalAiProcessRequest,
  onOutput?: (output: LocalAiProcessOutput) => void
): LocalAiProcessHandle {
  const startedAt = Date.now();
  const stdout = new BoundedOutput(request.outputLimit);
  const stderr = new BoundedOutput(request.outputLimit);
  let requestedStatus: Extract<LocalAiRunStatus, 'cancelled' | 'timed_out'> | null = null;
  let finished = false;
  let forceKillTimeout: NodeJS.Timeout | null = null;
  let resolveCompletion: (result: LocalAiProcessResult) => void = () => {};
  const completion = new Promise<LocalAiProcessResult>((resolve) => {
    resolveCompletion = resolve;
  });

  const child = spawn(request.executable, request.args, {
    cwd: request.workingDirectory,
    env: request.env,
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let timeout: NodeJS.Timeout;
  const finish = (
    status: LocalAiRunStatus,
    exitCode: number | null,
    signal: string | null,
    error?: string
  ): void => {
    if (finished) return;
    finished = true;
    stdout.end();
    stderr.end();
    clearTimeout(timeout);
    if (forceKillTimeout) clearTimeout(forceKillTimeout);
    resolveCompletion({
      status,
      exitCode,
      signal,
      durationMs: Date.now() - startedAt,
      stdout: finalOutput(stdout, request.secrets),
      stderr: finalOutput(stderr, request.secrets),
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
      error: error ? redactLocalAiOutput(error, request.secrets) : undefined,
    });
  };

  const cancel = (
    status: Extract<LocalAiRunStatus, 'cancelled' | 'timed_out'> = 'cancelled',
    force = false
  ): void => {
    if (finished) return;
    const firstRequest = requestedStatus === null;
    if (firstRequest) requestedStatus = status;
    if (force) {
      terminateLocalAiChild(child, true);
      return;
    }
    if (!firstRequest) return;
    terminateLocalAiChild(child, false);
    forceKillTimeout = setTimeout(() => {
      if (!finished) terminateLocalAiChild(child, true);
    }, FORCE_KILL_DELAY_MS);
  };

  timeout = setTimeout(() => cancel('timed_out'), request.timeoutMs);
  const emitOutput = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
    if (finished) return;
    const collector = stream === 'stdout' ? stdout : stderr;
    collector.append(chunk);
    onOutput?.({
      stream,
      output: streamingOutput(collector, request.secrets),
      truncated: collector.truncated,
    });
  };

  child.stdout.on('data', (chunk: Buffer) => emitOutput('stdout', chunk));
  child.stderr.on('data', (chunk: Buffer) => emitOutput('stderr', chunk));
  child.once('error', (error) => {
    finish('spawn_error', null, null, error.message);
  });
  child.once('close', (code, signal) => {
    finish(requestedStatus ?? (code === 0 ? 'success' : 'failed'), code, signal);
  });
  child.stdin.on('error', () => { /* handled by child error/close */ });
  if (request.promptMode === 'stdin') child.stdin.end(request.prompt);
  else child.stdin.end();

  return { completion, cancel };
}

export function terminateLocalAiChild(
  child: ChildProcessWithoutNullStreams,
  force: boolean
): void {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const signal: NodeJS.Signals = force ? 'SIGKILL' : 'SIGTERM';
  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to signaling the direct child below.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // The child exited between the status check and the signal.
  }
}

class BoundedOutput {
  private readonly decoder = new StringDecoder('utf8');
  private readonly maximum: number;
  private text = '';
  truncated = false;

  constructor(maximum = LOCAL_AI_MAX_OUTPUT_CHARS) {
    this.maximum = maximum;
  }

  append(chunk: Buffer): void {
    this.addText(this.decoder.write(chunk));
  }

  end(): void {
    this.addText(this.decoder.end());
  }

  value(): string {
    return this.text;
  }

  private addText(next: string): void {
    const remaining = this.maximum - this.text.length;
    if (remaining <= 0) {
      if (next) this.truncated = true;
      return;
    }
    this.text += next.slice(0, remaining);
    if (next.length > remaining) this.truncated = true;
  }
}

function streamingOutput(output: BoundedOutput, secrets: readonly string[]): string {
  const redacted = redactLocalAiStreamingOutput(output.value(), secrets);
  return output.truncated ? `${redacted}\n[输出已截断]` : redacted;
}

function finalOutput(output: BoundedOutput, secrets: readonly string[]): string {
  const redacted = output.truncated
    ? redactLocalAiStreamingOutput(output.value(), secrets)
    : redactLocalAiOutput(output.value(), secrets);
  return output.truncated ? `${redacted}\n[输出已截断]` : redacted;
}
