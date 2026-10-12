import * as path from 'node:path';
import type { TmuxPaneSnapshot, TmuxSessionSnapshot } from './types';

export const TMUX_SESSION_SNAPSHOT_FORMAT =
  '#{session_name}\t#{pane_current_path}';
export const TMUX_PANE_SNAPSHOT_FORMAT =
  '#{pane_id}\t#{pane_pid}\t#{session_name}\t#{window_name}\t#{pane_index}';

export function parseTmuxPaneSnapshots(output: unknown): TmuxPaneSnapshot[] {
  if (typeof output !== 'string' || !output.trim()) return [];
  return output.split('\n').flatMap((line) => {
    const [id, pid, sessionName, windowName, index, ...extra] = line.trim().split('\t');
    if (extra.length || !/^%\d+$/.test(id) || !/^\d+$/.test(pid) || !sessionName || !/^\d+$/.test(index)) {
      return [];
    }
    return [{ id, pid: Number(pid), sessionName, windowName, paneIndex: Number(index) }];
  });
}

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
