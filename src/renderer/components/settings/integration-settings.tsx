import {
  Check,
  Copy,
  ExternalLink,
  FolderOpen,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { IntegrationSnapshot } from '../../renderer-api';

type CopyTarget = 'install' | 'snippet';

export function IntegrationSettings() {
  const [snapshot, setSnapshot] = useState<IntegrationSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<CopyTarget | null>(null);
  const copyTimer = useRef<number | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await window.api.integration.detect());
    } catch (detectError) {
      console.error('[settings] integration.detect failed:', detectError);
      setError('无法检测 AI 集成状态');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handleFocus = () => void refresh();
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    };
  }, [refresh]);

  const copyText = async (target: CopyTarget, text: string): Promise<void> => {
    if (!text) return;
    try {
      const ok = await window.api.integration.copy(text);
      if (!ok) throw new Error('clipboard unavailable');
      setCopied(target);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(null), 1500);
    } catch (copyError) {
      console.error('[settings] integration.copy failed:', copyError);
      setError('复制失败，请重试');
    }
  };

  const openClaudeDirectory = async (): Promise<void> => {
    try {
      const result = await window.api.integration.openClaudeDir();
      if (!result.opened) {
        setError(`无法打开 ~/.claude/：${result.reason ?? '目录不存在'}`);
      }
    } catch (openError) {
      console.error('[settings] integration.openClaudeDir failed:', openError);
      setError('无法打开 ~/.claude/');
    }
  };

  return (
    <section className="settings-section" aria-labelledby="integrationTitle">
      <div className="settings-section-heading settings-section-heading-actions">
        <h2 id="integrationTitle">AI 集成</h2>
        <button
          type="button"
          className="settings-icon-button"
          title="重新检测"
          aria-label="重新检测 AI 集成状态"
          disabled={loading}
          onClick={() => void refresh()}
        >
          <RefreshCw className={loading ? 'is-spinning' : ''} aria-hidden="true" />
        </button>
      </div>

      {snapshot ? (
        <div className="settings-integration-steps">
          <div className="settings-integration-step">
            <div className="settings-step-index">1</div>
            <div className="settings-step-content">
              <h3>链接 noty-status</h3>
              <p>执行命令，将应用内置脚本链接到 ~/.local/bin/。</p>
              <CommandRow
                text={snapshot.installCommand}
                copied={copied === 'install'}
                onCopy={() => void copyText('install', snapshot.installCommand)}
              />
              <InstalledStatus snapshot={snapshot} />
            </div>
          </div>

          <div className="settings-integration-step">
            <div className="settings-step-index">2</div>
            <div className="settings-step-content">
              <h3>更新 Claude Code 配置</h3>
              <p>将片段追加到 ~/.claude/CLAUDE.md。</p>
              <CommandRow
                text={snapshot.snippet || '未找到片段模板'}
                copied={copied === 'snippet'}
                disabled={!snapshot.snippet}
                onCopy={() => void copyText('snippet', snapshot.snippet)}
              />
              <ClaudeStatus snapshot={snapshot} />
              <button
                type="button"
                className="btn btn-secondary settings-open-directory"
                onClick={() => void openClaudeDirectory()}
              >
                <FolderOpen aria-hidden="true" />
                在 Finder 中打开 ~/.claude/
                <ExternalLink aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      ) : loading ? (
        <div className="settings-loading" role="status">
          <RefreshCw className="is-spinning" aria-hidden="true" />
          <span>正在检测集成状态</span>
        </div>
      ) : null}

      <p className="settings-note">
        Noty 不会自动写入 ~/.local/bin/ 或 ~/.claude/，安装仍由你确认执行。
      </p>
      {error ? <p className="settings-feedback is-error">{error}</p> : null}
    </section>
  );
}

function CommandRow({
  text,
  copied,
  disabled = false,
  onCopy,
}: {
  text: string;
  copied: boolean;
  disabled?: boolean;
  onCopy(): void;
}) {
  return (
    <div className="settings-command-row">
      <pre className="settings-code"><code>{text}</code></pre>
      <button
        type="button"
        className="btn btn-secondary settings-copy-button"
        disabled={disabled}
        onClick={onCopy}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {copied ? '已复制' : '复制'}
      </button>
    </div>
  );
}

function InstalledStatus({ snapshot }: { snapshot: IntegrationSnapshot }) {
  const { at, isOurs } = snapshot.installed;
  if (at && isOurs) {
    return <StatusLine tone="success">已安装 · <code>{at}</code></StatusLine>;
  }
  if (at) {
    return (
      <StatusLine tone="warning">
        检测到其他 noty-status · <code>{at}</code>
      </StatusLine>
    );
  }
  return <StatusLine tone="muted">未检测到 noty-status</StatusLine>;
}

function ClaudeStatus({ snapshot }: { snapshot: IntegrationSnapshot }) {
  const { path, exists, snippetInstalled } = snapshot.claudeMd;
  if (snippetInstalled) {
    return <StatusLine tone="success">已配置 · <code>{path}</code></StatusLine>;
  }
  if (exists) {
    return <StatusLine tone="warning">CLAUDE.md 中未找到 NOTY-STATUS 标记</StatusLine>;
  }
  return <StatusLine tone="muted">未检测到 · <code>{path}</code></StatusLine>;
}

function StatusLine({
  tone,
  children,
}: {
  tone: 'success' | 'warning' | 'muted';
  children: React.ReactNode;
}) {
  return (
    <div className={`settings-status-line is-${tone}`}>
      {tone === 'warning' ? (
        <TriangleAlert aria-hidden="true" />
      ) : (
        <span className="settings-status-dot" aria-hidden="true" />
      )}
      <span>{children}</span>
    </div>
  );
}
