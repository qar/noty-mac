// Workspace data-layer module.
//
// Responsibilities:
//   - Persist workspaces via electron-store (authoritative copy).
//   - Manage each workspace's on-disk directory under
//     `~/Library/Application Support/noty-mac/workspaces/<uuid>/`.
//   - Provide idempotent `syncFromTmux` that reconciles the persisted
//     workspaces against caller-supplied tmux session snapshots.
//
// Red-line (docs/workspace-mvp.md §11): this module MUST NOT kill tmux
// sessions, delete git worktrees, or touch user files outside its own
// workspace directories. `remove(id, {deleteDir: true})` is the only
// filesystem-write path here, and even that is guarded by an
// out-of-band UI confirmation.

import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { projectIdForWorkingDirectory } from './project-core';
import { getCanonicalProjectsDirectory } from './projects';
import type {
  Workspace,
  WorkspaceSyncResult,
  RemoveOptions,
  WorkspaceMetaFile,
  AgentStatus,
  AgentState,
  WorkspaceWithStatus,
  TmuxSessionSnapshot,
} from './types';

// electron-store is CommonJS in the version pinned here; type it loosely to
// avoid pulling ambient module declarations into strict mode.
type StoreLike = {
  get<T>(key: string): T;
  set(key: string, value: unknown): void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const store: StoreLike = require('./store');

const STORE_KEY = 'workspaces';

function workspacesRoot(): string {
  return path.join(app.getPath('userData'), 'workspaces');
}

function workspaceDirFor(id: string): string {
  return path.join(workspacesRoot(), id);
}

type StoredWorkspace = Omit<Workspace, 'workingDirectory'> & {
  workingDirectory?: unknown;
};

function readAll(): Workspace[] {
  const stored = store.get<StoredWorkspace[]>(STORE_KEY) ?? [];
  return stored.map((workspace) => ({
    ...workspace,
    workingDirectory: normalizeWorkingDirectory(workspace.workingDirectory),
  }));
}

function writeAll(next: Workspace[]): void {
  store.set(STORE_KEY, next);
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function writeMetaFile(ws: Workspace): Promise<void> {
  await ensureDir(ws.directory);
  const meta: WorkspaceMetaFile = {
    id: ws.id,
    name: ws.name,
    tmuxSessionName: ws.tmuxSessionName,
    workingDirectory: ws.workingDirectory,
    source: ws.source,
    createdAt: ws.createdAt,
    updatedAt: ws.updatedAt,
    schemaVersion: 2,
  };
  const file = path.join(ws.directory, 'workspace.json');
  await fs.writeFile(file, JSON.stringify(meta, null, 2) + '\n', 'utf-8');
}

/** Public: return all workspaces sorted by `lastActiveAt` desc, falling back
 *  to `updatedAt`. Never mutates. */
export function list(): Workspace[] {
  const all = readAll();
  return [...all].sort((a, b) => {
    const aKey = a.lastActiveAt ?? a.updatedAt;
    const bKey = b.lastActiveAt ?? b.updatedAt;
    return bKey - aKey;
  });
}

/** Public: return the workspace with this id, or null. */
export function findById(id: string): Workspace | null {
  return readAll().find((w) => w.id === id) ?? null;
}

/** Public: return the workspace directory for `id`, or null if unknown. */
export function getDirectory(id: string): string | null {
  return findById(id)?.directory ?? null;
}

/** Public: idempotent sync.
 *
 *  - Existing workspaces whose `tmuxSessionName` appears in `tmuxSessions`
 *    are kept as-is (updatedAt is refreshed).
 *  - Session names with no existing workspace produce a new workspace with a
 *    fresh uuid directory and a `workspace.json` snapshot.
 *  - Workspaces whose `tmuxSessionName` is NOT in `tmuxSessions` are
 *    RETAINED (not removed) — the tmux session might merely be offline. The
 *    UI marks them as offline; see workspace-mvp.md §4.3 and §Q9.
 */
export async function syncFromTmux(
  tmuxSessions: TmuxSessionSnapshot[]
): Promise<WorkspaceSyncResult> {
  const now = Date.now();
  const existing = readAll();
  const byName = new Map<string, Workspace>();
  for (const w of existing) {
    if (w.tmuxSessionName) {
      byName.set(w.tmuxSessionName, w);
    }
  }

  const next: Workspace[] = [...existing];
  let added = 0;
  let skipped = 0;

  for (const session of tmuxSessions) {
    const name = session.name;
    const workingDirectory = normalizeWorkingDirectory(session.workingDirectory);
    const hit = byName.get(name);
    if (hit) {
      hit.updatedAt = now;
      if (workingDirectory && hit.workingDirectory !== workingDirectory) {
        hit.workingDirectory = workingDirectory;
        try {
          await writeMetaFile(hit);
        } catch (err) {
          console.warn('[workspace] failed to update meta file for', hit.id, err);
        }
      }
      skipped += 1;
      continue;
    }
    const id = randomUUID();
    const ws: Workspace = {
      id,
      name,
      tmuxSessionName: name,
      workingDirectory,
      directory: workspaceDirFor(id),
      source: 'tmux-sync',
      createdAt: now,
      updatedAt: now,
      lastActiveAt: null,
    };
    next.push(ws);
    // Filesystem side-effect for new workspaces only. Failure here should not
    // block persistence — the workspace exists conceptually even if metadata
    // file couldn't be written.
    try {
      await writeMetaFile(ws);
    } catch (err) {
      console.warn('[workspace] failed to write meta file for', id, err);
    }
    added += 1;
  }

  writeAll(next);
  return { added, skipped, workspaces: list() };
}

/** Public: rename a workspace. Returns the updated workspace or null. */
export async function rename(
  id: string,
  name: string
): Promise<Workspace | null> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('workspace name cannot be empty');
  }
  const all = readAll();
  const ws = all.find((w) => w.id === id);
  if (!ws) return null;
  ws.name = trimmed;
  ws.updatedAt = Date.now();
  writeAll(all);
  try {
    await writeMetaFile(ws);
  } catch (err) {
    console.warn('[workspace] failed to update meta file for', id, err);
  }
  return ws;
}

