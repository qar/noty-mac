import { constants as fsConstants, promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  LocalAiEnvironmentVariable,
  LocalAiProgram,
  LocalAiProxySettings,
} from './local-ai-types';

export const LOCAL_AI_PROMPT_PLACEHOLDER = '{{prompt}}';
export const LOCAL_AI_DEFAULT_TIMEOUT_MS = 60_000;
export const LOCAL_AI_MAX_TIMEOUT_MS = 30 * 60_000;
export const LOCAL_AI_MAX_OUTPUT_CHARS = 256 * 1024;

const MAX_PROGRAMS = 32;
const MAX_ARGUMENTS = 64;
const MAX_ENVIRONMENT_VARIABLES = 64;
const MAX_TEXT_LENGTH = 4096;
const PROXY_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY'] as const;
const PROMPT_MODES = new Set(['argument', 'stdin', 'none']);
const PROXY_MODES = new Set(['inherit', 'none', 'custom']);

const FALLBACK_EXECUTABLE_PATHS = [
  path.join(os.homedir(), '.local', 'bin'),
  path.join(os.homedir(), 'bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
];

export class LocalAiValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalAiValidationError';
  }
}

export interface LocalAiEnvironmentResult {
  env: NodeJS.ProcessEnv;
  secrets: string[];
}

export interface LocalAiExecutableResult {
  path: string | null;
  reason?: 'not_found' | 'not_executable';
}

export function assertProgramCapacity(programs: readonly unknown[]): void {
  if (programs.length >= MAX_PROGRAMS) {
    throw new LocalAiValidationError(`最多只能配置 ${MAX_PROGRAMS} 个本地 AI 程序`);
  }
}

export function normalizeLocalAiProgram(
  value: unknown,
  expectedId?: string
): LocalAiProgram {
  if (!isRecord(value)) {
    throw new LocalAiValidationError('程序配置格式无效');
  }

  const id = expectedId ?? requiredText(value.id, '程序 ID', 128);
  const name = requiredText(value.name, '显示名称', 80);
  const executable = requiredText(value.executable, '可执行命令', MAX_TEXT_LENGTH);
  const args = stringArray(value.args, '运行参数');
  const versionArgs = stringArray(value.versionArgs, '检测参数');
  const promptMode = value.promptMode;
  if (typeof promptMode !== 'string' || !PROMPT_MODES.has(promptMode)) {
    throw new LocalAiValidationError('Prompt 传递方式无效');
  }

  const workingDirectory = optionalText(
    value.workingDirectory,
    '工作目录',
    MAX_TEXT_LENGTH
  );
  const timeoutMs = numberInRange(
    value.timeoutMs,
    '超时时间',
    1_000,
    LOCAL_AI_MAX_TIMEOUT_MS
  );
  if (typeof value.enabled !== 'boolean') {
    throw new LocalAiValidationError('启用状态无效');
  }

  return {
    id,
    name,
    executable,
    args,
    promptMode: promptMode as LocalAiProgram['promptMode'],
    workingDirectory,
    environment: normalizeEnvironment(value.environment),
    proxy: normalizeProxy(value.proxy),
    timeoutMs,
    enabled: value.enabled,
    versionArgs,
  };
}

export function buildLocalAiArguments(
  program: LocalAiProgram,
  prompt: string
): string[] {
  if (program.promptMode !== 'argument') return [...program.args];

  const args = program.args.map((argument) =>
    argument.split(LOCAL_AI_PROMPT_PLACEHOLDER).join(prompt)
  );

  if (!program.args.some((argument) => argument.includes(LOCAL_AI_PROMPT_PLACEHOLDER))) {
    args.push(prompt);
  }

  return args;
}

export function buildLocalAiEnvironment(
  program: LocalAiProgram,
  baseEnvironment: NodeJS.ProcessEnv = process.env
): LocalAiEnvironmentResult {
  const env: NodeJS.ProcessEnv = { ...baseEnvironment };
  env.PATH = augmentExecutablePath(baseEnvironment.PATH);

  for (const entry of program.environment) {
    env[entry.key] = entry.value;
  }

  if (program.proxy.mode !== 'inherit') {
    for (const key of PROXY_KEYS) {
      delete env[key];
      delete env[key.toLowerCase()];
    }
  }

  if (program.proxy.mode === 'custom') {
    assignProxy(env, 'HTTP_PROXY', program.proxy.httpProxy);
    assignProxy(env, 'HTTPS_PROXY', program.proxy.httpsProxy);
    assignProxy(env, 'ALL_PROXY', program.proxy.allProxy);
    assignProxy(env, 'NO_PROXY', program.proxy.noProxy);
  }

  const secrets = program.environment
    .filter((entry) => entry.secret && entry.value)
    .map((entry) => entry.value);

  if (program.proxy.mode === 'custom') {
    for (const proxy of [
      program.proxy.httpProxy,
      program.proxy.httpsProxy,
      program.proxy.allProxy,
    ]) {
      addProxySecrets(secrets, proxy);
    }
  }

  return { env, secrets: [...new Set(secrets)].sort((a, b) => b.length - a.length) };
}

export function redactLocalAiOutput(text: string, secrets: readonly string[]): string {
  let redacted = text;
  for (const secret of secrets) {
    if (!secret) continue;
    redacted = redacted.split(secret).join('[REDACTED]');
  }
  return redacted;
}

export function redactLocalAiStreamingOutput(
  text: string,
  secrets: readonly string[]
): string {
  let heldSuffixLength = 0;
  for (const secret of secrets) {
    const maximumPrefix = Math.min(secret.length - 1, text.length);
    for (let length = maximumPrefix; length > heldSuffixLength; length -= 1) {
      if (text.endsWith(secret.slice(0, length))) {
        heldSuffixLength = length;
        break;
      }
    }
  }
  const safeText = heldSuffixLength > 0 ? text.slice(0, -heldSuffixLength) : text;
  return redactLocalAiOutput(safeText, secrets);
}

