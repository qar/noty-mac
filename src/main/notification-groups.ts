import type { AppNotification } from './notification-types';

export function notificationTmuxTarget(item: AppNotification): string | null {
  if (item.metadata?.tmux?.target) return item.metadata.tmux.target;
  const line = item.message?.split('\n').find(value => /^\s*(?:🖥\s*)?tmux\s*:/i.test(value));
  return line?.match(/^\s*(?:🖥\s*)?tmux\s*:\s*([A-Za-z0-9_.:%@+/-]+)\s*$/i)?.[1] ?? null;
}

export function notificationGroupKey(item: AppNotification): string {
  if (item.type === 'plane') {
    const plane = item.metadata?.plane;
    const issue = plane?.issueId
      ? ['id', plane.issueId]
      : plane?.issueIdentifier ? ['identifier', plane.issueIdentifier.trim().toUpperCase()] : null;
    if (issue) return JSON.stringify(['plane', item.channelId, plane?.workspaceSlug || '', issue]);
  } else {
    const target = notificationTmuxTarget(item);
    if (target) {
      // A reused pane number must not merge messages from a different source project.
      const source = item.metadata?.tmux?.sourceProject || item.metadata?.project?.name || '';
      return JSON.stringify(['tmux', item.channelId, source, target]);
    }
  }
  return JSON.stringify(['notification', item.id]);
}

export function groupNotifications(items: readonly AppNotification[]): AppNotification[][] {
  const groups = new Map<string, AppNotification[]>();
  for (const item of [...items].sort((a, b) => b.timestamp - a.timestamp)) {
    const key = notificationGroupKey(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()];
}
