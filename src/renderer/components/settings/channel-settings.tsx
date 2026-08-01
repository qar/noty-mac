import { Plus, Radio, Trash2 } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import type { Channel } from '../../renderer-api';

export function ChannelSettings() {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    window.api
      .getChannels()
      .then((next) => {
        if (active) setChannels(next);
      })
      .catch((loadError) => {
        console.error('[settings] getChannels failed:', loadError);
        if (active) setError('无法载入订阅频道');
      });
    return () => {
      active = false;
    };
  }, []);

  const addChannel = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const nextUrl = url.trim();
    if (!nextUrl || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const next = await window.api.addChannel(name.trim() || nextUrl, nextUrl);
      setChannels(next);
      setName('');
      setUrl('');
    } catch (addError) {
      console.error('[settings] addChannel failed:', addError);
      setError('添加频道失败，请检查地址后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const removeChannel = async (id: string): Promise<void> => {
    if (removingId) return;
    setRemovingId(id);
    setError(null);
    try {
      setChannels(await window.api.removeChannel(id));
    } catch (removeError) {
      console.error('[settings] removeChannel failed:', removeError);
      setError('删除频道失败，请重试');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="settings-sections">
      <section className="settings-section" aria-labelledby="channelsTitle">
        <div className="settings-section-heading">
          <h2 id="channelsTitle">订阅频道</h2>
        </div>

        <div className="settings-list channel-settings-list">
          {channels?.length ? (
            channels.map((channel) => (
              <div className="settings-row channel-settings-row" key={channel.id}>
                <Radio aria-hidden="true" />
                <div className="channel-settings-copy">
                  <div className="channel-settings-name">{channel.name}</div>
                  <code className="channel-settings-url" title={channel.url}>
                    {channel.url}
                  </code>
                </div>
                <button
                  type="button"
                  className="settings-icon-button is-danger"
                  title={`删除频道 ${channel.name}`}
                  aria-label={`删除频道 ${channel.name}`}
                  disabled={Boolean(removingId)}
                  onClick={() => void removeChannel(channel.id)}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
            ))
          ) : channels ? (
            <div className="settings-empty-row">暂无订阅频道</div>
          ) : (
            <div className="settings-empty-row">正在载入频道</div>
          )}
        </div>
      </section>

      <section className="settings-section" aria-labelledby="addChannelTitle">
        <div className="settings-section-heading">
          <h2 id="addChannelTitle">添加频道</h2>
        </div>
        <form className="settings-form" onSubmit={(event) => void addChannel(event)}>
          <label className="settings-form-field">
            <span>频道名称</span>
            <input
              type="text"
              value={name}
              maxLength={80}
              placeholder="例如：我的通知"
              disabled={submitting}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="settings-form-field">
            <span>频道地址</span>
            <input
              type="text"
              value={url}
              required
              placeholder="topic 或完整 URL"
              disabled={submitting}
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <div className="settings-form-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || !url.trim()}
            >
              <Plus aria-hidden="true" />
              添加频道
            </button>
          </div>
        </form>
        {error ? <p className="settings-feedback is-error">{error}</p> : null}
      </section>

      <section className="settings-section" aria-labelledby="notificationSetupTitle">
        <div className="settings-section-heading">
          <h2 id="notificationSetupTitle">通知接入</h2>
        </div>
        <div className="settings-instructions">
          <Instruction
            title="设置频道变量"
            code={'export NTFY_CHANNEL="你的频道地址或 topic"'}
          />
          <Instruction
            title="Claude Code"
            code={'curl -d "任务完成" https://ntfy.sh/$NTFY_CHANNEL'}
          />
          <Instruction
            title="通用脚本"
            code={
              'curl -H "Title: Noty Test" -H "Tags: white_check_mark" -d "Hello from script" https://ntfy.sh/$NTFY_CHANNEL'
            }
          />
        </div>
        <p className="settings-note">
          tmux 和 kitty 只影响通知跳转；通知接收本身不依赖它们。
        </p>
      </section>
    </div>
  );
}

function Instruction({ title, code }: { title: string; code: string }) {
  return (
    <div className="settings-instruction">
      <div className="settings-instruction-title">{title}</div>
      <pre className="settings-code"><code>{code}</code></pre>
    </div>
  );
}
