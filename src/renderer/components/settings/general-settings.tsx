import { LoaderCircle, Volume2, EyeOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AppPreferences } from '../../renderer-api';

type PreferenceKey = keyof AppPreferences;

export function GeneralSettings() {
  const [preferences, setPreferences] = useState<AppPreferences | null>(null);
  const [saving, setSaving] = useState<PreferenceKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    window.api
      .getSettings()
      .then((next) => {
        if (active) setPreferences(next);
      })
      .catch((loadError) => {
        console.error('[settings] getSettings failed:', loadError);
        if (active) setError('无法载入偏好设置');
      });
    return () => {
      active = false;
    };
  }, []);

  const togglePreference = async (key: PreferenceKey): Promise<void> => {
    if (!preferences || saving) return;
    const previous = preferences;
    const next = { ...preferences, [key]: !preferences[key] };
    setPreferences(next);
    setSaving(key);
    setError(null);
    try {
      const saved = await window.api.updateSettings(next);
      setPreferences(saved);
    } catch (saveError) {
      console.error('[settings] updateSettings failed:', saveError);
      setPreferences(previous);
      setError('保存失败，请重试');
    } finally {
      setSaving(null);
    }
  };

  if (!preferences && !error) {
    return <SettingsLoading label="正在载入偏好设置" />;
  }

  return (
    <section className="settings-section" aria-labelledby="preferencesTitle">
      <div className="settings-section-heading">
        <h2 id="preferencesTitle">通知偏好</h2>
      </div>

      {preferences ? (
        <div className="settings-list">
          <PreferenceRow
            icon={Volume2}
            label="声音提示"
            checked={preferences.soundEnabled}
            disabled={Boolean(saving)}
            onToggle={() => void togglePreference('soundEnabled')}
          />
          <PreferenceRow
            icon={EyeOff}
            label="隐藏已读通知"
            checked={preferences.hideRead}
            disabled={Boolean(saving)}
            onToggle={() => void togglePreference('hideRead')}
          />
        </div>
      ) : null}

      {error ? <p className="settings-feedback is-error">{error}</p> : null}
    </section>
  );
}

function PreferenceRow({
  icon: Icon,
  label,
  checked,
  disabled,
  onToggle,
}: {
  icon: typeof Volume2;
  label: string;
  checked: boolean;
  disabled: boolean;
  onToggle(): void;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-label">
        <Icon aria-hidden="true" />
        <span>{label}</span>
      </div>
      <button
        type="button"
        className={`settings-switch${checked ? ' is-on' : ''}`}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={onToggle}
      >
        <span className="settings-switch-thumb" />
      </button>
    </div>
  );
}

function SettingsLoading({ label }: { label: string }) {
  return (
    <div className="settings-loading" role="status">
      <LoaderCircle className="is-spinning" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
