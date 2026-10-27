import { Bell, LayoutDashboard, LayoutGrid, Settings, Workflow } from 'lucide-react';

interface DashboardRailProps {
  activeView: 'dashboard' | 'notifications';
  onDashboard(): void;
  onNotifications(): void;
  onWorkspaces(): void;
  onWorkflows(): void;
  onSettings(): void;
}

export function DashboardRail({ activeView, onDashboard, onNotifications, onWorkspaces, onWorkflows, onSettings }: DashboardRailProps) {
  return (
    <nav className="dashboard-rail" aria-label="主导航">
      <div className="dashboard-rail-main">
        <button type="button" className={`dashboard-rail-button${activeView === 'dashboard' ? ' is-active' : ''}`} title="总览" aria-label="总览" aria-current={activeView === 'dashboard' ? 'page' : undefined} onClick={onDashboard}>
          <LayoutDashboard aria-hidden="true" />
        </button>
        <button type="button" className={`dashboard-rail-button${activeView === 'notifications' ? ' is-active' : ''}`} title="提醒" aria-label="提醒" aria-current={activeView === 'notifications' ? 'page' : undefined} onClick={onNotifications}>
          <Bell aria-hidden="true" />
        </button>
        <button type="button" className="dashboard-rail-button" title="工作区" aria-label="工作区" onClick={onWorkspaces}>
          <LayoutGrid aria-hidden="true" />
        </button>
      </div>
      <div className="dashboard-rail-bottom">
        <button type="button" className="dashboard-rail-button" title="工作流" aria-label="工作流" onClick={onWorkflows}>
          <Workflow aria-hidden="true" />
        </button>
        <button type="button" className="dashboard-rail-button" title="设置" aria-label="设置" onClick={onSettings}>
          <Settings aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
