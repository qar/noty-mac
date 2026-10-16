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

export function planeIssueDetails(value: unknown, projectValue?: unknown): { issueIdentifier?: string; issueName?: string } {
  const issue = record(value);
  const project = record(projectValue ?? issue.project);
  const sequence = issue.sequence_id;
  const projectIdentifier = text(project.identifier);
  const identifier = text(issue.identifier);
  const issueIdentifier = projectIdentifier && /^\d+$/.test(String(sequence))
    ? `${projectIdentifier}-${sequence}` : /^[\w-]+-\d+$/.test(identifier) ? identifier : '';
  return {
    ...(issueIdentifier ? { issueIdentifier } : {}),
    ...(text(issue.name) ? { issueName: text(issue.name) } : {}),
  };
}

export function planeNotificationTitle(plane: Pick<PlaneEvent, 'issueIdentifier' | 'issueName'>, fallback: string): string {
  return [plane.issueIdentifier, plane.issueName].filter(Boolean).join(' ') || fallback;
}

function personName(value: unknown): string {
  const person = record(value);
  return text(person.display_name) || [text(person.first_name), text(person.last_name)].filter(Boolean).join(' ') || text(person.email);
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
  const project = record(typeof data.project === 'object' ? data.project : issue.project);
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
  const actorName = personName(actor);
  const issueDetails = planeIssueDetails(event === 'issue' ? data : issue, project);
  if (!issueDetails.issueIdentifier && url) {
    const identifier = new URL(url).pathname.match(/\/browse\/([\w-]+-\d+)\/?$/)?.[1];
    if (identifier) issueDetails.issueIdentifier = identifier;
  }
  const title = planeNotificationTitle(issueDetails, text(data.name) || `RtiTek Plane · ${summary}`);
  const creator = data.created_by;
  // On edits/deletions the event actor may not be the comment's author.
  const commentAuthor = event === 'issue_comment'
    ? personName(creator) || (id(creator) && id(creator) !== id(actor) ? '' : actorName) : '';
  const createdAt = text(data.created_at);
  const commentCreatedAt = event === 'issue_comment' && createdAt && Number.isFinite(Date.parse(createdAt))
    ? new Date(createdAt).toISOString() : '';
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
    metadata: { plane: {
      deliveryId: text(payload.delivery_id), event, action, field, issueId, projectId, workspaceSlug, url, rawPayload,
      ...issueDetails,
      ...(commentAuthor ? { commentAuthor } : {}),
      ...(commentCreatedAt ? { commentCreatedAt } : {}),
      ...(parseError ? { parseError } : {}),
    } },
  };
}

export function hydratePlaneNotifications(items: AppNotification[], channels: Channel[]): AppNotification[] {
  const sources = new Map(channels.map(channel => [channel.id, channel]));
  const normalized = items.map(item => {
    const previous = item.metadata?.plane;
    if (item.type !== 'plane' || !previous || previous.attachment?.status === 'error') return item;
    const parsed = normalizePlaneNotification(sources.get(item.channelId) ?? { planeWorkspaceSlug: previous.workspaceSlug }, previous.rawPayload, previous.sourceClick || previous.url);
    const plane = { ...previous, ...parsed.metadata.plane,
      issueIdentifier: previous.issueIdentifier || parsed.metadata.plane.issueIdentifier,
      issueName: previous.issueName || parsed.metadata.plane.issueName,
    };
    return { ...item, title: planeNotificationTitle(plane, parsed.title), metadata: { ...item.metadata, plane } };
  });
  // Reuse known task details across independent reminders, including history.
  const known = new Map<string, { issueIdentifier?: string; issueName?: string }>();
  const taskKey = (item: AppNotification, plane: PlaneEvent) => JSON.stringify([item.channelId, plane.workspaceSlug, plane.projectId, plane.issueId]);
  for (const item of [...normalized].sort((a, b) => b.timestamp - a.timestamp)) {
    const plane = item.metadata?.plane;
    if (!plane?.issueId) continue;
    const key = taskKey(item, plane);
    const details = known.get(key) ?? {};
    details.issueIdentifier ||= plane.issueIdentifier;
    details.issueName ||= plane.issueName;
    known.set(key, details);
  }
  return normalized.map(item => {
    const previous = item.metadata?.plane;
    if (!previous?.issueId) return item;
    const details = known.get(taskKey(item, previous));
    const plane = { ...previous,
      issueIdentifier: previous.issueIdentifier || details?.issueIdentifier,
      issueName: previous.issueName || details?.issueName,
    };
    return { ...item, title: planeNotificationTitle(plane, item.title), metadata: { ...item.metadata, plane } };
  });
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