/** Public: remove a workspace's metadata; optionally delete its directory.
 *  Never touches anything outside the workspace directory. */
export async function remove(
  id: string,
  opts: RemoveOptions = {}
): Promise<boolean> {
  const all = readAll();
  const idx = all.findIndex((w) => w.id === id);
  if (idx < 0) return false;
  const [ws] = all.splice(idx, 1);
  writeAll(all);

  if (opts.deleteDir) {
    // Defensive: only ever remove paths under our own workspaces root.
    const root = workspacesRoot();
    const resolved = path.resolve(ws.directory);
    if (!resolved.startsWith(path.resolve(root) + path.sep)) {
      console.warn(
        '[workspace] refusing to delete out-of-scope directory:',
        resolved
      );
      return true;
    }
    try {
      await fs.rm(resolved, { recursive: true, force: true });
    } catch (err) {
      console.warn('[workspace] failed to remove workspace dir:', resolved, err);
    }
  }
  return true;
}

/** Public: bump `lastActiveAt` after a successful jump; sorting picks it up. */
export function markActive(id: string): void {
  const all = readAll();
  const ws = all.find((w) => w.id === id);
  if (!ws) return;
  const now = Date.now();
  ws.lastActiveAt = now;
  ws.updatedAt = now;
  writeAll(all);
}

// -----------------------------------------------------------------------
// Agent status
//
// Each workspace directory MAY contain an `agent-status.json` file written
// by an external agent (Claude Code / a shell script / etc.). We read it
// on demand for `listWithStatus()`. Failures are non-fatal — a malformed
// or missing file is treated as "no status".
// -----------------------------------------------------------------------

const AGENT_STATUS_FILENAME = 'agent-status.json';
const VALID_STATES: readonly AgentState[] = [
  'idle',
  'running',
  'waiting_input',
  'completed',
  'error',
];

async function readAgentStatus(workspaceDir: string): Promise<AgentStatus | null> {
  const file = path.join(workspaceDir, AGENT_STATUS_FILENAME);
  let content: string;
  try {
    content = await fs.readFile(file, 'utf-8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;

  const state = obj.state;
  const updatedAt = obj.updatedAt;
  if (typeof state !== 'string') return null;
  if (!VALID_STATES.includes(state as AgentState)) return null;
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return null;

  return {
    state: state as AgentState,
    message: typeof obj.message === 'string' ? obj.message : undefined,
    agent: typeof obj.agent === 'string' ? obj.agent : undefined,
    updatedAt,
    pid: typeof obj.pid === 'number' ? obj.pid : undefined,
  };
}

/** Public: `list()` + each workspace's parsed `agent-status.json` (or null). */
export async function listWithStatus(): Promise<WorkspaceWithStatus[]> {
  const all = list();
  const projectsDirectory = await getCanonicalProjectsDirectory();
  return Promise.all(
    all.map(async (ws) => ({
      ...ws,
      agentStatus: await readAgentStatus(ws.directory),
      projectId: projectIdForWorkingDirectory(
        projectsDirectory,
        ws.workingDirectory
      ),
    }))
  );
}

function normalizeWorkingDirectory(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\0') ||
    !path.isAbsolute(value)
  ) {
    return null;
  }
  return path.resolve(value);
}

// Test-only helpers (not exported to preload).
export const __test__ = {
  workspacesRoot,
  workspaceDirFor,
};
