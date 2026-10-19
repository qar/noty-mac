// Workspace IPC registration.
//
// The renderer talks to the main process through `window.api.workspace.*`,
// wired in src/preload.js. This module owns the `workspace:*` channel names
// and dispatches to the workspace data-layer module (main-process only).
//
// External behaviour (jump to tmux, run sync) is delegated back to index.js
// via a small `deps` object rather than imported directly — this keeps the
// heavy tmux orchestration in one place until we do a proper tmux refactor.

import { ipcMain, shell } from 'electron';
import type { ActiveAiPane, RemoveOptions, Workspace, WorkspaceWithStatus } from './types';
import { detectAiPanes } from './ai-pane-detection';
import { parseTmuxPaneSnapshots, TMUX_PANE_SNAPSHOT_FORMAT } from './tmux-workspace';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const workspace = require('./workspace');

export interface JumpOutcome {
  success: boolean;
  reason?: string;
}

export interface WorkspaceIpcDeps {
  /** Simplified Q7-mode jump: only `switch-client -t {session}`. */
  jumpToTmuxSession: (sessionName: string) => Promise<JumpOutcome>;
  /** The same sync flow the tray menu triggers. Runs read-only tmux
   *  list-sessions internally and posts a system notification. */
  syncTmuxToWorkspaces: () => Promise<void>;
  listTmuxPanes: (format: string) => Promise<string>;
  listProcesses: () => Promise<string>;
  capturePaneDigest: (paneId: string) => Promise<string>;
  jumpToTmuxPane: (paneId: string) => Promise<JumpOutcome>;
}

export function registerWorkspaceIpc(deps: WorkspaceIpcDeps): void {
  ipcMain.handle('workspace:list', async (): Promise<WorkspaceWithStatus[]> => {
    return workspace.listWithStatus();
  });

  ipcMain.handle('workspace:active-ai-panes', async (): Promise<ActiveAiPane[]> => {
    try {
      const [tmuxOutput, processOutput] = await Promise.all([
        deps.listTmuxPanes(TMUX_PANE_SNAPSHOT_FORMAT),
        deps.listProcesses(),
      ]);
      const panes = parseTmuxPaneSnapshots(tmuxOutput);
      const detected = detectAiPanes(panes, processOutput);
      const activityVersions = new Map(await Promise.all(
        [...detected.keys()].map(async (id): Promise<[string, string]> => {
          try {
            return [id, await deps.capturePaneDigest(id)];
          } catch {
            return [id, ''];
          }
        })
      ));
      return workspace.listActiveAiPanes(panes, detected, activityVersions);
    } catch (error) {
      console.warn('[workspace-ipc] failed to list tmux panes:', error);
      return [];
    }
  });

  ipcMain.handle('workspace:jump-pane', async (_event, paneId: string): Promise<JumpOutcome> => {
    if (typeof paneId !== 'string' || !/^%\d+$/.test(paneId)) {
      return { success: false, reason: 'invalid_target' };
    }
    return deps.jumpToTmuxPane(paneId);
  });

  ipcMain.handle('workspace:sync-tmux', async (): Promise<void> => {
    await deps.syncTmuxToWorkspaces();
  });

  ipcMain.handle(
    'workspace:jump',
    async (_event, id: string): Promise<JumpOutcome> => {
      if (typeof id !== 'string' || !id) {
        return { success: false, reason: 'invalid_id' };
      }
      const ws = workspace.findById(id);
      if (!ws) {
        return { success: false, reason: 'workspace_not_found' };
      }
      if (!ws.tmuxSessionName) {
        return { success: false, reason: 'workspace_offline' };
      }
      const result = await deps.jumpToTmuxSession(ws.tmuxSessionName);
      if (result.success) {
        workspace.markActive(id);
      }
      return result;
    }
  );

  ipcMain.handle(
    'workspace:open-in-finder',
    async (_event, id: string): Promise<boolean> => {
      if (typeof id !== 'string' || !id) return false;
      const dir = workspace.getDirectory(id);
      if (!dir) return false;
      // shell.openPath returns "" on success, an error string on failure.
      const err = await shell.openPath(dir);
      if (err) {
        console.warn('[workspace-ipc] openPath failed:', dir, err);
        return false;
      }
      return true;
    }
  );

  ipcMain.handle(
    'workspace:rename',
    async (_event, id: string, name: string): Promise<Workspace | null> => {
      if (typeof id !== 'string' || !id) return null;
      if (typeof name !== 'string') return null;
      return workspace.rename(id, name);
    }
  );

  ipcMain.handle(
    'workspace:remove',
    async (
      _event,
      id: string,
      opts?: RemoveOptions
    ): Promise<boolean> => {
      if (typeof id !== 'string' || !id) return false;
      // Defensive: only pass through the whitelisted options key.
      const safeOpts: RemoveOptions = {
        deleteDir: opts?.deleteDir === true,
      };
      return workspace.remove(id, safeOpts);
    }
  );
}
