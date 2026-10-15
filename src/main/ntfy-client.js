const { EventEmitter } = require('events');
const { Notification, safeStorage } = require('electron');
const store = require('./store');
const crypto = require('crypto');
const { normalizePlaneNotification, retainNotifications, planeCommentPreview } = require('./notification-core');
const { readPlaneAttachment } = require('./plane-attachment');

function accessToken(channel) {
  return channel.encryptedAccessToken
    ? safeStorage.decryptString(Buffer.from(channel.encryptedAccessToken, 'base64')) : '';
}

function generateId() {
  return crypto.randomBytes(16).toString('hex');
}

function isValidTmuxTarget(target) {
  return typeof target === 'string'
    && target.length > 0
    && target.length <= 128
    && !target.startsWith('-')
    && /^[A-Za-z0-9_.:%@+/-]+$/.test(target);
}

function extractTmuxTargetFromMessage(message) {
  if (typeof message !== 'string') {
    return null;
  }

  const line = message
    .split('\n')
    .find(item => /^\s*(?:🖥\s*)?tmux\s*:/i.test(item));

  if (!line) {
    return null;
  }

  const match = line.match(/^\s*(?:🖥\s*)?tmux\s*:\s*([A-Za-z0-9_.:%@+/-]+)\s*$/i);
  return match ? match[1] : null;
}

function normalizeTmuxMetadata(data) {
  const tmux = data.tmux || data.metadata?.tmux;

  const session = tmux && typeof tmux === 'object' && tmux.session !== undefined && tmux.session !== null
    ? String(tmux.session)
    : null;
  const window = tmux && typeof tmux === 'object' && tmux.window !== undefined && tmux.window !== null
    ? String(tmux.window)
    : null;
  const pane = tmux && typeof tmux === 'object' && tmux.pane !== undefined && tmux.pane !== null
    ? String(tmux.pane)
    : null;

  let target = tmux && typeof tmux === 'object' && tmux.target !== undefined && tmux.target !== null
    ? String(tmux.target)
    : null;

  if (!target && session && window !== null && pane !== null) {
    target = `${session}:${window}.${pane}`;
  }

  if (!target) {
    target = extractTmuxTargetFromMessage(data.message);
  }

  if (!target || !isValidTmuxTarget(target)) {
    return null;
  }

  const tmuxMetadata = { target };
  if (session && !session.startsWith('%')) {
    tmuxMetadata.session = session;
  } else {
    const sessionMatch = target.match(/^([^:.%]+)/);
    if (sessionMatch) tmuxMetadata.session = sessionMatch[1];
  }
  if (window !== null) tmuxMetadata.window = window;
  if (pane !== null) tmuxMetadata.pane = pane;

  return tmuxMetadata;
}

function normalizeChainTestApp(data) {
  const value = data.chainTestApp
    || data.testApp
    || data.metadata?.chainTestApp
    || data.metadata?.testApp
    || data.metadata?.macos?.testApp;

  if (!value) {
    return null;
  }

  const app = String(value).trim().toLowerCase();
  if (app === 'calendar' || app === 'safari') {
    return app;
  }

  return null;
}

function extractProjectFromMessage(message) {
  if (typeof message !== 'string') return null;

  const line = message.split('\n').find(l => /^\s*📂\s/.test(l));
  if (!line) return null;

  const match = line.match(/^\s*📂\s+([^\s(]+)(?:\s*\(([^)]+)\))?\s*$/);
  if (!match) return null;

  const project = { name: match[1] };
  if (match[2]) project.branch = match[2];
  return project;
}

function normalizeNotificationMetadata(data) {
  const tmux = normalizeTmuxMetadata(data);
  const chainTestApp = normalizeChainTestApp(data);
  const project = extractProjectFromMessage(data.message);

  if (!tmux && !chainTestApp && !project) {
    return null;
  }

  const metadata = {};
  if (tmux) {
    metadata.tmux = tmux;
  }
  if (project) {
    metadata.project = project;
  }
  if (chainTestApp) {
    metadata.chainTestApp = chainTestApp;
  }

  return metadata;
}

class NtfyClient extends EventEmitter {
  constructor() {
    super();
    this.connections = new Map(); // channelId -> EventSource
    this.reconnectTimers = new Map();
    this.systemNotifications = new Map();
  }

