import { Download, RefreshCw, RotateCw } from 'lucide-react';
import { useEffect, useState } from 'react';

type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'error';

const UPDATE_ERRORS: Record<string, string> = {
  repository_not_configured: '未配置 GitHub 仓库',
  no_releases: '暂无发布版本',
  rate_limited: 'GitHub API 限流，请稍后重试',
  no_asar_asset: '发布中未包含 app.asar',
  network_error: '网络连接失败',
  no_download_url: '缺少更新下载地址',
  no_staged_update: '未找到已下载的更新',
  read_only_volume: '安装位置不可写，请将 Noty 移到 /Applications',
};

export function AboutSettings() {
  const [version, setVersion] = useState<string | null>(null);
  const [phase, setPhase] = useState<UpdatePhase>('idle');
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let active = true;
    window.api
      .getAppVersion()
      .then((next) => {
        if (active) setVersion(next);
      })
      .catch((error) => console.error('[settings] getAppVersion failed:', error));

    const unsubscribe = window.api.onUpdateDownloadProgress((next) => {
      setProgress(Math.max(0, Math.min(100, next)));
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const checkForUpdate = async (): Promise<void> => {
    setPhase('checking');
    setMessage('正在检查更新');
    try {
      const result = await window.api.checkForUpdate();
      if (result.error) {
        setPhase('error');
        setMessage(errorMessage(result.error));
      } else if (result.updateAvailable) {
        setPhase('available');
        setMessage(`发现新版本 v${result.latestVersion ?? ''}`);
      } else {
        setPhase('current');
        setMessage('已是最新版本');
      }
    } catch (error) {
      console.error('[settings] checkForUpdate failed:', error);
      setPhase('error');
      setMessage('检查更新失败');
    }
  };

  const downloadUpdate = async (): Promise<void> => {
    setPhase('downloading');
    setProgress(0);
    setMessage('正在下载更新');
    try {
      const result = await window.api.downloadUpdate();
      if (result.success) {
        setProgress(100);
        setPhase('ready');
        setMessage('下载完成，可以安装');
      } else {
        setPhase('error');
        setMessage(errorMessage(result.error));
      }
    } catch (error) {
      console.error('[settings] downloadUpdate failed:', error);
      setPhase('error');
      setMessage('下载更新失败');
    }
  };

  const applyUpdate = async (): Promise<void> => {
    setPhase('installing');
    setMessage('正在安装，即将重启');
    try {
      const result = await window.api.applyUpdate();
      if (!result?.success) {
        setPhase('error');
        setMessage(errorMessage(result?.error));
      }
    } catch (error) {
      console.error('[settings] applyUpdate failed:', error);
      setPhase('error');
      setMessage('安装失败，请重试');
    }
  };

  const busy = phase === 'checking' || phase === 'downloading' || phase === 'installing';

  return (
    <div className="settings-sections">
      <section className="settings-section" aria-labelledby="aboutTitle">
        <div className="settings-section-heading">
          <h2 id="aboutTitle">关于 Noty</h2>
        </div>
        <div className="settings-list">
          <div className="settings-row">
            <span>当前版本</span>
            <span className="settings-row-value">{version ? `v${version}` : '--'}</span>
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="updatesTitle">
        <div className="settings-section-heading">
          <h2 id="updatesTitle">软件更新</h2>
        </div>
        <div className="settings-update-area">
          {message ? (
            <div
              className={`settings-update-status${phase === 'error' ? ' is-error' : ''}${
                phase === 'current' || phase === 'available' || phase === 'ready'
                  ? ' is-success'
                  : ''
              }`}
              role="status"
            >
              {message}
            </div>
          ) : null}

          {phase === 'downloading' ? (
            <div className="settings-progress">
              <div className="settings-progress-track">
                <div
                  className="settings-progress-value"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span>{Math.round(progress)}%</span>
            </div>
          ) : null}

          <div className="settings-update-actions">
            {phase === 'available' ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void downloadUpdate()}
              >
                <Download aria-hidden="true" />
                下载更新
              </button>
            ) : phase === 'ready' ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void applyUpdate()}
              >
                <RotateCw aria-hidden="true" />
                安装并重启
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void checkForUpdate()}
              >
                <RefreshCw
                  className={phase === 'checking' ? 'is-spinning' : ''}
                  aria-hidden="true"
                />
                {phase === 'checking' ? '正在检查' : '检查更新'}
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function errorMessage(error?: string): string {
  if (!error) return '操作失败，请重试';
  return UPDATE_ERRORS[error] ?? `操作失败：${error}`;
}
