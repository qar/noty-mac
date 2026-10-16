import * as path from 'node:path';
import { detectAiPanes } from './ai-pane-detection';
import type { AppNotification } from './notification-types';
import type { TmuxPaneSnapshot } from './types';

export interface NotificationCheckout {
  root: string;
  branch: string;
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
  const agent = notification.title.match(/^(Codex|Claude|Gemini|OpenCode|Aider|Cursor|Amp)\b/i)?.[1].toLowerCase();
  if (!project?.name || !project.branch || !agent) return { reason: 'no_target' };
  const detected = detectAiPanes(panes, processOutput);
  const matching: { target: string; checkout: NotificationCheckout }[] = [];
  let unverified = false;
  for (const [target, name] of detected) {
    if (name.toLowerCase() !== agent) continue;
    try {
      const checkout = await readCheckout(target);
      if (checkout && path.basename(checkout.root) === project.name && checkout.branch === project.branch) {
        matching.push({ target, checkout });
      }
    } catch {
      unverified = true;
    }
  }
  if (matching.length > 1) return { reason: 'source_ambiguous' };
  if (unverified) return { reason: 'source_project_unverified' };
  return matching[0] ?? { reason: 'source_unavailable' };
}
