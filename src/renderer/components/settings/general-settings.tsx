import { EyeOff, FolderOpen, LoaderCircle, Save, Volume2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { AppPreferences } from '../../renderer-api';

type PreferenceKey = 'soundEnabled' | 'hideRead' | 'worktreesDirectory';
type TogglePreferenceKey = Exclude<PreferenceKey, 'worktreesDirectory'>;

export function GeneralSettings() {
  const [preferences, setPreferences] = useState<AppPreferences | null>(null);
  const [directoryDraft, setDirectoryDraft] = useState('');
  const [saving, setSaving] = useState<PreferenceKey | null>(null);
  const [selectingDirectory, setSelectingDirectory] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [directoryFeedback, setDirectoryFeedback] = useState<{
    message: string;
    tone: 'success' | 'error';
  } | null>(null);

  useEffect(() => {
    let active = true;
    window.api
      .getSettings()
      .then((next) => {
        if (active) {
          setPreferences(next);
          setDirectoryDraft(next.worktreesDirectory);
        }
      })
      .catch((loadError) => {
        console.error('[settings] getSettings failed:', loadError);
        if (active) setLoadError('无法载入偏好设置');
      });
    return () => {
      active = false;
    };
  }, []);

  const togglePreference = async (key: TogglePreferenceKey): Promise<void> => {
    if (!preferences || saving) return;
    const previous = preferences;
    const next = { ...preferences, [key]: !preferences[key] };
    setPreferences(next);
    setSaving(key);
    setPreferenceError(null);
    try {
      const saved = await window.api.updateSettings(next);
      setPreferences(saved);
    } catch (saveError) {
      console.error('[settings] saveWorktreesDirectory failed:', saveError);
      setPreferences(previous);
      setPreferenceError('保存失败，请重试');
    } finally {
      setSaving(null);
    }
  };

  const selectDirectory = async (): Promise<void> => {
    if (!preferences || saving || selectingDirectory) return;
    setSelectingDirectory(true);
    setDirectoryFeedback(null);
    try {
      const selected = await window.api.selectWorktreesDirectory(directoryDraft);
      if (selected) setDirectoryDraft(selected);
    } catch (selectError) {
      console.error('[settings] selectWorktreesDirectory failed:', selectError);
      setDirectoryFeedback({ message: '无法打开目录选择器', tone: 'error' });
    } finally {
      setSelectingDirectory(false);
    }
  };

  const saveDirectory = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!preferences || saving || selectingDirectory) return;
    setSaving('worktreesDirectory');
    setDirectoryFeedback(null);
    try {
      const savedDirectory = await window.api.saveWorktreesDirectory(directoryDraft);
      setPreferences({ ...preferences, worktreesDirectory: savedDirectory });
      setDirectoryDraft(savedDirectory);
      setDirectoryFeedback({ message: '目录已保存', tone: 'success' });
    } catch (saveError) {
      console.error('[settings] updateSettings failed:', saveError);
      setDirectoryFeedback({
        message: errorMessage(saveError, '保存失败，请检查目录'),
        tone: 'error',
      });
    } finally {
      setSaving(null);
    }
  };

  if (!preferences && !loadError) {
    return <SettingsLoading label="正在载入偏好设置" />;
  }

  return (
    <div className="settings-sections">
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

        {preferenceError ? (
          <p className="settings-feedback is-error">{preferenceError}</p>
        ) : null}
      </section>

      <section className="settings-section" aria-labelledby="worktreesTitle">
        <div className="settings-section-heading">
          <h2 id="worktreesTitle">代码仓库</h2>
        </div>

        {preferences ? (
          <form
            className="worktrees-directory-form"
            onSubmit={(event) => void saveDirectory(event)}
          >
            <div className="settings-form-field">
              <label htmlFor="worktreesDirectory">Worktrees 目录</label>
              <div className="worktrees-directory-control">
                <input
                  id="worktreesDirectory"
                  type="text"
                  value={directoryDraft}
                  disabled={Boolean(saving)}
                  spellCheck={false}
                  autoComplete="off"
                  aria-describedby={directoryFeedback ? 'worktreesDirectoryFeedback' : undefined}
                  onChange={(event) => {
                    setDirectoryDraft(event.target.value);
                    setDirectoryFeedback(null);
                  }}
                />
                <button
                  type="button"
                  className="settings-icon-button worktrees-directory-picker"
                  title="选择目录"
                  aria-label="选择 Worktrees 目录"
                  disabled={Boolean(saving) || selectingDirectory}
                  onClick={() => void selectDirectory()}
                >
                  {selectingDirectory ? (
                    <LoaderCircle className="is-spinning" aria-hidden="true" />
                  ) : (
                    <FolderOpen aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>
            <div className="worktrees-directory-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={
                  Boolean(saving) ||
                  selectingDirectory ||
                  directoryDraft.trim().length === 0 ||
                  directoryDraft === preferences.worktreesDirectory
                }
              >
                {saving === 'worktreesDirectory' ? (
                  <LoaderCircle className="is-spinning" aria-hidden="true" />
                ) : (
                  <Save aria-hidden="true" />
                )}
                保存
              </button>
            </div>
          </form>
        ) : null}

        {directoryFeedback ? (
          <p
            className={`settings-feedback is-${directoryFeedback.tone}`}
            id="worktreesDirectoryFeedback"
            role={directoryFeedback.tone === 'error' ? 'alert' : 'status'}
          >
            {directoryFeedback.message}
          </p>
        ) : null}
      </section>

      {loadError ? <p className="settings-feedback is-error">{loadError}</p> : null}
    </div>
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

function errorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message) return fallback;
  const detail = error.message.split(': ').at(-1)?.trim();
  return detail && detail.length <= 160 ? detail : fallback;
}
