import { compile } from 'html-to-text';
import type { AppNotification, Channel, ChannelOptions, PlaneEvent } from './notification-types';

const commentToText = compile({
  wordwrap: false,
  selectors: [
    { selector: 'a', options: { ignoreHref: true } },
    { selector: 'img', format: 'skip' },
  ],
});
const commentCharacters = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function planeCommentPreview(rawPayload: string): string | null {
  let payload: Record<string, unknown>;
  try { payload = record(JSON.parse(rawPayload)); } catch { return null; }
  if (payload.event !== 'issue_comment') return null;
  const data = record(payload.data);
  const content = (text(data.comment_stripped) || commentToText(text(data.comment_html)))
    .replace(/\s+/gu, ' ').trim();
  if (!content) return null;
  let preview = '';
  let count = 0;
  for (const { segment } of commentCharacters.segment(content)) {
    if (count === 200) return `${preview}…`;
    preview += segment;
    count++;
  }
  return preview;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function id(value: unknown): string {
  return text(value) || text(record(value).id);
}

export function safeWebUrl(value: unknown): string | null {
  try {
    const url = new URL(text(value));
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href : null;
  } catch {
    return null;
  }
}

export function channelFromInput(name: unknown, value: unknown, input: unknown = {}): Omit<Channel, 'id'> {
  const options = record(input);
  const type = options.type ?? 'tmux-agent';
  if (type !== 'tmux-agent' && type !== 'plane') throw new Error('通知类型无效');
  const raw = text(value);
  const url = safeWebUrl(raw.includes('://') ? raw : `https://ntfy.sh/${raw}`);
  if (!raw || !url) throw new Error('请输入有效的 ntfy 频道地址');
  const parsed = new URL(url);
  if (parsed.pathname === '/' || parsed.search || parsed.hash) throw new Error('ntfy 地址必须包含频道，且不能包含查询参数或片段');
  const channel: Omit<Channel, 'id'> = {
    name: text(name) || (type === 'plane' ? 'RtiTek Plane' : 'Tmux AI agent'),
    url: url.replace(/\/+$/, ''),
    type,
  };
  if (type === 'plane') {
    const base = safeWebUrl(options.planeBaseUrl);
    if (!base) throw new Error('请输入有效的 Plane 网站地址');
    const parsedBase = new URL(base);
    if (parsedBase.search || parsedBase.hash) throw new Error('Plane 网站地址不能包含查询参数或片段');
    channel.planeBaseUrl = base.replace(/\/+$/, '');
    channel.planeWorkspaceSlug = text(options.planeWorkspaceSlug);
    if (channel.planeWorkspaceSlug && !/^[\w-]+$/.test(channel.planeWorkspaceSlug)) {
      throw new Error('Plane 工作区标识格式无效');
    }
  }
  return channel;
}

export function normalizePlaneNotification(channel: ChannelOptions, rawPayload: string, click?: unknown): {
  title: string; message: string; metadata: { plane: PlaneEvent };
} {
  let payload: Record<string, unknown> = {};
  let parseError: string | undefined;
  try {
    const parsed: unknown = JSON.parse(rawPayload);
    payload = record(parsed);
    if (!text(payload.event)) parseError = '消息缺少 Plane 事件类型';
  } catch {
    parseError = '消息不是有效的 Plane JSON';
  }
  const data = record(payload.data);
  const activity = record(payload.activity);
  const issue = record(data.issue);
  const project = record(data.project);
  const event = text(payload.event) || 'unknown';
  const action = text(payload.action);
  const field = text(activity.field);
  const issueId = event === 'issue' ? id(data.id) : id(data.issue) || id(data.issue_id);
  const projectId = id(data.project) || id(data.project_id) || id(issue.project);
  const workspaceSlug = text(payload.workspace_slug) || text(record(data.workspace).slug)
    || text(channel.planeWorkspaceSlug);

  // Only explicit work-item links are trusted as links; generic API `url` fields
  // are not browser destinations. Standard webhooks need the configured origin.
  let url = safeWebUrl(click) || safeWebUrl(payload.issue_url) || safeWebUrl(data.issue_url);
  if (!url && channel.planeBaseUrl && workspaceSlug && projectId && issueId) {
    const parts = [workspaceSlug, 'projects', projectId, 'issues', issueId].map(encodeURIComponent);
    url = safeWebUrl(`${channel.planeBaseUrl}/${parts.join('/')}`);
  }
  const eventLabels: Record<string, string> = {
    issue: '任务', issue_comment: '评论', project: '项目', cycle: '迭代',
    module: '模块', cycle_issue: '迭代任务', module_issue: '模块任务', intake_issue: '收件箱任务',
  };
  const actionLabels: Record<string, string> = {
    create: '新建', created: '新建', update: '更新', updated: '更新', delete: '删除', deleted: '删除',
  };
  const summary = [actionLabels[action] || action, eventLabels[event] || event].filter(Boolean).join('');
  const actor = record(activity.actor);
  const actorName = text(actor.display_name) || [text(actor.first_name), text(actor.last_name)].filter(Boolean).join(' ');
  const sequence = data.sequence_id ?? issue.sequence_id;
  const identifier = text(project.identifier) && (typeof sequence === 'number' || typeof sequence === 'string')
    ? `${text(project.identifier)}-${sequence}` : '';
  const issueName = (event === 'issue' ? text(data.name) : text(issue.name)) || text(data.name);
  const title = [identifier, issueName].filter(Boolean).join(' ') || `RtiTek Plane · ${summary}`;
  const details = [actorName, summary, field ? `字段: ${field}` : ''].filter(Boolean);
  if (field) {
    const before = displayValue(activity.old_value);
    const after = displayValue(activity.new_value);
    if (before || after) details.push(`${before || '(空)'} → ${after || '(空)'}`);
  }
  const message = parseError
    ? `${parseError}\n${rawPayload}`
    : [details.join(' · '), text(data.comment_stripped)].filter(Boolean).join('\n');
  return {
    title,
    message,
    metadata: { plane: { deliveryId: text(payload.delivery_id), event, action, field, issueId, projectId, workspaceSlug, url, rawPayload, ...(parseError ? { parseError } : {}) } },
  };
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return (typeof value === 'string' ? value : JSON.stringify(value)).slice(0, 300);
}

export function isPendingNotification(item: AppNotification): boolean {
  return item.type === 'plane' ? !item.completedAt : !item.read;
}

export function retainNotifications(items: AppNotification[], historyLimit = 1000): AppNotification[] {
  let historyCount = 0;
  // Plane events form a durable inbox, including completed events (undo and
  // replay deduplication). The existing history cap only applies to tmux.
  return items.filter(item => item.type === 'plane' || ++historyCount <= historyLimit);
}

export function clearReadNotifications(items: AppNotification[]): AppNotification[] {
  return items.filter(item => item.type === 'plane' || !item.read);
}

export function setNotificationCompleted(items: AppNotification[], notificationId: string, completed: boolean, now = Date.now()): AppNotification[] {
  return items.map(item => item.id === notificationId && item.type === 'plane'
    ? { ...item, completedAt: completed ? now : null, read: completed ? true : item.read }
    : item);
}

export function setNotificationsDismissed(items: AppNotification[], notificationIds: string[], dismissed: boolean, now = Date.now()): AppNotification[] {
  const ids = new Set(notificationIds);
  return items.map(item => ids.has(item.id)
    ? { ...item, read: dismissed, ...(item.type === 'plane' ? { completedAt: dismissed ? item.completedAt ?? now : null } : {}) }
    : item);
}
