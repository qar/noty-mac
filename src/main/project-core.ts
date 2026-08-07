import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Project } from './types';

export async function discoverProjects(directory: string): Promise<Project[]> {
  const canonicalDirectory = await fs.realpath(directory);
  const entries = await fs.readdir(canonicalDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => !entry.name.startsWith('.') && entry.isDirectory())
    .map((entry) => {
      const projectDirectory = path.join(canonicalDirectory, entry.name);
      return {
        id: projectDirectory,
        name: entry.name,
        directory: projectDirectory,
      };
    })
    .sort((left, right) =>
      left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: 'base',
      })
    );
}

export function projectIdForWorkingDirectory(
  projectsDirectory: string,
  workingDirectory: string | null
): string | null {
  if (!workingDirectory || !path.isAbsolute(workingDirectory)) return null;

  const root = path.resolve(projectsDirectory);
  const relative = path.relative(root, path.resolve(workingDirectory));
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return null;
  }

  const [projectName] = relative.split(path.sep);
  return projectName && !projectName.startsWith('.')
    ? path.join(root, projectName)
    : null;
}
