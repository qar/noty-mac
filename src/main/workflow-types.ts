export type WorkflowTaskKind = 'manual' | 'approval' | 'command' | 'ai';
export type WorkflowStageMode = 'serial' | 'parallel';
export type WorkflowTaskStatus =
  | 'blocked'
  | 'ready'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'interrupted';

export interface WorkflowRepository {
  alias: string;
  projectId: string;
  baseBranch: string;
}

export interface WorkflowTaskDefinition {
  id: string;
  name: string;
  kind: WorkflowTaskKind;
  repositoryAlias?: string;
  executable?: string;
  args?: string[];
  aiProgramId?: string;
  prompt?: string;
  instructions?: string;
}

export interface WorkflowStageDefinition {
  id: string;
  name: string;
  mode: WorkflowStageMode;
  tasks: WorkflowTaskDefinition[];
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: number;
  repositories: WorkflowRepository[];
  stages: WorkflowStageDefinition[];
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowRunInput {
  title: string;
  version?: string;
  workItem?: string;
  baseBranches?: Record<string, string>;
}

export interface WorkflowExecutionContext {
  repositoryAlias: string;
  projectId: string;
  baseBranch: string;
  branch: string;
  directory: string;
}

export interface WorkflowTaskAttempt {
  id: string;
  startedAt: number;
  finishedAt: number | null;
  status: 'running' | 'succeeded' | 'failed' | 'interrupted';
  exitCode: number | null;
  logFile: string | null;
  error?: string;
}

export interface WorkflowTaskRun {
  taskId: string;
  status: WorkflowTaskStatus;
  attempts: WorkflowTaskAttempt[];
  note?: string;
  evidence?: string;
  skipReason?: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  definition: WorkflowDefinition;
  input: WorkflowRunInput;
  status: 'active' | 'completed' | 'completed_with_skips' | 'cancelled';
  tasks: Record<string, WorkflowTaskRun>;
  contexts: WorkflowExecutionContext[];
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface WorkflowSnapshot {
  definitions: WorkflowDefinition[];
  runs: WorkflowRun[];
}

export interface CompleteWorkflowTaskInput {
  note?: string;
  evidence?: string;
}
