const { app, Tray, Menu, ipcMain, nativeImage, BrowserWindow } = require('electron');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const NtfyClient = require('./ntfy-client');
const { toggleWindow, getWindow } = require('./window');

function generateId() {
  return crypto.randomBytes(16).toString('hex');
}

let tray = null;
let ntfyClient = null;
let settingsWindow = null;

// 防止应用退出
app.on('window-all-closed', (e) => {
  e.preventDefault();
});

app.whenReady().then(() => {
  createTray();
  setupIPC();

  // 初始化 ntfy 客户端
  ntfyClient = new NtfyClient();

  // 监听新通知事件
  ntfyClient.on('notification', (notification) => {
    updateTrayIcon();

    // 通知渲染进程
    const window = getWindow();
    if (window) {
      window.webContents.send('new-notification', notification);
    }
  });

  // 订阅所有频道
  ntfyClient.subscribeToAllChannels();
});

function createTray() {
  // 创建托盘图标
  const iconPath = path.join(__dirname, '../../assets/icon.png');
  const icon = nativeImage.createFromPath(iconPath);

  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Noty - ntfy.sh 通知');

  // 点击托盘图标
  tray.on('click', () => {
    toggleWindow(tray);
  });

  // 右键菜单
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开',
      click: () => {
        toggleWindow(tray);
      }
    },
    {
      label: '设置',
      click: () => {
        openSettingsWindow();
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        if (ntfyClient) {
          ntfyClient.unsubscribeAll();
        }
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

function updateTrayIcon() {
  const notifications = store.get('notifications');
  const unreadCount = notifications.filter(n => !n.read).length;

  if (unreadCount > 0) {
    // 有未读通知，使用带标记的图标
    const iconPath = path.join(__dirname, '../../assets/icon-unread.png');
    const icon = nativeImage.createFromPath(iconPath);
    tray.setImage(icon.resize({ width: 16, height: 16 }));
    tray.setTitle(` ${unreadCount}`);
  } else {
    // 无未读通知
    const iconPath = path.join(__dirname, '../../assets/icon.png');
    const icon = nativeImage.createFromPath(iconPath);
    tray.setImage(icon.resize({ width: 16, height: 16 }));
    tray.setTitle('');
  }
}

function openSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 500,
    height: 600,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, '../renderer/settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function setupIPC() {
  // 获取通知列表
  ipcMain.handle('get-notifications', () => {
    return store.get('notifications');
  });

  // 标记已读
  ipcMain.handle('mark-as-read', (event, id) => {
    const notifications = store.get('notifications');
    const notification = notifications.find(n => n.id === id);
    if (notification) {
      notification.read = true;
      store.set('notifications', notifications);
      updateTrayIcon();
    }
    return notifications;
  });

  // 清空已读
  ipcMain.handle('clear-read', () => {
    const notifications = store.get('notifications').filter(n => !n.read);
    store.set('notifications', notifications);
    return notifications;
  });

  // 获取频道列表
  ipcMain.handle('get-channels', () => {
    return store.get('channels');
  });

  // 添加频道
  ipcMain.handle('add-channel', (event, name, url) => {
    const channels = store.get('channels');

    // 确保 URL 格式正确
    let channelUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      channelUrl = `https://ntfy.sh/${url}`;
    }

    const channel = {
      id: generateId(),
      name: name || url,
      url: channelUrl
    };

    channels.push(channel);
    store.set('channels', channels);

    // 订阅新频道
    if (ntfyClient) {
      ntfyClient.subscribeToChannel(channel);
    }

    return channels;
  });

  // 删除频道
  ipcMain.handle('remove-channel', (event, id) => {
    const channels = store.get('channels').filter(c => c.id !== id);
    store.set('channels', channels);

    // 取消订阅
    if (ntfyClient) {
      ntfyClient.unsubscribeFromChannel(id);
    }

    return channels;
  });

  // 获取设置
  ipcMain.handle('get-settings', () => {
    return store.get('settings');
  });

  // 更新设置
  ipcMain.handle('update-settings', (event, settings) => {
    store.set('settings', settings);
    return settings;
  });

  // 关闭窗口
  ipcMain.on('close-window', () => {
    const window = getWindow();
    if (window) {
      window.hide();
    }
    if (settingsWindow) {
      settingsWindow.close();
    }
  });

  // 打开设置
  ipcMain.on('open-settings', () => {
    openSettingsWindow();
  });
}
