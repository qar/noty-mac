const { EventEmitter } = require('events');
const { Notification } = require('electron');
const store = require('./store');
const crypto = require('crypto');

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
    const lastTimestamp = channelNotifications.length > 0
      ? Math.max(...channelNotifications.map(n => n.timestamp))
      : 0;

    const sinceTimestamp = lastTimestamp >= 1e12
      ? Math.floor(lastTimestamp / 1000)
      : lastTimestamp;
    const sinceParam = sinceTimestamp > 0 ? `since=${sinceTimestamp}` : 'since=all';
    const url = `${channel.url}/json?${sinceParam}`;

    const controller = new AbortController();
    this.connections.set(channel.id, controller);

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.trim()) {
            try {
              const data = JSON.parse(line);
              if (data.event === 'message') {
                this.handleNotification(channel, data);
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error(`Connection error for ${channel.name}:`, error);
        // 5秒后重连
        setTimeout(() => {
          if (this.connections.has(channel.id)) {
            this.startSSEConnection(channel);
          }
        }, 5000);
      }
    }
  }

  handleNotification(channel, data) {
    const notifications = store.get('notifications');

    // 去重：ntfy 消息 ID 已存在则跳过
    if (data.id && notifications.some(n => n.ntfyId === data.id)) {
      return;
    }

    const rawTimestamp = data.time ?? Date.now();
    const normalizedTimestamp = rawTimestamp < 1e12 ? rawTimestamp * 1000 : rawTimestamp;

    const metadata = normalizeNotificationMetadata(data);

    const notification = {
      id: generateId(),
      ntfyId: data.id || null,
      channelId: channel.id,
      title: data.title || channel.name,
      message: data.message || '',
      timestamp: normalizedTimestamp,
      read: false
    };

    if (metadata) {
      notification.metadata = metadata;
    }
    notifications.unshift(notification);

    // 限制历史记录数量
    if (notifications.length > 1000) {
      notifications.pop();
    }

    store.set('notifications', notifications);

    // 显示系统通知
    const settings = store.get('settings');
    const systemNotification = new Notification({
      title: notification.title,
      body: notification.message,
      silent: !settings.soundEnabled
    });

    systemNotification.on('click', () => {
      this.emit('notification-clicked', notification);
    });

    systemNotification.show();

    // 触发事件
    this.emit('notification', notification);
  }

  unsubscribeFromChannel(channelId) {
    const controller = this.connections.get(channelId);
    if (controller) {
      controller.abort();
      this.connections.delete(channelId);
      console.log(`Unsubscribed from channel: ${channelId}`);
    }
  }

  unsubscribeAll() {
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
