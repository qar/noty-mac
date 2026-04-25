let notifications = [];
let settings = {};
let channels = {};

// 初始化
async function init() {
  await loadData();
  renderNotifications();
  setupEventListeners();
}

// 加载数据
async function loadData() {
  notifications = await window.api.getNotifications();
  settings = await window.api.getSettings();
  const channelList = await window.api.getChannels();

  // 创建频道映射
  channels = {};
  channelList.forEach(ch => {
    channels[ch.id] = ch;
  });
}

// 渲染通知列表
function renderNotifications() {
  const listEl = document.getElementById('notificationList');
  const markAllBtn = document.getElementById('markAllReadBtn');

  // 有未读通知时才显示按钮
  const hasUnread = notifications.some(n => !n.read);
  markAllBtn.style.display = hasUnread ? '' : 'none';

  // 过滤已读通知（如果设置了隐藏）
  let displayNotifications = notifications;
  if (settings.hideRead) {
    displayNotifications = notifications.filter(n => !n.read);
  }

  if (displayNotifications.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔔</div>
        <div>暂无通知</div>
      </div>
    `;
    return;
  }

  const singleChannel = Object.keys(channels).length <= 1;

  listEl.innerHTML = displayNotifications.map(notification => {
    const channel = channels[notification.channelId];
    const channelName = channel ? channel.name : '未知频道';
    const time = formatTime(notification.timestamp);
    const readClass = notification.read ? 'read' : '';
    const cleanMsg = cleanMessage(notification.message);
    const displayTitle = cleanTitle(notification.title);

    const project = notification.metadata?.project;
    const sessionLabel = project
      ? (project.branch ? `${project.name} (${project.branch})` : project.name)
      : null;

    const hasTmux = !!notification.metadata?.tmux?.target
      || /^\s*(?:🖥\s*)?tmux\s*:\s*[A-Za-z0-9_.:%@+/-]+\s*$/im.test(notification?.message || '');

    const sessionHtml = sessionLabel
      ? `<div class="notification-session-title">${escapeHtml(sessionLabel)}</div>`
      : '';

    const channelHtml = singleChannel
      ? ''
      : `<div class="notification-channel">📢 ${escapeHtml(channelName)}</div>`;

    const jumpIndicator = hasTmux ? ' <span class="jump-indicator">↗</span>' : '';

    return `
      <div class="notification-item ${readClass}" data-id="${notification.id}">
        <div class="notification-header">
          <div class="notification-type">${escapeHtml(displayTitle)}${jumpIndicator}</div>
          <div class="notification-time">${time}</div>
        </div>
        ${sessionHtml}
        <div class="notification-message">${escapeHtml(cleanMsg)}</div>
        ${channelHtml}
      </div>
    `;
  }).join('');

  // 添加点击事件
  listEl.querySelectorAll('.notification-item').forEach(item => {
    item.addEventListener('click', async () => {
      const id = item.dataset.id;
      const notification = notifications.find(n => n.id === id);
      const hasTmuxTarget = !!notification?.metadata?.tmux?.target;
      const hasTmuxLine = /^\s*(?:🖥\s*)?tmux\s*:\s*([A-Za-z0-9_.:%@+/-]+)\s*$/im.test(notification?.message || '');

      if (hasTmuxTarget || hasTmuxLine) {
        try {
          const chainTestApp = notification?.metadata?.chainTestApp;
          const result = await window.api.jumpToNotificationTarget(
            id,
            chainTestApp ? { chainTestApp } : undefined
          );
          if (!result?.success) {
            console.error('Failed to jump tmux target:', result?.reason || 'unknown_error');
          }
        } catch (error) {
          console.error('Failed to jump tmux target:', error);
        }
      }

      notifications = await window.api.markAsRead(id);
      await loadData();
      renderNotifications();
    });
  });
}

// 设置事件监听
function setupEventListeners() {
  // 清空已读按钮
  const clearReadBtn = document.getElementById('clearReadBtn');
  if (clearReadBtn) {
    clearReadBtn.addEventListener('click', async () => {
      notifications = await window.api.clearRead();
      await loadData();
      renderNotifications();
    });
  }

  // 全部标记已读按钮
  document.getElementById('markAllReadBtn').addEventListener('click', async () => {
    notifications = await window.api.markAllAsRead();
    await loadData();
    renderNotifications();
  });

  // 设置按钮
  document.getElementById('settingsBtn').addEventListener('click', () => {
    window.api.openSettings();
  });

  // 监听新通知
  window.api.onNewNotification(async (notification) => {
    await loadData();
    renderNotifications();
  });

  // 监听窗口每次显示时刷新数据
  window.api.onWindowShown(async () => {
    await loadData();
    renderNotifications();
  });

  // 监听系统通知点击后跳转成功事件
  window.api.onNotificationJumped(async (id) => {
    notifications = await window.api.markAsRead(id);
    await loadData();
    renderNotifications();
  });
}

// 格式化时间
function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // 小于1分钟
  if (diff < 60000) {
    return '刚刚';
  }

  // 小于1小时
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes}分钟前`;
  }

  // 小于24小时
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours}小时前`;
  }

  // 小于7天
  if (diff < 604800000) {
    const days = Math.floor(diff / 86400000);
    return `${days}天前`;
  }

  // 显示日期
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// 清理消息：去除 tmux 行
function cleanMessage(message) {
  return message
    .split('\n')
    .filter(line => {
      if (/^\s*(?:🖥\s*)?tmux\s*:/i.test(line)) return false;
      if (/^\s*📂\s/.test(line)) return false;
      return true;
    })
    .join('\n')
    .trim();
}

function cleanTitle(title) {
  return title.replace(/\s*\([^)]*\)\s*$/, '');
}

// HTML 转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 启动应用
init();
