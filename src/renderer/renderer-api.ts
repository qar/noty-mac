import type {
  Project,
  RemoveOptions,
  Workspace,
  WorkspaceWithStatus,
} from '../main/types';
import type {
  LocalAiCreateResult,
  LocalAiDetectionResult,
  LocalAiFinishedEvent,
  LocalAiOutputEvent,
  LocalAiProgram,
  LocalAiStartResult,
  LocalAiTemplateId,
} from '../main/local-ai-types';
import type { AppPreferences } from '../main/settings-types';
import type { CompleteWorkflowTaskInput, WorkflowDefinition, WorkflowRun, WorkflowRunInput, WorkflowSnapshot } from '../main/workflow-types';

export type { AppPreferences } from '../main/settings-types';

export type DashboardView = 'workspace' | 'workflow' | 'settings';

export interface JumpOutcome {
  success: boolean;
  reason?: string;
}

export interface WorkspaceApi {
  list(): Promise<WorkspaceWithStatus[]>;
  syncFromTmux(): Promise<void>;
  jump(id: string): Promise<JumpOutcome>;
  openInFinder(id: string): Promise<boolean>;
  rename(id: string, name: string): Promise<Workspace | null>;
  remove(id: string, opts?: RemoveOptions): Promise<boolean>;
  onUpdated(callback: () => void): () => void;
}

export interface ProjectsApi {
  list(): Promise<Project[]>;
  onUpdated(callback: () => void): () => void;
}

export interface Channel {
  id: string;
  name: string;
  url: string;
}

export interface IntegrationSnapshot {
  scriptSourcePath: string;
  installCommand: string;
  installed: {
    at: string | null;
    isOurs: boolean;
  };
  claudeMd: {
    path: string;
    exists: boolean;
    snippetInstalled: boolean;
  };
  snippet: string;
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  latestVersion?: string;
  releaseNotes?: string;
  assetSize?: number;
  error?: string;
}

export interface UpdateActionResult {
  success: boolean;
  error?: string;
}

export interface AppApi {
  workspace: WorkspaceApi;
  projects: ProjectsApi;
  workflow: {
    snapshot(): Promise<WorkflowSnapshot>;
    save(definition: WorkflowDefinition): Promise<WorkflowDefinition>;
    createRun(id: string, input: WorkflowRunInput): Promise<WorkflowRun>;
    completeTask(runId: string, taskId: string, input: CompleteWorkflowTaskInput): Promise<WorkflowRun>;
    skipTask(runId: string, taskId: string, reason: string): Promise<WorkflowRun>;
    executeTask(runId: string, taskId: string): Promise<WorkflowRun>;
    cancelTask(runId: string, taskId: string): Promise<boolean>;
    cleanupRun(runId: string): Promise<WorkflowRun>;
    onUpdated(callback: () => void): () => void;
    onTaskOutput(callback: (event: { runId: string; taskId: string; output: string }) => void): () => void;
  };
  getChannels(): Promise<Channel[]>;
  addChannel(name: string, url: string): Promise<Channel[]>;
  removeChannel(id: string): Promise<Channel[]>;
  getSettings(): Promise<AppPreferences>;
  updateSettings(settings: AppPreferences): Promise<AppPreferences>;
  selectProjectsDirectory(currentValue: string): Promise<string | null>;
  saveProjectsDirectory(directory: string): Promise<string>;
  selectWorktreesDirectory(currentValue: string): Promise<string | null>;
  saveWorktreesDirectory(directory: string): Promise<string>;
  getAppVersion(): Promise<string>;
  checkForUpdate(): Promise<UpdateCheckResult>;
  downloadUpdate(): Promise<UpdateActionResult>;
  applyUpdate(): Promise<UpdateActionResult>;
  onUpdateDownloadProgress(callback: (progress: number) => void): () => void;
  openSettings(): void;
  dashboard: {
    getInitialView(): Promise<DashboardView>;
    setView(view: DashboardView): void;
    onNavigate(callback: (view: DashboardView) => void): () => void;
  };
  integration: {
    detect(): Promise<IntegrationSnapshot>;
    copy(text: string): Promise<boolean>;
    openClaudeDir(): Promise<{ opened: boolean; reason?: string }>;
  };
  localAi: {
    list(): Promise<LocalAiProgram[]>;
    create(templateId: LocalAiTemplateId): Promise<LocalAiCreateResult>;
    duplicate(id: string): Promise<LocalAiCreateResult>;
    save(program: LocalAiProgram): Promise<LocalAiProgram[]>;
    remove(id: string): Promise<LocalAiProgram[]>;
    detect(id: string): Promise<LocalAiDetectionResult>;
    run(id: string, prompt: string, runId: string): Promise<LocalAiStartResult>;
    cancel(runId: string): Promise<boolean>;
    onOutput(callback: (event: LocalAiOutputEvent) => void): () => void;
    onFinished(callback: (event: LocalAiFinishedEvent) => void): () => void;
  };
}

declare global {
  interface Window {
    api: AppApi;
  }
}
