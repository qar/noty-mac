import { AboutSettings } from './about-settings';
import { ChannelSettings } from './channel-settings';
import { GeneralSettings } from './general-settings';
import { IntegrationSettings } from './integration-settings';
import { SETTINGS_TABS, type SettingsTab } from './settings-navigation';

export function SettingsView({ activeTab }: { activeTab: SettingsTab }) {
  const title = SETTINGS_TABS.find((tab) => tab.id === activeTab)?.label ?? '设置';

  return (
    <main className="settings-view-panel" aria-labelledby="settingsTitle">
      <div className="settings-view-inner">
        <header className="settings-page-header">
          <h1 className="settings-page-title" id="settingsTitle">
            {title}
          </h1>
        </header>

        <div
          className="settings-tab-content"
          aria-live="polite"
        >
          {activeTab === 'general' ? <GeneralSettings /> : null}
          {activeTab === 'channels' ? <ChannelSettings /> : null}
          {activeTab === 'integration' ? <IntegrationSettings /> : null}
          {activeTab === 'about' ? <AboutSettings /> : null}
        </div>
      </div>
    </main>
  );
}