  subscribeToChannel(channel) {
    if (this.connections.has(channel.id)) {
      console.log(`Already subscribed to channel: ${channel.name}`);
      return;
    }

    const url = `${channel.url}/sse`;
    console.log(`Subscribing to: ${url}`);

    // 使用 fetch 的 EventSource 替代方案（因为 Node.js 没有原生 EventSource）
    this.startSSEConnection(channel);
  }

  async startSSEConnection(channel) {
    const notifications = store.get('notifications');
    const channelNotifications = notifications.filter(n => n.channelId === channel.id);
    const lastTimestamp = channelNotifications.reduce((latest, item) => Math.max(latest, item.timestamp), 0);

    const sinceTimestamp = lastTimestamp >= 1e12
      ? Math.floor(lastTimestamp / 1000)
      : lastTimestamp;
    const needsRecovery = channel.type === 'plane' && channelNotifications.some(item =>
      item.metadata?.plane?.parseError || item.metadata?.plane?.attachment?.status === 'error');
    const sinceParam = sinceTimestamp > 0 && !needsRecovery ? `since=${sinceTimestamp}` : 'since=all';
    const url = `${channel.url.replace(/\/+$/, '')}/json?${sinceParam}`;

    const controller = new AbortController();
    this.connections.set(channel.id, controller);

    try {
      const headers = {};
      if (channel.encryptedAccessToken) {
        headers.Authorization = `Bearer ${accessToken(channel)}`;
      }
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers
      });
      if (!response.ok || !response.body) throw new Error(`ntfy HTTP ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      const consume = async (line) => {
        if (!line.trim() || controller.signal.aborted) return;
        let data;
        try {
          data = JSON.parse(line);
        } catch {
          console.warn(`Invalid ntfy JSON for ${channel.name}`);
          return;
        }
        if (data.event === 'message') await this.receiveNotification(channel, data, controller.signal);
      };

      try {
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) {
            pending += decoder.decode();
            await consume(pending);
            break;
          }
          pending += decoder.decode(value, { stream: true });
          const lines = pending.split('\n');
          pending = lines.pop();
          for (const line of lines) await consume(line);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error(`Connection error for ${channel.name}:`, error);
      }
    } finally {
      // A clean EOF also needs reconnecting; compare controllers so an old
      // connection cannot resurrect a removed or replaced subscription.
      if (this.connections.get(channel.id) === controller && !controller.signal.aborted) {
        const timer = setTimeout(() => {
          this.reconnectTimers.delete(channel.id);
          if (this.connections.get(channel.id) === controller) this.startSSEConnection(channel);
        }, 5000);
        timer.unref?.();
        this.reconnectTimers.set(channel.id, timer);
      }
    }
  }

  async receiveNotification(channel, data, signal) {
    if (channel.type !== 'plane' || !data.attachment?.url) return this.handleNotification(channel, data);
    const existing = store.get('notifications').find(item => item.channelId === channel.id && item.ntfyId === data.id);
    if (existing?.metadata?.plane?.attachment?.status === 'loaded') return;
    const attachment = {
      url: data.attachment.url,
      name: data.attachment.name || 'attachment.json',
      ...(typeof data.attachment.size === 'number' ? { size: data.attachment.size } : {}),
      status: 'loaded',
    };
    let received = data;
    try {
      const message = await readPlaneAttachment(channel.url, attachment, { token: accessToken(channel), signal, fetchImpl: fetch });
      received = { ...data, message };
    } catch (error) {
      attachment.status = 'error';
      attachment.error = error.name === 'AbortError'
        ? '正文附件读取超时或中断，请重试' : error.message;
    }
    this.handleNotification(channel, received, attachment);
  }

  async retryAttachment(id) {
    const item = store.get('notifications').find(notification => notification.id === id);
    const attachment = item?.metadata?.plane?.attachment;
    if (!attachment || !item.ntfyId) throw new Error('没有可重试的正文附件');
    const channel = store.get('channels').find(source => source.id === item.channelId);
    if (!channel) throw new Error('通知来源已移除，无法重试附件');
    await this.receiveNotification(channel, {
      id: item.ntfyId, time: item.timestamp,
      message: item.metadata.plane.rawPayload,
      click: item.metadata.plane.sourceClick,
      attachment,
    });
  }

  handleNotification(channel, data, attachment) {
    const notifications = store.get('notifications');

    // 去重：ntfy 消息 ID 已存在则跳过
    const existing = data.id && notifications.find(n => n.channelId === channel.id && n.ntfyId === data.id);
    if (existing && (!attachment || existing.metadata?.plane?.attachment?.status === 'loaded')) {
      return;
    }

    const rawTimestamp = data.time ?? Date.now();
    const normalizedTimestamp = rawTimestamp < 1e12 ? rawTimestamp * 1000 : rawTimestamp;

    const type = channel.type || 'tmux-agent';
    const plane = type === 'plane'
      ? normalizePlaneNotification(channel, data.message || '', data.click)
      : null;
    const metadata = plane?.metadata || normalizeNotificationMetadata(data);
    if (plane && attachment) {
      metadata.plane.attachment = attachment;
      if (typeof data.click === 'string') metadata.plane.sourceClick = data.click;
      if (attachment.status === 'error') {
        plane.title = 'RtiTek Plane · 正文未载入';
        plane.message = attachment.error;
        delete metadata.plane.parseError;
      }
    }
    if (plane?.metadata.plane.deliveryId && notifications.some(n => n.channelId === channel.id
      && n.id !== existing?.id && n.metadata?.plane?.deliveryId === plane.metadata.plane.deliveryId)) return;

    // Repairs keep the local identity and explicit acknowledgement/completion.
    if (existing) {
      Object.assign(existing, { title: plane.title, message: plane.message, metadata });
      store.set('notifications', notifications);
      this.emit('notification-updated', existing);
      return;
    }

    const notification = {
      id: generateId(),
      ntfyId: data.id || null,
      channelId: channel.id,
      type,
      title: plane?.title || data.title || channel.name,
      message: plane?.message || data.message || '',
      timestamp: normalizedTimestamp,
      read: false,
      ...(plane ? { completedAt: null } : {})
    };

    if (metadata) {
      notification.metadata = metadata;
    }
    notifications.unshift(notification);

    store.set('notifications', retainNotifications(notifications));
    this.emit('notification', notification);

    // 显示系统通知
    const settings = store.get('settings');
    const cleanTitle = plane ? notification.title : notification.title.replace(/\s*\([^)]*\)\s*$/, '');
    const project = metadata?.project;
    const projectLabel = project
      ? (project.branch ? `${project.name} (${project.branch})` : project.name)
      : null;
    const cleanBody = plane
      ? (metadata.plane.attachment?.error || planeCommentPreview(metadata.plane.rawPayload) || metadata.plane.rawPayload.slice(0, 1000))
      : notification.message
      .split('\n')
      .filter(line => !/^\s*(?:🖥\s*)?tmux\s*:/i.test(line) && !/^\s*📂\s/.test(line))
      .join('\n')
      .trim();

    if (!Notification.isSupported()) return;
    const systemNotification = new Notification({
      title: cleanTitle,
      subtitle: plane ? 'RtiTek Plane' : projectLabel || undefined,
      body: cleanBody || notification.message,
      silent: !settings.soundEnabled
    });

    systemNotification.on('click', () => {
      this.emit('notification-clicked', notification);
    });
    systemNotification.on('close', () => this.systemNotifications.delete(notification.id));
    this.systemNotifications.set(notification.id, systemNotification);

    systemNotification.show();

  }

  unsubscribeFromChannel(channelId) {
    clearTimeout(this.reconnectTimers.get(channelId));
    this.reconnectTimers.delete(channelId);
    const controller = this.connections.get(channelId);
    if (controller) {
      controller.abort();
      this.connections.delete(channelId);
      console.log(`Unsubscribed from channel: ${channelId}`);
    }
  }

  unsubscribeAll() {
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    this.reconnectTimers.clear();
    for (const [channelId, controller] of this.connections) {
      controller.abort();
    }
    this.connections.clear();
  }

  subscribeToAllChannels() {
    const channels = store.get('channels');
    channels.forEach(channel => {
      this.subscribeToChannel(channel);
    });
  }
}

module.exports = NtfyClient;
