import { useLayoutEffect, useRef, useState } from 'react';
import { LayoutDashboard, Terminal } from 'lucide-react';
import type { ActiveAiPane } from '../../main/types';
import { effectiveKind, formatRelativeTime, STATE_LABELS } from '../workspace-ui';

interface AiDashboardProps {
  panes: ActiveAiPane[];
  loadState: 'loading' | 'ready' | 'error';
  changedPaneIds: ReadonlySet<string>;
  onJump(pane: ActiveAiPane): void;
}

const GRID_GAP = 10;

function gridLayout(count: number, width: number, height: number) {
  let best = { columns: 1, rows: count, tileWidth: width, tileHeight: 0, score: -Infinity };
  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns);
    const tileWidth = Math.max(0, (width - GRID_GAP * (columns - 1)) / columns);
    const tileHeight = Math.max(0, Math.min(180, (height - GRID_GAP * (rows - 1)) / rows));
    const score = Math.min(tileWidth / 220, tileHeight / 120)
      - Math.abs(tileWidth / Math.max(tileHeight, 1) - 2.2) * 0.02
      - (columns * rows - count) * 0.002;
    if (score > best.score) best = { columns, rows, tileWidth, tileHeight, score };
  }
  return best;
}

export function AiDashboard({ panes, loadState, changedPaneIds, onJump }: AiDashboardProps) {
  const gridAreaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = gridAreaRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setArea({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(([entry]) => {
      setArea({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const layout = gridLayout(panes.length, area.width, area.height);
  const compact = layout.tileHeight < 104 || layout.tileWidth < 205;
  const tiny = layout.tileHeight < 68 || layout.tileWidth < 130;

  return (
    <main className="ai-dashboard">
      <header className="ai-dashboard-header">
        <div className="ai-dashboard-heading">
          <span className="ai-dashboard-prefix">NOTY / 01</span>
          <h1>AI PANES</h1>
        </div>
        <span className="ai-dashboard-count">
          {loadState === 'ready' ? String(panes.length).padStart(2, '0') : '--'} ACTIVE
        </span>
      </header>
      <div className="ai-dashboard-grid-area" ref={gridAreaRef}>
        {loadState !== 'ready' || panes.length === 0 ? (
          <div className="ai-dashboard-empty" role="status">
            <LayoutDashboard aria-hidden="true" />
            <span>{loadState === 'loading' ? '正在载入…' : loadState === 'error' ? '无法读取 AI Pane' : '暂无活跃 AI Pane'}</span>
          </div>
        ) : (
          <div
            className="ai-pane-grid"
            style={{
              gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${layout.rows}, ${layout.tileHeight}px)`,
            }}
          >
            {panes.map((item) => {
              const kind = item.status ? effectiveKind(item.status) ?? 'stale' : null;
              const changed = changedPaneIds.has(item.pane.id);
              const label = kind ? STATE_LABELS[kind] : '状态未知';
              return (
                <button
                  key={item.pane.id}
                  type="button"
                  className={`ai-pane-tile${compact ? ' is-compact' : ''}${tiny ? ' is-tiny' : ''}`}
                  title={`${item.agentName} · ${item.pane.sessionName} / ${item.pane.windowName} / ${item.pane.id}${item.status ? '' : ' · AI 进程运行中，尚无状态上报'}`}
                  aria-label={`${item.agentName}，${item.workspaceName}，${item.pane.windowName} pane ${item.pane.paneIndex}，${label}${item.status ? '' : '，AI 进程运行中，尚无状态上报'}${changed ? '，状态已更新' : ''}`}
                  onClick={() => onJump(item)}
                >
                  <span className="ai-pane-tile-top">
                    <span className="ai-pane-agent">{item.agentName}</span>
                    <span className="ai-pane-id">{item.pane.id}</span>
                  </span>
                  <span className="ai-pane-title">{item.workspaceName}</span>
                  <span className="ai-pane-location">{item.pane.windowName} / {item.pane.paneIndex}</span>
                  {item.status?.message ? <span className="ai-pane-message">{item.status.message}</span> : null}
                  <span className="ai-pane-tile-bottom">
                    <span className={`ai-pane-indicator status-dot-${kind ?? 'detected'}${changed ? ' is-updated' : ''}`} aria-hidden="true" />
                    <span className="ai-pane-status-label">{label}</span>
                    {item.status ? <span className="ai-pane-time">{formatRelativeTime(item.status.updatedAt)}</span> : null}
                    <Terminal className="ai-pane-jump" aria-hidden="true" />
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
