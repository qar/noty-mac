// Shared types for the workspace feature.
// Consumed by main process (workspace.ts, ipc handlers) and re-exported
// via preload for the renderer.

export type WorkspaceSource = 'tmux-sync' | 'manual';

export interface Workspace {
  id: string;
  name: string;
  /** Tmux session name this workspace is linked to. `null` after the session
   *  is manually detached or the user un-links it. */
  tmuxSessionName: string | null;
  /** Absolute path to `~/Library/Application Support/noty-mac/workspaces/<id>/`. */
  directory: string;
  source: WorkspaceSource;
  createdAt: number;
  updatedAt: number;
  lastActiveAt: number | null;
}

/** Return shape of {@link syncFromTmux}. */
export interface WorkspaceSyncResult {
  added: number;
  skipped: number;
  workspaces: Workspace[];
}

export interface RemoveOptions {
  /** When true, also delete the workspace's on-disk directory (guarded by a
   *  UI-side confirmation dialog per red-line §11 in docs/workspace-mvp.md). */
  deleteDir?: boolean;
}

/** Snapshot written to `<workspace-dir>/workspace.json`. electron-store remains
 *  the authoritative copy; this file exists for cross-device / off-machine
 *  migration and human inspection. */
export interface WorkspaceMetaFile {
  id: string;
  name: string;
  tmuxSessionName: string | null;
  source: WorkspaceSource;
  createdAt: number;
  updatedAt: number;
  schemaVersion: 1;
}

// ---------------------------------------------------------------------------
// AI activity status
//
// Reported by an external agent (Claude Code / cursor / a shell script)
// into `<workspace-dir>/agent-status.json`. Noty polls the file each list()
// and shows the current state as a badge on the workspace card + detail
// panel. The renderer decides "stale" from `updatedAt` vs. `Date.now()`.
// ---------------------------------------------------------------------------

export type AgentState =
  | 'idle'
  | 'running'
  | 'waiting_input'
  | 'completed'
  | 'error';

export interface AgentStatus {
  state: AgentState;
  /** One-line human-readable summary. Optional. */
  message?: string;
  /** Identifier of the reporting agent (e.g. `claude-code`, `cursor`, `shell`).
   *  Optional; multi-agent per-workspace is a future concern. */
  agent?: string;
  /** ms epoch — used by the renderer to compute "stale". */
  updatedAt: number;
  /** Optional: reporting process PID. */
  pid?: number;
}

export interface WorkspaceWithStatus extends Workspace {
  /** null when no `agent-status.json` file exists or the file couldn't be
   *  read/parsed. */
  agentStatus: AgentStatus | null;
}
