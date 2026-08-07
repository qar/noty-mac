import * as path from 'node:path';
import type { TmuxSessionSnapshot } from './types';

export const TMUX_SESSION_SNAPSHOT_FORMAT =
  '#{session_name}\t#{pane_current_path}';

export function parseTmuxSessionSnapshots(
  output: unknown
): TmuxSessionSnapshot[] {
  if (typeof output !== 'string' || !output.trim()) return [];

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf('\t');
      const name = (separator >= 0 ? line.slice(0, separator) : line).trim();
      const workingDirectory = separator >= 0
        ? line.slice(separator + 1).trim()
        : '';
      return {
        name,
        workingDirectory: path.isAbsolute(workingDirectory)
          ? path.resolve(workingDirectory)
          : null,
      };
    })
    .filter((session) => session.name.length > 0);
}