export function expandLocalAiPath(value: string): string {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

export function resolveLocalAiWorkingDirectory(program: LocalAiProgram): string | undefined {
  if (!program.workingDirectory) return undefined;
  return path.resolve(expandLocalAiPath(program.workingDirectory));
}

export async function isUsableLocalAiWorkingDirectory(
  directory: string | undefined
): Promise<boolean> {
  if (!directory) return true;
  try {
    const stat = await fs.stat(directory);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function resolveLocalAiExecutable(
  executable: string,
  env: NodeJS.ProcessEnv,
  workingDirectory?: string
): Promise<LocalAiExecutableResult> {
  const expanded = expandLocalAiPath(executable);
  if (expanded.includes(path.sep)) {
    const candidate = path.isAbsolute(expanded)
      ? expanded
      : path.resolve(workingDirectory ?? process.cwd(), expanded);
    return inspectExecutable(candidate);
  }

  const searchPath = env.PATH ?? augmentExecutablePath(undefined);
  let foundNonExecutable = false;
  for (const directory of searchPath.split(path.delimiter).filter(Boolean)) {
    const result = await inspectExecutable(path.join(directory, expanded));
    if (result.path) return result;
    if (result.reason === 'not_executable') foundNonExecutable = true;
  }
  return {
    path: null,
    reason: foundNonExecutable ? 'not_executable' : 'not_found',
  };
}

export function augmentExecutablePath(currentPath: string | undefined): string {
  const entries = [
    ...(currentPath ?? '').split(path.delimiter),
    ...FALLBACK_EXECUTABLE_PATHS,
  ].filter(Boolean);
  return [...new Set(entries)].join(path.delimiter);
}

function normalizeEnvironment(value: unknown): LocalAiEnvironmentVariable[] {
  if (!Array.isArray(value) || value.length > MAX_ENVIRONMENT_VARIABLES) {
    throw new LocalAiValidationError(
      `环境变量必须是数组，且不能超过 ${MAX_ENVIRONMENT_VARIABLES} 项`
    );
  }

  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new LocalAiValidationError(`第 ${index + 1} 个环境变量格式无效`);
    }
    const key = requiredText(entry.key, `第 ${index + 1} 个环境变量名称`, 128);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new LocalAiValidationError(`环境变量名称“${key}”无效`);
    }
    if (seen.has(key)) {
      throw new LocalAiValidationError(`环境变量“${key}”重复`);
    }
    seen.add(key);
    return {
      key,
      value: optionalText(entry.value, `环境变量 ${key}`, MAX_TEXT_LENGTH),
      secret: entry.secret === true,
    };
  });
}

function normalizeProxy(value: unknown): LocalAiProxySettings {
  if (!isRecord(value)) {
    throw new LocalAiValidationError('代理配置格式无效');
  }
  const mode = value.mode;
  if (typeof mode !== 'string' || !PROXY_MODES.has(mode)) {
    throw new LocalAiValidationError('代理模式无效');
  }
  return {
    mode: mode as LocalAiProxySettings['mode'],
    httpProxy: optionalText(value.httpProxy, 'HTTP 代理', MAX_TEXT_LENGTH),
    httpsProxy: optionalText(value.httpsProxy, 'HTTPS 代理', MAX_TEXT_LENGTH),
    allProxy: optionalText(value.allProxy, '通用代理', MAX_TEXT_LENGTH),
    noProxy: optionalText(value.noProxy, '代理排除列表', MAX_TEXT_LENGTH),
  };
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_ARGUMENTS) {
    throw new LocalAiValidationError(`${label}必须是数组，且不能超过 ${MAX_ARGUMENTS} 项`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.length > MAX_TEXT_LENGTH || entry.includes('\0')) {
      throw new LocalAiValidationError(`${label}第 ${index + 1} 项无效`);
    }
    return entry;
  });
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  const text = optionalText(value, label, maxLength).trim();
  if (!text) throw new LocalAiValidationError(`${label}不能为空`);
  return text;
}

function optionalText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength || value.includes('\0')) {
    throw new LocalAiValidationError(`${label}无效`);
  }
  return value;
}

function numberInRange(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new LocalAiValidationError(`${label}必须在 ${minimum} 到 ${maximum} 毫秒之间`);
  }
  return value;
}

function assignProxy(env: NodeJS.ProcessEnv, key: string, value: string): void {
  if (!value) return;
  env[key] = value;
  env[key.toLowerCase()] = value;
}

function addProxySecrets(secrets: string[], proxy: string): void {
  if (!proxy) return;
  secrets.push(proxy);
  try {
    const parsed = new URL(proxy);
    if (parsed.password) secrets.push(decodeURIComponent(parsed.password));
  } catch {
    const authority = proxy.match(/^[a-z][a-z0-9+.-]*:\/\/([^/@]+)@/i)?.[1];
    if (!authority) return;
    secrets.push(authority);
    const separator = authority.indexOf(':');
    if (separator >= 0) {
      secrets.push(authority.slice(separator + 1));
    }
  }
}

async function inspectExecutable(candidate: string): Promise<LocalAiExecutableResult> {
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile()) return { path: null, reason: 'not_executable' };
    await fs.access(candidate, fsConstants.X_OK);
    return { path: await fs.realpath(candidate) };
  } catch (error) {
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
    return {
      path: null,
      reason: code === 'EACCES' ? 'not_executable' : 'not_found',
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
