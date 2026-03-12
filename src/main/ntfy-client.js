const { EventEmitter } = require('events');
const { Notification } = require('electron');
const store = require('./store');
const crypto = require('crypto');

function generateId() {
  return crypto.randomBytes(16).toString('hex');
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

    const sinceParam = lastTimestamp > 0 ? `since=${lastTimestamp}` : 'since=all';
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

    const notification = {
      id: generateId(),
      ntfyId: data.id || null,
      channelId: channel.id,
      title: data.title || channel.name,
      message: data.message || '',
      timestamp: data.time || Date.now(),
      read: false
    };
    notifications.unshift(notification);

    // 限制历史记录数量
    if (notifications.length > 1000) {
      notifications.pop();
    }

    store.set('notifications', notifications);

    // 显示系统通知
    const settings = store.get('settings');
    if (settings.soundEnabled) {
      const systemNotification = new Notification({
        title: notification.title,
        body: notification.message,
        silent: false
      });
      systemNotification.show();
    } else {
      const systemNotification = new Notification({
        title: notification.title,
        body: notification.message,
        silent: true
      });
      systemNotification.show();
    }

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
