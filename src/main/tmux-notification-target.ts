import * as path from 'node:path';
import { detectAiPanes } from './ai-pane-detection';
import type { AppNotification } from './notification-types';
import type { TmuxPaneSnapshot } from './types';

export interface NotificationCheckout {
  root: string;
  branch: string | null;
}

type RecoveredTarget = { target: string; checkout: NotificationCheckout }
  | { reason: 'no_target' | 'source_ambiguous' | 'source_unavailable' | 'source_project_unverified' };

export async function recoverNotificationTarget(
  notification: AppNotification,
  panes: TmuxPaneSnapshot[],
  processOutput: string,
  readCheckout: (paneId: string) => Promise<NotificationCheckout | null>,
): Promise<RecoveredTarget> {
  const project = notification.metadata?.project;
  const sourceProject = notification.metadata?.tmux?.sourceProject;
  const projectName = sourceProject || project?.name;
  const agent = notification.title.match(/^(Codex|Claude|Gemini|OpenCode|Aider|Cursor|Amp)\b/i)?.[1].toLowerCase();
  if (!projectName || (!sourceProject && !project?.branch) || !agent) return { reason: 'no_target' };
  const detected = detectAiPanes(panes, processOutput);
  // Prefer the original agent; a single remaining shell is still a destination.
  const groups = [panes.filter(pane => detected.get(pane.id)?.toLowerCase() === agent),
    panes.filter(pane => !detected.has(pane.id))];
  const switchedBranch: { target: string; checkout: NotificationCheckout }[] = [];
  for (const group of groups) {
    const matching: { target: string; checkout: NotificationCheckout }[] = [];
    let unverified = false;
    for (const { id: target } of group) {
      try {
        const checkout = await readCheckout(target);
        const sourceAgent = detected.get(target)?.toLowerCase() === agent;
        if (checkout && path.basename(checkout.root) === projectName) {
          if (sourceProject || checkout.branch === project?.branch) matching.push({ target, checkout });
          else if (sourceAgent) switchedBranch.push({ target, checkout });
        }
      } catch {
        unverified = true;
      }
    }
    if (matching.length > 1) return { reason: 'source_ambiguous' };
    if (unverified) return { reason: 'source_project_unverified' };
    if (matching[0]) return matching[0];
  }
  // A checkout can change branches while its source agent stays in the pane.
  // Only recover across branches when no exact destination exists and the agent is unique.
  if (switchedBranch.length) {
    if (switchedBranch.length > 1) return { reason: 'source_ambiguous' };
    return switchedBranch[0];
  }
  return { reason: 'source_unavailable' };
}
