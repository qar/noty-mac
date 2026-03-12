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

  listEl.innerHTML = displayNotifications.map(notification => {
    const channel = channels[notification.channelId];
    const channelName = channel ? channel.name : '未知频道';
    const time = formatTime(notification.timestamp);
    const readClass = notification.read ? 'read' : '';

    return `
      <div class="notification-item ${readClass}" data-id="${notification.id}">
        <div class="notification-header">
          <div class="notification-title">${escapeHtml(notification.title)}</div>
          <div class="notification-time">${time}</div>
        </div>
        <div class="notification-message">${escapeHtml(notification.message)}</div>
        <div class="notification-channel">📢 ${escapeHtml(channelName)}</div>
      </div>
    `;
  }).join('');

  // 添加点击事件
  listEl.querySelectorAll('.notification-item').forEach(item => {
    item.addEventListener('click', async () => {
      const id = item.dataset.id;
      notifications = await window.api.markAsRead(id);
      await loadData();
      renderNotifications();
    });
  });
}

// 设置事件监听
function setupEventListeners() {
  // 清空已读按钮
  document.getElementById('clearReadBtn').addEventListener('click', async () => {
    notifications = await window.api.clearRead();
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

// HTML 转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 启动应用
init();
