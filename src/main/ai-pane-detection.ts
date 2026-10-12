import * as path from 'node:path';
import type { TmuxPaneSnapshot } from './types';

const AI_EXECUTABLES = new Map([
  ['claude', 'Claude'],
  ['codex', 'Codex'],
  ['gemini', 'Gemini'],
  ['opencode', 'OpenCode'],
  ['aider', 'Aider'],
  ['cursor-agent', 'Cursor'],
  ['amp', 'Amp'],
]);

/** Match a running AI CLI to the tmux pane shell in its parent process chain. */
export function detectAiPanes(
  panes: Pick<TmuxPaneSnapshot, 'id' | 'pid'>[],
  processOutput: string
): Map<string, string> {
  const paneByPid = new Map(panes.map((pane) => [pane.pid, pane.id]));
  const processes = new Map<number, { parentPid: number; command: string }>();
  for (const line of processOutput.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/);
    if (!match) continue;
    processes.set(Number(match[1]), {
      parentPid: Number(match[2]),
      command: path.basename(match[3]),
    });
  }

  const detected = new Map<string, string>();
  for (const process of processes.values()) {
    const agentName = AI_EXECUTABLES.get(process.command);
    if (!agentName) continue;
    const visited = new Set<number>();
    let parentPid = process.parentPid;
    while (parentPid && !visited.has(parentPid)) {
      const paneId = paneByPid.get(parentPid);
      if (paneId) {
        detected.set(paneId, agentName);
        break;
      }
      visited.add(parentPid);
      parentPid = processes.get(parentPid)?.parentPid ?? 0;
    }
  }
  return detected;
}
