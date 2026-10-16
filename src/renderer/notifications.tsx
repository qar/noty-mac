import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Archive, BellPlus, Clock3, ExternalLink, Folder, GitBranch, Inbox, RotateCcw, Settings, Terminal, UserRound } from 'lucide-react';
import type { AppNotification, Channel } from '../main/notification-types';
import { isPendingNotification, planeCommentPreview } from '../main/notification-core';
import './renderer-api';

type View = 'active' | 'history';

function groupNotifications(items: AppNotification[], selectedId: string | null): AppNotification[][] {
  const groups: AppNotification[][] = [];
  for (const item of items) {
    const previous = groups[groups.length - 1];
    const target = item.id !== selectedId && item.type !== 'plane' && item.metadata?.tmux?.target;
    if (target && previous?.[0].type !== 'plane' && previous?.[0].channelId === item.channelId
      && previous?.[0].id !== selectedId
      && previous?.[0].metadata?.project?.name === item.metadata?.project?.name
      && previous?.[0].metadata?.tmux?.target === target) previous.push(item);
    else groups.push([item]);
  }
  return groups;
}

function Notifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [view, setView] = useState<View>('active');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<{ id: string | null; version: number }>({ id: null, version: 0 });

  const refresh = useCallback(async () => {
    try {
      const [items, sources] = await Promise.all([
        window.api.getNotifications(), window.api.getChannels(),
      ]);
      setNotifications(items);
      setChannels(sources);
      return items;
    } catch {
      setError('无法载入通知，请重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const select = async (id: string | null) => {
      const items = await refresh();
      if (!active || !id) return;
      const item = items?.find(entry => entry.id === id);
      if (!item) return;
      setView(isPendingNotification(item) ? 'active' : 'history');
      setSelection(previous => ({ id, version: previous.version + 1 }));
    };
    const off = [
      window.api.onNewNotification(() => void refresh()),
      window.api.onWindowShown(() => void refresh()),
      window.api.onNotificationSelected(id => void select(id)),
      window.api.onNotificationsUpdated(() => void refresh()),
    ];
    window.api.getSelectedNotification().then(select).catch(() => void refresh());
    return () => { active = false; off.forEach(unsubscribe => unsubscribe()); };
  }, [refresh]);

  useEffect(() => {
    if (!selection.id) return;
    const item = document.getElementById(`notification-${selection.id}`);
    item?.scrollIntoView({ block: 'start' });
    item?.focus({ preventScroll: true });
  }, [selection]);

  const perform = async (id: string, operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(id);
    setError('');
    try {
      await operation();
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '操作失败，请重试');
    } finally {
      setBusy(null);
    }
  };

  const open = (group: AppNotification[]) => {
    const item = group[0];
    void perform(item.id, async () => {
      const hasTarget = item.type === 'plane' || item.metadata?.tmux?.target
        || /^\s*(?:🖥\s*)?tmux\s*:/im.test(item.message);
      if (hasTarget) {
        const result = await window.api.jumpToNotificationTarget(item.id, { notificationIds: group.map(entry => entry.id) });
        if (!result.success) {
          if (result.reason === 'source_project_mismatch') throw new Error('这条提醒记录的 pane 属于其他项目，无法确定原始来源');
          if (result.reason === 'source_project_unverified') throw new Error('无法确认这条提醒的来源项目，请检查目标 pane');
          throw new Error(item.type === 'plane' ? result.reason : '无法跳转到 tmux，请确认会话仍在运行');
        }
      }
    });
  };

  const pending = notifications.filter(isPendingNotification);
  const visible = notifications.filter(item => isPendingNotification(item) === (view === 'active'));
  const groups = groupNotifications(visible, selection.id);

  return <div className="container">
    <header className="header">
      <h2>提醒</h2>
      <div className="header-actions">
        {view === 'active' ? <button className="icon-btn" title="收起全部提醒" aria-label="收起全部提醒" disabled={Boolean(busy) || !pending.length} onClick={() => void perform('all', () => window.api.setNotificationsDismissed(pending.map(item => item.id), true))}><Archive /></button> : null}
        <button className="icon-btn" title="新建通知" aria-label="新建通知" onClick={() => window.api.openNotificationSettings()}><BellPlus /></button>
        <button className="icon-btn" title="设置" aria-label="设置" onClick={() => window.api.openSettings()}><Settings /></button>
      </div>
    </header>
    <nav className="notification-tabs" aria-label="提醒视图">
      {([
        ['active', `提醒 ${pending.length}`], ['history', '历史'],
      ] as const).map(([key, label]) => <button key={key} aria-pressed={view === key} onClick={() => { setView(key); setError(''); }}>{label}</button>)}
    </nav>
    {error ? <div className="notification-error" role="alert">{error}<button className="icon-btn" title="重试载入" aria-label="重试载入" onClick={() => { setError(''); void refresh(); }}><RotateCcw /></button></div> : null}
    <main className="notification-list" aria-label="提醒列表">
      {!groups.length ? <div className="empty-state"><Inbox size={28} /><p>{loading ? '正在载入提醒' : view === 'history' ? '暂无历史提醒' : '暂无新提醒'}</p></div> : null}
      {groups.map(group => {
        const item = group[0];
        const plane = item.type === 'plane';
        const source = channels.find(channel => channel.id === item.channelId);
        const project = item.metadata?.project;
        const message = formatMessage(item);
        const comment = plane ? planeCommentPreview(item.metadata?.plane?.rawPayload ?? item.message) : null;
        const planeEvent = item.metadata?.plane;
        const isComment = plane && planeEvent?.event === 'issue_comment';
        const body = plane
          ? comment ?? item.metadata?.plane?.parseError ?? item.message
          : message.text;
        const title = plane ? item.title : item.title.replace(/\s*\([^)]*\)\s*$/, '');
        const target = plane ? item.metadata?.plane?.url : item.metadata?.tmux?.target;
        const tmuxSession = item.metadata?.tmux?.session && !item.metadata.tmux.session.startsWith('%') ? item.metadata.tmux.session : '会话不可用';
        const sourceName = source?.name || '已移除的通知来源';
        const dismissed = !isPendingNotification(item);
        const dismissLabel = dismissed ? '恢复提醒' : group.length > 1 ? '收起本组提醒' : '收起提醒';
        return <article key={item.id} id={`notification-${item.id}`} data-notification-id={item.id} tabIndex={-1} className={`notification-item ${dismissed ? 'read' : ''} ${item.id === selection.id ? 'is-selected' : ''}`}>
          <div className="notification-header">
            <span className="notification-type">{plane ? 'RtiTek Plane' : 'Tmux AI agent'}{group.length > 1 ? <span className="notification-count">×{group.length}</span> : null}</span>
            <time className="notification-time" dateTime={new Date(item.timestamp).toISOString()} title={`收到于 ${new Date(item.timestamp).toLocaleString()}`}>{formatTime(item.timestamp)}</time>
          </div>
          <div className="notification-heading">
            <button className={`notification-open${plane ? ' notification-open-plane' : ''}`} title={title} disabled={Boolean(busy)} onClick={() => open(group)} aria-label={plane ? `打开任务：${title}` : title}>
              {plane ? <><span className="notification-title">{title}</span>{target ? <ExternalLink size={12} aria-hidden="true" /> : null}</>
                : <span className="notification-title">{title}{target ? <ExternalLink size={12} /> : null}</span>}
            </button>
            <div className="notification-item-actions">
              <button className="icon-btn" disabled={Boolean(busy)} title={dismissLabel} aria-label={`${dismissLabel}：${title}`} onClick={() => void perform(item.id, () => window.api.setNotificationsDismissed(group.map(entry => entry.id), !dismissed))}>{dismissed ? <RotateCcw /> : <Archive />}</button>
            </div>
          </div>
          {isComment ? <div className="notification-comment-meta">
            <span className="notification-comment-author" title={`评论作者：${planeEvent.commentAuthor || '未知作者'}`}>
              <UserRound size={13} aria-hidden="true" /><span>{planeEvent.commentAuthor || '未知作者'}</span>
            </span>
            {planeEvent.commentCreatedAt ? <span className="notification-comment-time">
              <Clock3 size={13} aria-hidden="true" />
              <time dateTime={planeEvent.commentCreatedAt} title={`评论时间：${new Date(planeEvent.commentCreatedAt).toLocaleString()}`}>
                {new Date(planeEvent.commentCreatedAt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
              </time>
            </span> : null}
          </div> : null}
          {project || (!plane && target) ? <div className="notification-context">
            {project ? <div className="notification-context-item notification-project" role="group" aria-label={`项目：${project.name}`} title={`项目：${project.name}`}>
              <Folder size={14} aria-hidden="true" /><span>{project.name}</span>
            </div> : null}
            {project?.branch ? <div className="notification-context-item" role="group" aria-label={`Git 分支：${project.branch}`} title={`Git 分支：${project.branch}`}>
              <GitBranch size={14} aria-hidden="true" /><span>{project.branch}</span>
            </div> : null}
            {!plane && target ? <div className="notification-context-item notification-tmux-target" role="group" aria-label={`Tmux 会话：${tmuxSession}`} title={`Tmux 会话：${tmuxSession}\ntmux: ${target}`}>
              <Terminal size={14} aria-hidden="true" /><span>{tmuxSession}</span>
            </div> : null}
          </div> : null}
          {item.metadata?.plane?.attachment?.status === 'error' ? <div className="notification-error" role="status">
            {item.metadata.plane.attachment.error}
            <button className="icon-btn" title="重试读取正文" aria-label={`重试读取正文：${title}`} disabled={Boolean(busy)} onClick={() => void perform(item.id, () => window.api.retryNotificationAttachment(item.id))}><RotateCcw /></button>
          </div> : null}
          {item.metadata?.plane?.attachment?.status !== 'error' ? <pre className="notification-message">{body}</pre> : null}
          {plane ? <details className="notification-raw">
            <summary>{message.isJson ? '原始 JSON' : '原始内容'}</summary>
            <pre className="notification-message">{message.text}</pre>
          </details> : null}
          {sourceName !== title ? <div className="notification-bottom">
            <span className="notification-channel">{sourceName}</span>
          </div> : null}
          {plane && !target ? <div className="notification-warning">缺少任务链接</div> : null}
        </article>;
      })}
    </main>
  </div>;
}

function formatMessage(item: AppNotification): { text: string; isJson: boolean } {
  const raw = item.metadata?.plane?.rawPayload ?? item.message;
  try {
    return { text: JSON.stringify(JSON.parse(raw), null, 2), isJson: true };
  } catch {
    if (item.type === 'plane') return { text: raw, isJson: false };
    const project = item.metadata?.project;
    let removedContext = false;
    const text = raw.split('\n').filter(line => {
      const projectLine = line.match(/^\s*📂\s+([^\s(]+)(?:\s*\(([^)]+)\))?\s*$/);
      const contextLine = (item.metadata?.tmux?.target && /^\s*(?:🖥\s*)?tmux\s*:\s*[A-Za-z0-9_.:%@+/-]+\s*$/i.test(line))
        || (project && projectLine && projectLine[1] === project.name && (projectLine[2] || '') === (project.branch || ''));
      if (contextLine) removedContext = true;
      return !contextLine;
    }).join('\n');
    return { text: removedContext ? text.trimStart() : raw, isJson: false };
  }
}

function formatTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

createRoot(document.getElementById('root')!).render(<Notifications />);
