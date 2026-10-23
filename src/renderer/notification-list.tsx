import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, BellPlus, Clock3, ExternalLink, Folder, GitBranch, Inbox, PanelRightOpen, Pin, PinOff, RotateCcw, Settings, Terminal, UserRound } from 'lucide-react';
import type { AppNotification, Channel } from '../main/notification-types';
import { isPendingNotification, planeCommentPreview, tmuxSourceProject } from '../main/notification-core';
import { groupNotifications, notificationGroupKey } from '../main/notification-groups';
import './renderer-api';

type View = 'active' | 'history';

export function NotificationList({ desktop = false }: { desktop?: boolean }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [view, setView] = useState<View>('active');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<{ id: string | null; version: number }>({ id: null, version: 0 });
  const [pinned, setPinned] = useState(false);
  const [dismissAll, setDismissAll] = useState<{ ids: string[]; groupCount: number } | null>(null);
  const [, setClock] = useState(0);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    try {
      const [items, sources] = await Promise.all([
        window.api.getNotifications(), window.api.getChannels(),
      ]);
      if (currentRequest !== requestId.current) return;
      setNotifications(items);
      setChannels(sources);
      return items;
    } catch {
      if (currentRequest === requestId.current) setError('无法载入通知，请重试');
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
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
    if (desktop) void refresh();
    else window.api.getSelectedNotification().then(select).catch(() => void refresh());
    const clock = window.setInterval(() => setClock(value => value + 1), 30000);
    if (desktop) window.api.desktop.getPinned().then(value => { if (active) setPinned(value); }).catch(() => {});
    return () => { active = false; requestId.current++; window.clearInterval(clock); off.forEach(unsubscribe => unsubscribe()); };
  }, [refresh, desktop]);

  useEffect(() => {
    if (!selection.id) return;
    const item = document.getElementById(`notification-${selection.id}`);
    const history = item?.closest('details');
    if (history) history.open = true;
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

  const open = (item: AppNotification, group: AppNotification[]) => {
    void perform(item.id, async () => {
      const result = await window.api.jumpToNotificationTarget(item.id, { notificationIds: group.map(entry => entry.id) });
      if (!result.success) {
        if (result.reason === 'source_project_mismatch') throw new Error('这条提醒记录的 pane 属于其他项目，无法确定原始来源');
        if (result.reason === 'source_project_unverified') throw new Error('无法确认这条提醒的来源项目，请检查目标 pane');
        if (result.reason === 'no_target') throw new Error('这条提醒未记录 tmux 位置，现有信息不足以恢复跳转目标');
        if (result.reason === 'source_ambiguous') throw new Error('同项目、同分支有多个 AI 窗格，无法确定这条提醒的来源');
        if (result.reason === 'source_unavailable') throw new Error('找不到与这条提醒匹配的 AI 窗格，原会话可能已关闭');
        throw new Error(item.type === 'plane' ? result.reason : '无法跳转到 tmux，请确认会话仍在运行');
      }
    });
  };

  const pending = notifications.filter(isPendingNotification);
  const pendingGroups = groupNotifications(pending);
  const visible = notifications.filter(item => isPendingNotification(item) === (view === 'active'));
  const groups = view === 'active' ? pendingGroups : groupNotifications(visible);

  const renderItem = (item: AppNotification, group: AppNotification[], groupHead = true) => {
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
    const grouped = groupHead && group.length > 1;
    const dismissLabel = dismissed ? (grouped ? '恢复本组提醒' : '恢复提醒') : grouped ? '收起本组提醒' : '收起提醒';
    return <article key={item.id} id={`notification-${item.id}`} data-notification-id={item.id} tabIndex={-1} className={`notification-item ${dismissed ? 'read' : ''} ${item.id === selection.id ? 'is-selected' : ''}`}>
      <div className="notification-header">
        <span className="notification-type">{plane ? 'RtiTek Plane' : 'Tmux AI agent'}{grouped ? <span className="notification-count">{group.length} 条</span> : null}</span>
        <time className="notification-time" dateTime={new Date(item.timestamp).toISOString()} title={`收到于 ${new Date(item.timestamp).toLocaleString()}`}>{formatTime(item.timestamp)}</time>
      </div>
      <div className="notification-heading">
        <button className={`notification-open${plane ? ' notification-open-plane' : ''}`} title={title} disabled={Boolean(busy)} onClick={() => open(item, group)} aria-label={plane ? `打开任务：${title}` : title}>
          {plane ? <><span className="notification-title">{title}</span>{target ? <ExternalLink size={12} aria-hidden="true" /> : null}</>
            : <span className="notification-title">{title}{target ? <ExternalLink size={12} /> : null}</span>}
        </button>
        <div className="notification-item-actions">
          <button className="icon-btn" disabled={Boolean(busy)} title={dismissLabel} aria-label={`${dismissLabel}：${title}`} onClick={() => void perform(item.id, () => window.api.setNotificationsDismissed((groupHead ? group : [item]).map(entry => entry.id), !dismissed))}>{dismissed ? <RotateCcw /> : <Archive />}</button>
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
  };

  return <div className={`notifications${desktop ? ' notifications-desktop' : ''}`}>
    <header className="header">
      <h2>提醒</h2>
      <div className="header-actions">
        {desktop
          ? <button className="icon-btn" title={pinned ? '取消置顶' : '窗口置顶'} aria-label="窗口置顶" aria-pressed={pinned} disabled={Boolean(busy)} onClick={() => void perform('pin', async () => setPinned(await window.api.desktop.setPinned(!pinned)))}>{pinned ? <PinOff /> : <Pin />}</button>
          : <button className="icon-btn" title="在主窗口查看" aria-label="在主窗口查看" onClick={() => window.api.openNotifications()}><PanelRightOpen /></button>}
        {view === 'active' ? <button className="icon-btn" title="收起全部提醒" aria-label="收起全部提醒" disabled={Boolean(busy) || !pending.length} onClick={() => setDismissAll({ ids: pending.map(item => item.id), groupCount: pendingGroups.length })}><Archive /></button> : null}
        <button className="icon-btn" title="新建通知" aria-label="新建通知" onClick={() => window.api.openNotificationSettings()}><BellPlus /></button>
        <button className="icon-btn" title="设置" aria-label="设置" onClick={() => window.api.openSettings()}><Settings /></button>
      </div>
    </header>
    <nav className="notification-tabs" aria-label="提醒视图">
      {([
        ['active', `提醒 ${pendingGroups.length}`], ['history', '历史'],
      ] as const).map(([key, label]) => <button key={key} aria-pressed={view === key} onClick={() => { setView(key); setError(''); }}>{label}</button>)}
    </nav>
    {error ? <div className="notification-error" role="alert">{error}<button className="icon-btn" title="重试载入" aria-label="重试载入" onClick={() => { setError(''); void refresh(); }}><RotateCcw /></button></div> : null}
    <main className="notification-list" aria-label="提醒列表">
      {!groups.length ? <div className="empty-state"><Inbox size={28} /><p>{loading ? '正在载入提醒' : view === 'history' ? '暂无历史提醒' : '暂无新提醒'}</p></div> : null}
      {groups.map(group => <section className="notification-group" key={notificationGroupKey(group[0])}>
        {renderItem(group[0], group)}
        {group.length > 1 ? <details className="notification-group-history">
          <summary>较早消息（{group.length - 1}）</summary>
          {group.slice(1).map(item => renderItem(item, group, false))}
        </details> : null}
      </section>)}
    </main>
    {dismissAll ? <DismissAllDialog count={dismissAll.ids.length} groupCount={dismissAll.groupCount} onCancel={() => setDismissAll(null)} onConfirm={() => {
      const ids = dismissAll.ids;
      setDismissAll(null);
      void perform('all', () => window.api.setNotificationsDismissed(ids, true));
    }} /> : null}
  </div>;
}

function DismissAllDialog({ count, groupCount, onCancel, onConfirm }: { count: number; groupCount: number; onCancel(): void; onConfirm(): void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  return <dialog ref={dialogRef} className="notification-confirm" aria-labelledby="dismiss-all-title" aria-describedby="dismiss-all-description" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <h2 id="dismiss-all-title">收起全部提醒？</h2>
    <p id="dismiss-all-description">将把这 {groupCount} 组中的 {count} 条消息标记为已读并移至历史。</p>
    <div className="notification-confirm-actions">
      <button type="button" autoFocus onClick={onCancel}>取消</button>
      <button type="button" className="notification-confirm-submit" onClick={onConfirm}><Archive size={14} aria-hidden="true" />确认收起</button>
    </div>
  </dialog>;
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
        || (item.metadata?.tmux?.sourceProject && tmuxSourceProject(line) === item.metadata.tmux.sourceProject)
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

