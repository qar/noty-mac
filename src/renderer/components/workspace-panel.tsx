import { RefreshCw } from 'lucide-react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { WorkspaceWithStatus } from '../../main/types';
import {
  effectiveKind,
  formatRelativeTime,
  tooltipFor,
} from '../workspace-ui';

interface WorkspacePanelProps {
  workspaces: WorkspaceWithStatus[];
  selectedId: string | null;
  syncing: boolean;
  emptyMessage?: string;
  onSelect(id: string): void;
  onJump(workspace: WorkspaceWithStatus): void;
  onSync(): void;
  onContextMenu(
    workspace: WorkspaceWithStatus,
    point: { x: number; y: number }
  ): void;
}

export function WorkspacePanel({
  workspaces,
  selectedId,
  syncing,
  emptyMessage,
  onSelect,
  onJump,
  onSync,
  onContextMenu,
}: WorkspacePanelProps) {
  return (
    <aside className="workspace-list-panel">
      <header className="list-panel-header">
        <div className="list-panel-title">工作区</div>
        <button
          type="button"
          className="icon-btn"
          title="同步 tmux 到工作区"
          aria-label="同步 tmux 到工作区"
          aria-busy={syncing}
          disabled={syncing}
          onClick={onSync}
        >
          <RefreshCw className={syncing ? 'is-spinning' : ''} aria-hidden="true" />
        </button>
      </header>
      <ul className="workspace-list" role="listbox" aria-label="tmux 工作区">
        {workspaces.map((workspace) => (
          <WorkspaceListItem
            key={workspace.id}
            workspace={workspace}
            active={workspace.id === selectedId}
            onSelect={onSelect}
            onJump={onJump}
            onContextMenu={onContextMenu}
          />
        ))}
        {workspaces.length === 0 && emptyMessage ? (
          <li className="workspace-list-empty" role="none">
            <span role="status">{emptyMessage}</span>
          </li>
        ) : null}
      </ul>
    </aside>
  );
}

interface WorkspaceListItemProps {
  workspace: WorkspaceWithStatus;
  active: boolean;
  onSelect(id: string): void;
  onJump(workspace: WorkspaceWithStatus): void;
  onContextMenu(
    workspace: WorkspaceWithStatus,
    point: { x: number; y: number }
  ): void;
}

function WorkspaceListItem({
  workspace,
  active,
  onSelect,
  onJump,
  onContextMenu,
}: WorkspaceListItemProps) {
  const kind = effectiveKind(workspace.agentStatus);
  const hasAgentMessage = Boolean(
    workspace.agentStatus?.message && workspace.agentStatus.state !== 'idle'
  );
  const subtitle = hasAgentMessage
    ? workspace.agentStatus?.message
    : workspace.tmuxSessionName
      ? `tmux · ${workspace.tmuxSessionName}`
      : '未关联 tmux';

  const handleKeyDown = (event: KeyboardEvent<HTMLLIElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (active) onJump(workspace);
    else onSelect(workspace.id);
  };

  const handleContextMenu = (event: MouseEvent<HTMLLIElement>): void => {
    event.preventDefault();
    onSelect(workspace.id);
    onContextMenu(workspace, { x: event.clientX, y: event.clientY });
  };

  return (
    <li
      className={`workspace-list-item${active ? ' is-active' : ''}`}
      role="option"
      tabIndex={0}
      aria-selected={active}
      aria-label={`工作区 ${workspace.name}`}
      onClick={() => onSelect(workspace.id)}
      onKeyDown={handleKeyDown}
      onContextMenu={handleContextMenu}
    >
      <div className="workspace-list-item-row">
        <div className="workspace-list-item-title-wrap">
          {kind ? (
            <span
              className={`status-dot status-dot-${kind}`}
              title={workspace.agentStatus ? tooltipFor(workspace.agentStatus) : ''}
              aria-hidden="true"
            />
          ) : null}
          <div className="workspace-list-item-title">{workspace.name}</div>
        </div>
        <div className="workspace-list-item-meta">
          {formatRelativeTime(workspace.lastActiveAt ?? workspace.updatedAt)}
        </div>
      </div>
      <div
        className={`workspace-list-item-subtitle${
          hasAgentMessage ? ' is-agent-message' : ''
        }`}
      >
        {subtitle}
      </div>
    </li>
  );
}
