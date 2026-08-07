import { ipcMain } from 'electron';
import { listProjects } from './projects';
import type { Project } from './types';

export function registerProjectsIpc(): void {
  ipcMain.handle('projects:list', (): Promise<Project[]> => listProjects());
}
