import { BellPlus, ClipboardList, KeyRound, Save, Terminal, Trash2, X } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import type { Channel } from '../../renderer-api';
import type { NotificationType } from '../../../main/notification-types';

export function ChannelSettings() {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [type, setType] = useState<NotificationType>('tmux-agent');
  const [planeBaseUrl, setPlaneBaseUrl] = useState('');
  const [planeWorkspaceSlug, setPlaneWorkspaceSlug] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [planeApiKey, setPlaneApiKey] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [replacementKey, setReplacementKey] = useState('');
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
        if (active) setError('无法载入通知来源');
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
      const next = await window.api.addChannel(name.trim(), nextUrl, {
        type, planeBaseUrl, planeWorkspaceSlug, accessToken, planeApiKey,
      });
      setChannels(next);
      setName('');
      setUrl('');
      setAccessToken('');
      setPlaneApiKey('');
    } catch (addError) {
      console.error('[settings] addChannel failed:', addError);
      setError(addError instanceof Error ? addError.message : '新建通知失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  const savePlaneKey = async (id: string, key: string): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      setChannels(await window.api.setPlaneApiKey(id, key));
      setEditingKey(null);
      setReplacementKey('');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存 Plane API 密钥失败');
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
          <h2 id="channelsTitle">通知来源</h2>
        </div>

        <div className="settings-list channel-settings-list">
          {channels?.length ? (
            channels.map((channel) => (
              <div className="settings-row channel-settings-row" key={channel.id}>
                {channel.type === 'plane' ? <ClipboardList aria-hidden="true" /> : <Terminal aria-hidden="true" />}
                <div className="channel-settings-copy">
                  <div className="channel-settings-name">{channel.name}</div>
                  <span className="channel-settings-type">{channel.type === 'plane' ? 'RtiTek Plane 通知' : 'Tmux 内的 AI agent 通知'}</span>
                  <code className="channel-settings-url" title={channel.url}>
                    {channel.url}
                  </code>
                  {channel.planeBaseUrl ? <span className="channel-settings-url">{channel.planeBaseUrl}</span> : null}
                  {editingKey === channel.id ? <form className="settings-form" onSubmit={event => { event.preventDefault(); void savePlaneKey(channel.id, replacementKey); }}>
                    <label className="settings-form-field">
                      <span>Plane API 密钥{channel.hasPlaneApiKey ? '（已配置）' : ''}</span>
                      <input type="password" autoComplete="off" value={replacementKey} disabled={submitting} onChange={event => setReplacementKey(event.target.value)} />
                    </label>
                    <div className="settings-form-actions">
                      <button type="submit" className="settings-icon-button" title="保存 Plane API 密钥" aria-label="保存 Plane API 密钥" disabled={submitting || !replacementKey.trim()}><Save /></button>
                      {channel.hasPlaneApiKey ? <button type="button" className="settings-icon-button is-danger" title="移除 Plane API 密钥" aria-label="移除 Plane API 密钥" disabled={submitting} onClick={() => void savePlaneKey(channel.id, '')}><Trash2 /></button> : null}
                      <button type="button" className="settings-icon-button" title="取消" aria-label="取消" disabled={submitting} onClick={() => { setEditingKey(null); setReplacementKey(''); }}><X /></button>
                    </div>
                  </form> : null}
                </div>
                {channel.type === 'plane' ? <button type="button" className="settings-icon-button" title={`Plane API 密钥${channel.hasPlaneApiKey ? '（已配置）' : ''}`} aria-label={`配置 Plane API 密钥：${channel.name}`} disabled={submitting} onClick={() => { setEditingKey(channel.id); setReplacementKey(''); }}><KeyRound aria-hidden="true" /></button> : null}
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
            <div className="settings-empty-row">暂无通知来源</div>
          ) : (
            <div className="settings-empty-row">正在载入通知来源</div>
          )}
        </div>
      </section>

      <section className="settings-section" aria-labelledby="addChannelTitle">
        <div className="settings-section-heading">
          <h2 id="addChannelTitle">新建通知</h2>
        </div>
        <form className="settings-form" onSubmit={(event) => void addChannel(event)}>
          <label className="settings-form-field notification-type-field">
            <span>通知类型</span>
            <select aria-label="通知类型" value={type} disabled={submitting} onChange={(event) => setType(event.target.value as NotificationType)}>
              <option value="tmux-agent">Tmux 内的 AI agent 通知</option>
              <option value="plane">RtiTek Plane 通知</option>
            </select>
          </label>
          <label className="settings-form-field">
            <span>通知名称</span>
            <input
              type="text"
              value={name}
              maxLength={80}
              placeholder={type === 'plane' ? 'RtiTek Plane' : 'Tmux AI agent'}
              disabled={submitting}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="settings-form-field">
            <span>ntfy 频道地址</span>
            <input
              type="text"
              value={url}
              required
              placeholder="topic 或完整 URL"
              disabled={submitting}
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <label className="settings-form-field">
            <span>ntfy 访问令牌（可选）</span>
            <input type="password" value={accessToken} autoComplete="off" disabled={submitting} onChange={(event) => setAccessToken(event.target.value)} />
          </label>
          {type === 'plane' ? <>
            <label className="settings-form-field">
              <span>Plane 网站地址</span>
              <input type="url" value={planeBaseUrl} required placeholder="https://plane.example.com" disabled={submitting} onChange={(event) => setPlaneBaseUrl(event.target.value)} />
            </label>
            <label className="settings-form-field">
              <span>工作区标识（可选）</span>
              <input type="text" value={planeWorkspaceSlug} placeholder="rtitek" disabled={submitting} onChange={(event) => setPlaneWorkspaceSlug(event.target.value)} />
            </label>
            <label className="settings-form-field">
              <span>Plane API 密钥（可选）</span>
              <input type="password" value={planeApiKey} autoComplete="off" disabled={submitting} onChange={event => setPlaneApiKey(event.target.value)} />
            </label>
          </> : null}
          <div className="settings-form-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || !url.trim()}
            >
              <BellPlus aria-hidden="true" />
              新建通知
            </button>
          </div>
        </form>
        {error ? <p className="settings-feedback is-error">{error}</p> : null}
      </section>

    </div>
  );
}
