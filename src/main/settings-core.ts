import { constants as fsConstants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AppPreferences } from './settings-types';

const MAX_DIRECTORY_LENGTH = 4096;

export class WorktreesDirectoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorktreesDirectoryError';
  }
}

export class ProjectsDirectoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectsDirectoryError';
  }
}

export function defaultProjectsDirectory(homeDirectory: string): string {
  return path.join(homeDirectory, 'projects');
}

export function defaultWorktreesDirectory(homeDirectory: string): string {
  return path.join(homeDirectory, 'worktrees');
}

export function normalizeProjectsDirectory(
  value: unknown,
  homeDirectory: string
): string {
  return normalizeDirectory(
    value,
    homeDirectory,
    '项目目录',
    (message) => new ProjectsDirectoryError(message)
  );
}

export function normalizeWorktreesDirectory(
  value: unknown,
  homeDirectory: string
): string {
  return normalizeDirectory(
    value,
    homeDirectory,
    'Worktrees 目录',
    (message) => new WorktreesDirectoryError(message)
  );
}

function normalizeDirectory(
  value: unknown,
  homeDirectory: string,
  label: string,
  error: (message: string) => Error
): string {
  if (typeof value !== 'string') {
    throw error(`${label}格式无效`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw error(`${label}不能为空`);
  }
  if (trimmed.length > MAX_DIRECTORY_LENGTH || trimmed.includes('\0')) {
    throw error(`${label}格式无效`);
  }

  const expanded = trimmed === '~'
    ? homeDirectory
    : trimmed.startsWith('~/')
      ? path.join(homeDirectory, trimmed.slice(2))
      : trimmed;

  if (!path.isAbsolute(expanded)) {
    throw error(`${label}必须使用绝对路径`);
  }

  return path.resolve(expanded);
}

export function preferencesFromStored(
  value: unknown,
  homeDirectory: string
): AppPreferences {
  const stored = isRecord(value) ? value : {};
  let projectsDirectory: string;
  try {
    projectsDirectory = normalizeProjectsDirectory(
      stored.projectsDirectory,
      homeDirectory
    );
  } catch {
    projectsDirectory = defaultProjectsDirectory(homeDirectory);
  }

  let worktreesDirectory: string;
  try {
    worktreesDirectory = normalizeWorktreesDirectory(
      stored.worktreesDirectory,
      homeDirectory
    );
  } catch {
    worktreesDirectory = defaultWorktreesDirectory(homeDirectory);
  }

  return {
    soundEnabled: stored.soundEnabled !== false,
    hideRead: stored.hideRead !== false,
    projectsDirectory,
    worktreesDirectory,
  };
}

export function preferencesFromUpdate(
  value: unknown,
  homeDirectory: string
): AppPreferences {
  if (
    !isRecord(value) ||
    typeof value.soundEnabled !== 'boolean' ||
    typeof value.hideRead !== 'boolean'
  ) {
    throw new Error('偏好设置格式无效');
  }

  return {
    soundEnabled: value.soundEnabled,
    hideRead: value.hideRead,
    projectsDirectory: normalizeProjectsDirectory(
      value.projectsDirectory,
      homeDirectory
    ),
    worktreesDirectory: normalizeWorktreesDirectory(
      value.worktreesDirectory,
      homeDirectory
    ),
  };
}

export async function ensureProjectsDirectory(directory: string): Promise<string> {
  try {
    const stat = await fs.stat(directory);
    if (!stat.isDirectory()) {
      throw new ProjectsDirectoryError('项目路径不是目录');
    }
    await fs.access(directory, fsConstants.R_OK);
    await fs.readdir(directory);
    return await fs.realpath(directory);
  } catch (error) {
    if (error instanceof ProjectsDirectoryError) throw error;
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
    if (code === 'ENOENT') {
      throw new ProjectsDirectoryError('项目目录不存在');
    }
    if (code === 'EACCES' || code === 'EPERM') {
      throw new ProjectsDirectoryError('没有权限读取项目目录');
    }
    if (code === 'ENOTDIR') {
      throw new ProjectsDirectoryError('项目路径不是目录');
    }
    throw new ProjectsDirectoryError('无法访问项目目录');
  }
}

export async function ensureWorktreesDirectory(directory: string): Promise<void> {
  try {
    await fs.mkdir(directory, { recursive: true });
    const stat = await fs.stat(directory);
    if (!stat.isDirectory()) {
      throw new WorktreesDirectoryError('Worktrees 路径不是目录');
    }
    await fs.access(directory, fsConstants.W_OK);
  } catch (error) {
    if (error instanceof WorktreesDirectoryError) throw error;
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
    if (code === 'EACCES' || code === 'EPERM') {
      throw new WorktreesDirectoryError('没有权限写入 Worktrees 目录');
    }
    if (code === 'EEXIST' || code === 'ENOTDIR') {
      throw new WorktreesDirectoryError('Worktrees 路径不是目录');
    }
    throw new WorktreesDirectoryError('无法创建或访问 Worktrees 目录');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
