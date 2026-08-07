import { app } from 'electron';
import * as fs from 'node:fs/promises';
import { discoverProjects } from './project-core';
import { preferencesFromStored } from './settings-core';
import type { Project } from './types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const store = require('./store');

export function getProjectsDirectory(): string {
  return preferencesFromStored(
    store.get('settings'),
    app.getPath('home')
  ).projectsDirectory;
}

export function listProjects(): Promise<Project[]> {
  return discoverProjects(getProjectsDirectory());
}

export async function getCanonicalProjectsDirectory(): Promise<string> {
  const directory = getProjectsDirectory();
  try {
    return await fs.realpath(directory);
  } catch {
    return directory;
  }
}
