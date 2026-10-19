export type LocalAiPromptMode = 'argument' | 'stdin' | 'none';

export type LocalAiProxyMode = 'inherit' | 'none' | 'custom';

export type LocalAiTemplateId =
  | 'blank'
  | 'claude'
  | 'codex'
  | 'gemini'
  | 'ollama';

export interface LocalAiEnvironmentVariable {
  key: string;
  value: string;
  secret: boolean;
}

export interface LocalAiProxySettings {
  mode: LocalAiProxyMode;
  httpProxy: string;
  httpsProxy: string;
  allProxy: string;
  noProxy: string;
}

export interface LocalAiProgram {
  id: string;
  name: string;
  executable: string;
  args: string[];
  promptMode: LocalAiPromptMode;
  workingDirectory: string;
  environment: LocalAiEnvironmentVariable[];
  proxy: LocalAiProxySettings;
  timeoutMs: number;
  enabled: boolean;
  versionArgs: string[];
}

export type LocalAiDetectionReason =
  | 'not_found'
  | 'not_executable'
  | 'working_directory_unavailable'
  | 'version_failed'
  | 'timed_out'
  | 'spawn_failed';

export interface LocalAiDetectionResult {
  available: boolean;
  resolvedPath: string | null;
  version: string | null;
  reason?: LocalAiDetectionReason;
  detail?: string;
}

export type LocalAiRunStatus =
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'spawn_error';

export interface LocalAiStartResult {
  started: boolean;
  runId: string;
  error?: string;
}

export interface LocalAiOutputEvent {
  runId: string;
  stream: 'stdout' | 'stderr';
  output: string;
  truncated: boolean;
}

export interface LocalAiFinishedEvent {
  runId: string;
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

export interface LocalAiCreateResult {
  programs: LocalAiProgram[];
  createdId: string;
}
