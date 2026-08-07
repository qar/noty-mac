import { EyeOff, FolderOpen, LoaderCircle, Save, Volume2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { AppPreferences } from '../../renderer-api';

type TogglePreferenceKey = 'soundEnabled' | 'hideRead';
type DirectoryPreferenceKey = 'projectsDirectory' | 'worktreesDirectory';
type PreferenceKey = TogglePreferenceKey | DirectoryPreferenceKey;
type DirectoryFeedback = {
  message: string;
  tone: 'success' | 'error';
};

export function GeneralSettings() {
  const [preferences, setPreferences] = useState<AppPreferences | null>(null);
  const [directoryDrafts, setDirectoryDrafts] = useState<
    Record<DirectoryPreferenceKey, string>
  >({
    projectsDirectory: '',
    worktreesDirectory: '',
  });
  const [saving, setSaving] = useState<PreferenceKey | null>(null);
  const [selectingDirectory, setSelectingDirectory] =
    useState<DirectoryPreferenceKey | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [directoryFeedback, setDirectoryFeedback] = useState<
    Partial<Record<DirectoryPreferenceKey, DirectoryFeedback>>
  >({});

  useEffect(() => {
    let active = true;
    window.api
      .getSettings()
      .then((next) => {
        if (active) {
          setPreferences(next);
          setDirectoryDrafts({
            projectsDirectory: next.projectsDirectory,
            worktreesDirectory: next.worktreesDirectory,
          });
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
    if (!preferences || saving || selectingDirectory) return;
    const previous = preferences;
    const next = { ...preferences, [key]: !preferences[key] };
    setPreferences(next);
    setSaving(key);
    setPreferenceError(null);
    try {
      const saved = await window.api.updateSettings(next);
      setPreferences(saved);
    } catch (saveError) {
      console.error('[settings] updateSettings failed:', saveError);
      setPreferences(previous);
      setPreferenceError('保存失败，请重试');
    } finally {
      setSaving(null);
    }
  };

  const updateDirectoryDraft = (
    key: DirectoryPreferenceKey,
    value: string
  ): void => {
    setDirectoryDrafts((current) => ({ ...current, [key]: value }));
    setDirectoryFeedback((current) => ({ ...current, [key]: undefined }));
  };

  const selectDirectory = async (key: DirectoryPreferenceKey): Promise<void> => {
    if (!preferences || saving || selectingDirectory) return;
    setSelectingDirectory(key);
    setDirectoryFeedback((current) => ({ ...current, [key]: undefined }));
    try {
      const selected = key === 'projectsDirectory'
        ? await window.api.selectProjectsDirectory(directoryDrafts[key])
        : await window.api.selectWorktreesDirectory(directoryDrafts[key]);
      if (selected) updateDirectoryDraft(key, selected);
    } catch (selectError) {
      console.error(`[settings] select ${key} failed:`, selectError);
      setDirectoryFeedback((current) => ({
        ...current,
        [key]: { message: '无法打开目录选择器', tone: 'error' },
      }));
    } finally {
      setSelectingDirectory(null);
    }
  };

  const saveDirectory = async (
    event: FormEvent,
    key: DirectoryPreferenceKey
  ): Promise<void> => {
    event.preventDefault();
    if (!preferences || saving || selectingDirectory) return;
    setSaving(key);
    setDirectoryFeedback((current) => ({ ...current, [key]: undefined }));
    try {
      const savedDirectory = key === 'projectsDirectory'
        ? await window.api.saveProjectsDirectory(directoryDrafts[key])
        : await window.api.saveWorktreesDirectory(directoryDrafts[key]);
      setPreferences((current) =>
        current ? { ...current, [key]: savedDirectory } : current
      );
      setDirectoryDrafts((current) => ({
        ...current,
        [key]: savedDirectory,
      }));
      setDirectoryFeedback((current) => ({
        ...current,
        [key]: { message: '目录已保存', tone: 'success' },
      }));
    } catch (saveError) {
      console.error(`[settings] save ${key} failed:`, saveError);
      setDirectoryFeedback((current) => ({
        ...current,
        [key]: {
          message: errorMessage(saveError, '保存失败，请检查目录'),
          tone: 'error',
        },
      }));
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
              disabled={Boolean(saving) || Boolean(selectingDirectory)}
              onToggle={() => void togglePreference('soundEnabled')}
            />
            <PreferenceRow
              icon={EyeOff}
              label="隐藏已读通知"
              checked={preferences.hideRead}
              disabled={Boolean(saving) || Boolean(selectingDirectory)}
              onToggle={() => void togglePreference('hideRead')}
            />
          </div>
        ) : null}

        {preferenceError ? (
          <p className="settings-feedback is-error">{preferenceError}</p>
        ) : null}
      </section>

      <section className="settings-section" aria-labelledby="repositoriesTitle">
        <div className="settings-section-heading">
          <h2 id="repositoriesTitle">代码仓库</h2>
        </div>

        {preferences ? (
          <div className="settings-directory-list">
            <DirectorySetting
              id="projectsDirectory"
              label="项目目录"
              value={directoryDrafts.projectsDirectory}
              savedValue={preferences.projectsDirectory}
              feedback={directoryFeedback.projectsDirectory}
              disabled={Boolean(saving) || Boolean(selectingDirectory)}
              selecting={selectingDirectory === 'projectsDirectory'}
              saving={saving === 'projectsDirectory'}
              onChange={(value) => updateDirectoryDraft('projectsDirectory', value)}
              onSelect={() => void selectDirectory('projectsDirectory')}
              onSubmit={(event) => void saveDirectory(event, 'projectsDirectory')}
            />
            <DirectorySetting
              id="worktreesDirectory"
              label="Worktrees 目录"
              value={directoryDrafts.worktreesDirectory}
              savedValue={preferences.worktreesDirectory}
              feedback={directoryFeedback.worktreesDirectory}
              disabled={Boolean(saving) || Boolean(selectingDirectory)}
              selecting={selectingDirectory === 'worktreesDirectory'}
              saving={saving === 'worktreesDirectory'}
              onChange={(value) => updateDirectoryDraft('worktreesDirectory', value)}
              onSelect={() => void selectDirectory('worktreesDirectory')}
              onSubmit={(event) => void saveDirectory(event, 'worktreesDirectory')}
            />
          </div>
        ) : null}
      </section>

      {loadError ? <p className="settings-feedback is-error">{loadError}</p> : null}
    </div>
  );
}

function DirectorySetting({
  id,
  label,
  value,
  savedValue,
  feedback,
  disabled,
  selecting,
  saving,
  onChange,
  onSelect,
  onSubmit,
}: {
  id: DirectoryPreferenceKey;
  label: string;
  value: string;
  savedValue: string;
  feedback?: DirectoryFeedback;
  disabled: boolean;
  selecting: boolean;
  saving: boolean;
  onChange(value: string): void;
  onSelect(): void;
  onSubmit(event: FormEvent): void;
}) {
  const feedbackId = `${id}Feedback`;
  return (
    <div className="settings-directory-setting">
      <form className="settings-directory-form" onSubmit={onSubmit}>
        <div className="settings-form-field">
          <label htmlFor={id}>{label}</label>
          <div className="settings-directory-control">
            <input
              id={id}
              type="text"
              value={value}
              disabled={disabled}
              spellCheck={false}
              autoComplete="off"
              aria-describedby={feedback ? feedbackId : undefined}
              onChange={(event) => onChange(event.target.value)}
            />
            <button
              type="button"
              className="settings-icon-button settings-directory-picker"
              title="选择目录"
              aria-label={`选择${label}`}
              disabled={disabled || selecting}
              onClick={onSelect}
            >
              {selecting ? (
                <LoaderCircle className="is-spinning" aria-hidden="true" />
              ) : (
                <FolderOpen aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
        <div className="settings-directory-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={
              disabled ||
              selecting ||
              value.trim().length === 0 ||
              value === savedValue
            }
          >
            {saving ? (
              <LoaderCircle className="is-spinning" aria-hidden="true" />
            ) : (
              <Save aria-hidden="true" />
            )}
            保存
          </button>
        </div>
      </form>
      {feedback ? (
        <p
          className={`settings-feedback is-${feedback.tone}`}
          id={feedbackId}
          role={feedback.tone === 'error' ? 'alert' : 'status'}
        >
          {feedback.message}
        </p>
      ) : null}
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
