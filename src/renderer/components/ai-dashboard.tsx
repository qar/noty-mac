import { LayoutDashboard, Terminal } from 'lucide-react';
import type { ActiveAiPane } from '../../main/types';
import { effectiveKind, formatRelativeTime, STATE_LABELS } from '../workspace-ui';

interface AiDashboardProps {
  panes: ActiveAiPane[];
  loadState: 'loading' | 'ready' | 'error';
  changedPaneIds: ReadonlySet<string>;
  onJump(pane: ActiveAiPane): void;
}

export function AiDashboard({ panes, loadState, changedPaneIds, onJump }: AiDashboardProps) {
  return (
    <main className="ai-dashboard">
      <div className="ai-dashboard-inner">
        <header className="ai-dashboard-header">
          <h1>活跃 AI Pane</h1>
          <span>{loadState === 'ready' ? `${panes.length} 个` : ''}</span>
        </header>
        {loadState !== 'ready' || panes.length === 0 ? (
          <div className="ai-dashboard-empty" role="status">
            <LayoutDashboard aria-hidden="true" />
            <span>{loadState === 'loading' ? '正在载入…' : loadState === 'error' ? '无法读取 AI Pane' : '暂无活跃 AI Pane'}</span>
          </div>
        ) : (
          <ul className="ai-pane-list">
            {panes.map((item) => {
              const kind = effectiveKind(item.status) ?? 'stale';
              const changed = changedPaneIds.has(item.pane.id);
              return (
                <li key={item.pane.id}>
                  <button
                    type="button"
                    className="ai-pane-row"
                    onClick={() => onJump(item)}
                    aria-label={`${item.workspaceName}，${item.pane.windowName} pane ${item.pane.paneIndex}，${STATE_LABELS[kind]}${changed ? '，状态已更新' : ''}`}
                  >
                    <span className={`ai-pane-indicator status-dot-${kind}${changed ? ' is-updated' : ''}`} aria-hidden="true" />
                    <span className="ai-pane-main">
                      <span className="ai-pane-title">{item.workspaceName}</span>
                      <span className="ai-pane-location">{item.pane.sessionName} · {item.pane.windowName} · pane {item.pane.paneIndex}</span>
                      {item.status.message ? <span className="ai-pane-message">{item.status.message}</span> : null}
                    </span>
                    <span className="ai-pane-status">
                      <span>{STATE_LABELS[kind]}</span>
                      <small>{formatRelativeTime(item.status.updatedAt)}</small>
                    </span>
                    <Terminal className="ai-pane-jump" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
