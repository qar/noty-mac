import { ArrowLeft } from 'lucide-react';
import { SETTINGS_TABS, type SettingsTab } from './settings-navigation';

interface SettingsSidebarProps {
  activeTab: SettingsTab;
  onSelect(tab: SettingsTab): void;
  onBack(): void;
}

export function SettingsSidebar({
  activeTab,
  onSelect,
  onBack,
}: SettingsSidebarProps) {
  return (
    <aside className="settings-sidebar-panel" aria-labelledby="settingsSidebarTitle">
      <header className="settings-sidebar-header">
        <div className="settings-sidebar-title" id="settingsSidebarTitle">
          设置
        </div>
      </header>

      <nav className="settings-sidebar-nav" aria-label="设置分类">
        {SETTINGS_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`settings-sidebar-item${activeTab === id ? ' is-active' : ''}`}
            aria-current={activeTab === id ? 'page' : undefined}
            onClick={() => onSelect(id)}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <footer className="settings-sidebar-footer">
        <button type="button" className="settings-back-button" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
          <span>返回工作区</span>
        </button>
      </footer>
    </aside>
  );
}
