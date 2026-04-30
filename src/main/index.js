const { app, Tray, Menu, ipcMain, nativeImage, BrowserWindow } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const NtfyClient = require('./ntfy-client');
const Updater = require('./updater');
const { toggleWindow, getWindow } = require('./window');

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

function resolveNotificationTmuxTarget(notification) {
  return notification?.metadata?.tmux?.target
    || extractTmuxTargetFromMessage(notification?.message || '');
}

function execTmux(args) {
  const candidates = ['tmux', '/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'];

  return new Promise((resolve, reject) => {
    const run = (index) => {
      if (index >= candidates.length) {
        reject(new Error('tmux_not_found'));
        return;
      }

      execFile(candidates[index], args, { timeout: 5000 }, (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout?.trim() || '');
          return;
        }

        if (error.code === 'ENOENT') {
          run(index + 1);
          return;
        }

        reject(new Error(stderr?.trim() || error.message));
      });
    };

    run(0);
  });
}

function execOpen(args) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/open', args, { timeout: 5000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
        return;
      }
      resolve(stdout?.trim() || '');
    });
  });
}

function execAppleScript(lines) {
  const args = lines.flatMap(line => ['-e', line]);

  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', args, { timeout: 5000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
        return;
      }
      resolve(stdout?.trim() || '');
    });
  });
}

async function focusApp(appName) {
  try {
    await execOpen(['-a', appName]);
  } catch (error) {
    return { success: false, reason: `${appName.toLowerCase()}_unavailable` };
  }

  try {
    await execAppleScript([`tell application "${appName}" to activate`]);
  } catch (error) {
    return { success: false, reason: `${appName.toLowerCase()}_activate_failed` };
  }

  return { success: true };
}

async function listTmuxClients() {
  try {
    const output = await execTmux(['list-clients', '-F', '#{client_name}\t#{session_name}\t#{client_termname}\t#{client_activity}']);
    return output
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name = '', session = '', termname = '', activity = '0'] = line.split('\t');
        return {
          name,
          session,
          termname: termname.toLowerCase(),
          activity: Number(activity) || 0
        };
      })
      .filter(client => client.name);
  } catch (error) {
    return [];
  }
}

function pickTmuxClient(clients, targetSession) {
  const kittyClients = clients.filter(client => client.termname.includes('kitty'));
  if (kittyClients.length === 0) {
    return null;
  }

  const kittyOnTarget = kittyClients
    .filter(client => client.session === targetSession)
    .sort((a, b) => b.activity - a.activity)[0];
  if (kittyOnTarget) {
    return kittyOnTarget;
  }

  return kittyClients.sort((a, b) => b.activity - a.activity)[0];
}

async function jumpToTmuxTarget(target, options = {}) {
  if (!isValidTmuxTarget(target)) {
    return { success: false, reason: 'invalid_target' };
  }

  const chainTestApp = options.chainTestApp === 'calendar' || options.chainTestApp === 'safari'
    ? options.chainTestApp
    : null;

  try {
    const session = await execTmux(['display-message', '-p', '-t', target, '#S']);
    const windowTarget = await execTmux(['display-message', '-p', '-t', target, '#S:#I']);
    const clients = await listTmuxClients();
    const client = pickTmuxClient(clients, session);

    if (!client) {
      return { success: false, reason: 'no_attached_client' };
    }

    if (chainTestApp) {
      const testAppName = chainTestApp === 'calendar' ? 'Calendar' : 'Safari';
      const testAppResult = await focusApp(testAppName);
      if (!testAppResult.success) {
        return { success: false, reason: testAppResult.reason };
      }
    }

    await focusApp('Kitty');

    await execTmux(['switch-client', '-c', client.name, '-t', session]);
    await execTmux(['select-window', '-t', windowTarget]);
    await execTmux(['select-pane', '-t', target]);

    return { success: true };
  } catch (error) {
    if (error.message === 'tmux_not_found') {
      return { success: false, reason: 'tmux_not_found' };
    }

    return { success: false, reason: error.message || 'tmux_error' };
  }
}

let tray = null;
let ntfyClient = null;
let settingsWindow = null;
let updater = null;

// 防止应用退出
app.on('window-all-closed', (e) => {
  e.preventDefault();
});

app.whenReady().then(() => {
  createTray();
  setupIPC();
  updateTrayIcon();

  updater = new Updater();
  updater.cleanupStagingDir();

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

  ntfyClient.on('notification-clicked', async (notification) => {
    const target = resolveNotificationTmuxTarget(notification);

    if (!target) {
      return;
    }

    const chainTestApp = notification?.metadata?.chainTestApp || null;
    const result = await jumpToTmuxTarget(target, { chainTestApp });

    if (result.success) {
      const notifications = store.get('notifications');
      const item = notifications.find(n => n.id === notification.id);
      if (item && !item.read) {
        item.read = true;
        store.set('notifications', notifications);
        updateTrayIcon();
      }

      const window = getWindow();
      if (window) {
        window.webContents.send('notification-jumped', notification.id);
      }
    }
  });

  // 订阅所有频道
  ntfyClient.subscribeToAllChannels();
});

function loadTrayTemplateImage() {
  const iconPath = path.join(__dirname, '../../assets/tray-template.png');
  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true);
  return icon;
}

function createTray() {
  // 创建托盘图标
  tray = new Tray(loadTrayTemplateImage());
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

  tray.on('right-click', () => {
    tray.popUpContextMenu(contextMenu);
  });
}


function updateTrayIcon() {
  const notifications = store.get('notifications');
  const unreadCount = notifications.filter(n => !n.read).length;

  tray.setImage(loadTrayTemplateImage());
  tray.setTitle(unreadCount > 0 ? ` ${unreadCount}` : '');
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

  // 全部标记为已读
  ipcMain.handle('mark-all-as-read', () => {
    const notifications = store.get('notifications');
    notifications.forEach(n => { n.read = true; });
    store.set('notifications', notifications);
    updateTrayIcon();
    return notifications;
  });

  // 批量标记已读
  ipcMain.handle('mark-many-as-read', (event, ids) => {
    const notifications = store.get('notifications');
    const idSet = new Set(Array.isArray(ids) ? ids : []);
    let changed = false;
    notifications.forEach(n => {
      if (idSet.has(n.id) && !n.read) {
        n.read = true;
        changed = true;
      }
    });
    if (changed) {
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

  // 根据通知跳转 tmux 目标
  ipcMain.handle('jump-to-notification-target', async (event, id, options = {}) => {
    const notifications = store.get('notifications');
    const notification = notifications.find(n => n.id === id);
    const target = resolveNotificationTmuxTarget(notification);

    if (!target) {
      return { success: false, reason: 'no_target' };
    }

    const chainTestApp = options.chainTestApp
      || notification?.metadata?.chainTestApp
      || null;

    return jumpToTmuxTarget(target, { chainTestApp });
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

  // 获取应用版本
  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  // 检查更新
  ipcMain.handle('check-for-update', async () => {
    return updater.checkForUpdate();
  });

  // 下载更新
  ipcMain.handle('download-update', async () => {
    return updater.downloadUpdate((progress) => {
      if (settingsWindow) {
        settingsWindow.webContents.send('update-download-progress', progress);
      }
    });
  });

  // 应用更新
  ipcMain.handle('apply-update', () => {
    return updater.applyUpdate();
  });
}
