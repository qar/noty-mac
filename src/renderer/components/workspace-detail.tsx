import {
  Copy,
  FolderOpen,
  LayoutGrid,
  Pencil,
  Terminal,
  Trash2,
} from 'lucide-react';
import type { AgentStatus, WorkspaceWithStatus } from '../../main/types';
import {
  effectiveKind,
  formatDate,
  formatRelativeTime,
  STATE_LABELS,
} from '../workspace-ui';

interface WorkspaceDetailProps {
  workspace: WorkspaceWithStatus | null;
  emptyMessage?: string;
  onJump(workspace: WorkspaceWithStatus): void;
  onOpenFinder(workspace: WorkspaceWithStatus): void;
  onRename(workspace: WorkspaceWithStatus): void;
  onCopySession(workspace: WorkspaceWithStatus): void;
  onDelete(workspace: WorkspaceWithStatus): void;
}

export function WorkspaceDetail({
  workspace,
  emptyMessage,
  onJump,
  onOpenFinder,
  onRename,
  onCopySession,
  onDelete,
}: WorkspaceDetailProps) {
  if (!workspace) {
    return (
      <main className="workspace-detail-panel" aria-live="polite">
        <div className="detail-empty">
          <p className="empty-state-message">
            {emptyMessage ?? '选择工作区查看详情。'}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="workspace-detail-panel" aria-live="polite">
      <div className="detail-inner">
        <header className="detail-header">
          <h1 className="detail-title">{workspace.name}</h1>
          <div className="detail-subtitle">
            {workspace.tmuxSessionName
              ? `tmux · ${workspace.tmuxSessionName}`
              : '未关联 tmux'}
          </div>
          {workspace.agentStatus && effectiveKind(workspace.agentStatus) ? (
            <AgentStatusRow status={workspace.agentStatus} />
          ) : null}
        </header>

        <section className="detail-section">
          <div className="detail-section-title">工作区目录</div>
          <div className="detail-path-row">
            <code className="detail-path" title={workspace.directory}>
              {workspace.directory}
            </code>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onOpenFinder(workspace)}
            >
              <FolderOpen aria-hidden="true" />
              在 Finder 中打开
            </button>
          </div>
        </section>

        <section className="detail-section">
          <div className="detail-section-title">元信息</div>
          <div className="detail-fields">
            <DetailField label="创建时间" value={formatDate(workspace.createdAt)} />
            <DetailField
              label="最后活跃时间"
              value={
                workspace.lastActiveAt
                  ? formatRelativeTime(workspace.lastActiveAt)
                  : '未使用'
              }
            />
            <DetailField
              label="上次更新"
              value={formatRelativeTime(workspace.updatedAt)}
            />
            <DetailField
              label="来源"
              value={workspace.source === 'tmux-sync' ? 'tmux 同步' : '手动创建'}
            />
          </div>
        </section>

        <div className="detail-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!workspace.tmuxSessionName}
            title={workspace.tmuxSessionName ? undefined : '该工作区未关联 tmux session'}
            onClick={() => onJump(workspace)}
          >
            <Terminal aria-hidden="true" />
            跳转到 tmux
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onRename(workspace)}
          >
            <Pencil aria-hidden="true" />
            重命名
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!workspace.tmuxSessionName}
            onClick={() => onCopySession(workspace)}
          >
            <Copy aria-hidden="true" />
            复制 session 名
          </button>
          <div className="detail-actions-spacer" />
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => onDelete(workspace)}
          >
            <Trash2 aria-hidden="true" />
            删除工作区…
          </button>
        </div>
      </div>
    </main>
  );
}

interface EmptyWorkspaceStateProps {
  state: 'loading' | 'empty' | 'error';
  syncing: boolean;
  onSync(): void;
}

export function EmptyWorkspaceState({
  state,
  syncing,
  onSync,
}: EmptyWorkspaceStateProps) {
  const message =
    state === 'loading'
      ? '正在载入工作区…'
      : state === 'error'
        ? '初始化失败：主进程 API 未就绪。'
        : '还没有工作区。';

  return (
    <main className="empty-state-full" aria-live="polite">
      <LayoutGrid className="empty-state-icon" aria-hidden="true" />
      <p className="empty-state-message">{message}</p>
      {state === 'empty' ? (
        <button
          type="button"
          className="btn btn-primary"
          disabled={syncing}
          onClick={onSync}
        >
          同步 tmux 到工作区
        </button>
      ) : null}
    </main>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-field">
      <div className="detail-field-label">{label}</div>
      <div className="detail-field-value">{value}</div>
    </div>
  );
}

function AgentStatusRow({ status }: { status: AgentStatus }) {
  const kind = effectiveKind(status);
  return (
    <div className={`detail-agent-status${kind ? ` is-${kind}` : ''}`}>
      {kind ? (
        <>
          <span
            className={`status-dot status-dot-${kind}`}
            aria-hidden="true"
          />
          <span className="detail-agent-status-label">{STATE_LABELS[kind]}</span>
        </>
      ) : null}
      {status.message ? (
        <span className="detail-agent-status-message">{status.message}</span>
      ) : null}
      <span className="detail-agent-status-time">
        {formatRelativeTime(status.updatedAt)}上报
      </span>
    </div>
  );
}
