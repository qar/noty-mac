import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type OpenDialogOptions,
} from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  defaultProjectsDirectory,
  defaultWorktreesDirectory,
  ensureProjectsDirectory,
  ensureWorktreesDirectory,
  normalizeProjectsDirectory,
  normalizeWorktreesDirectory,
  preferencesFromStored,
  preferencesFromUpdate,
} from './settings-core';
import type { AppPreferences } from './settings-types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const store = require('./store');

export function registerSettingsIpc(): void {
  ipcMain.handle('get-settings', (): AppPreferences => loadPreferences());

  ipcMain.handle(
    'update-settings',
    (_event, value: unknown): AppPreferences => {
      const homeDirectory = app.getPath('home');
      const preferences = preferencesFromUpdate(value, homeDirectory);
      const stored = store.get('settings');
      const current = preferencesFromStored(stored, homeDirectory);
      const next = {
        ...(isRecord(stored) ? stored : {}),
        soundEnabled: preferences.soundEnabled,
        hideRead: preferences.hideRead,
        projectsDirectory: current.projectsDirectory,
        worktreesDirectory: current.worktreesDirectory,
      };
      store.set('settings', next);
      return preferencesFromStored(next, homeDirectory);
    }
  );

  ipcMain.handle(
    'save-projects-directory',
    async (event, value: unknown): Promise<string> => {
      const directory = normalizeProjectsDirectory(value, app.getPath('home'));
      const canonicalDirectory = await ensureProjectsDirectory(directory);

      const stored = store.get('settings');
      store.set('settings', {
        ...(isRecord(stored) ? stored : {}),
        projectsDirectory: canonicalDirectory,
      });
      event.sender.send('projects:updated');
      return canonicalDirectory;
    }
  );

  ipcMain.handle(
    'save-worktrees-directory',
    async (_event, value: unknown): Promise<string> => {
      const directory = normalizeWorktreesDirectory(value, app.getPath('home'));
      await ensureWorktreesDirectory(directory);

      const stored = store.get('settings');
      store.set('settings', {
        ...(isRecord(stored) ? stored : {}),
        worktreesDirectory: directory,
      });
      return directory;
    }
  );

  ipcMain.handle(
    'select-projects-directory',
    async (event, currentValue: unknown): Promise<string | null> => {
      const homeDirectory = app.getPath('home');
      const currentDirectory = await pickerDirectory(
        currentValue,
        homeDirectory,
        'projects'
      );
      const owner = BrowserWindow.fromWebContents(event.sender);
      const options: OpenDialogOptions = {
        title: '选择项目目录',
        defaultPath: currentDirectory,
        properties: ['openDirectory', 'createDirectory'],
      };
      const result = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options);
      return result.canceled ? null : result.filePaths[0] ?? null;
    }
  );

  ipcMain.handle(
    'select-worktrees-directory',
    async (event, currentValue: unknown): Promise<string | null> => {
      const homeDirectory = app.getPath('home');
      const currentDirectory = await pickerDirectory(
        currentValue,
        homeDirectory,
        'worktrees'
      );
      const owner = BrowserWindow.fromWebContents(event.sender);
      const options: OpenDialogOptions = {
        title: '选择 Worktrees 目录',
        defaultPath: currentDirectory,
        properties: ['openDirectory', 'createDirectory'],
      };
      const result = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options);
      return result.canceled ? null : result.filePaths[0] ?? null;
    }
  );
}

function loadPreferences(): AppPreferences {
  return preferencesFromStored(store.get('settings'), app.getPath('home'));
}

async function nearestExistingDirectory(directory: string): Promise<string> {
  let candidate = directory;
  while (true) {
    try {
      if ((await fs.stat(candidate)).isDirectory()) return candidate;
    } catch {
      // Continue toward the filesystem root.
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) return parent;
    candidate = parent;
  }
}

function pickerDirectory(
  value: unknown,
  homeDirectory: string,
  kind: 'projects' | 'worktrees'
): Promise<string> {
  let directory = kind === 'projects'
    ? defaultProjectsDirectory(homeDirectory)
    : defaultWorktreesDirectory(homeDirectory);
  try {
    directory = kind === 'projects'
      ? normalizeProjectsDirectory(value, homeDirectory)
      : normalizeWorktreesDirectory(value, homeDirectory);
  } catch {
    // Invalid drafts should not prevent the native picker from opening.
  }
  return nearestExistingDirectory(directory);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
