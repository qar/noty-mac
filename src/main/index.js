const { app, Tray, Menu, ipcMain, nativeImage, Notification } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const NtfyClient = require('./ntfy-client');
const Updater = require('./updater');
const { toggleWindow, getWindow } = require('./window');
const { openMainWindow, hideMainWindow, getMainWindow, destroyMainWindow } = require('./main-window');
const workspace = require('./workspace');
const { probeTmux } = require('./tmux-probe');
const { registerWorkspaceIpc } = require('./ipc-workspace');
const { registerIntegrationIpc } = require('./ipc-integration');
const { registerLocalAiIpc } = require('./ipc-local-ai');
const { registerSettingsIpc } = require('./ipc-settings');
const { setDockIcon } = require('./app-icon');

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

  // Force a UTF-8 locale on the tmux child. When Noty.app is launched by
  // LaunchServices (menu bar / login item / Dock), its env has no LANG/LC_*,
  // and tmux falls back to the C locale where `-F` format output sanitizes
  // non-printable bytes — turning our literal tab separator into '_'. That
  // collapses each list-clients row into a single field, leaves client_termname
  // empty, and click-to-jump fails as `no_attached_client`. Dev mode never
  // shows it because `npm start` inherits the shell's LANG.
  const tmuxEnv = { ...process.env, LANG: process.env.LANG || 'en_US.UTF-8' };

  return new Promise((resolve, reject) => {
    const run = (index) => {
      if (index >= candidates.length) {
        reject(new Error('tmux_not_found'));
        return;
      }

      execFile(candidates[index], args, { timeout: 5000, env: tmuxEnv }, (error, stdout, stderr) => {
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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Bring an app to the foreground using LaunchServices only (`open -a`).
// Unlike `tell application ... to activate`, this does NOT send Apple Events,
// so it never depends on the TCC Automation grant — which, for an ad-hoc signed
// app, is keyed to the binary's cdhash and silently resets on every rebuild or
// asar self-update. Keeping terminal focus off Apple Events is what stops the
// "click-to-jump periodically stops working" cycle.
async function raiseApp(appName) {
  try {
    await execOpen(['-a', appName]);
    return true;
  } catch (error) {
    return false;
  }
}

// Poll for a kitty tmux client to appear (e.g. right after launching kitty,
// while the user's shell auto-attaches tmux). Returns the client or null.
async function waitForKittyClient(targetSession, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await delay(200);
    const client = pickTmuxClient(await listTmuxClients(), targetSession);
    if (client) {
      return client;
    }
  }
  return null;
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

    // Optional chain-test app (test harness only, opt-in via NTFY_CHAIN_TEST_APP).
    // This path intentionally exercises the Apple Events activation chain.
    if (chainTestApp) {
      const testAppName = chainTestApp === 'calendar' ? 'Calendar' : 'Safari';
      const testAppResult = await focusApp(testAppName);
      if (!testAppResult.success) {
        return { success: false, reason: testAppResult.reason };
      }
    }

    // Bring the terminal to the front via LaunchServices only — no Apple Events,
    // so the jump never depends on the TCC Automation grant. This also launches
    // kitty if it isn't running, giving its shell a chance to auto-attach tmux.
    await raiseApp('kitty');

    let client = pickTmuxClient(await listTmuxClients(), session);

    // Fallback: no kitty client attached yet (all detached, or kitty was just
    // launched above). Wait briefly for one to attach, then switch it over.
    if (!client) {
      client = await waitForKittyClient(session, 1500);
    }

    if (!client) {
      return { success: false, reason: 'no_attached_client' };
    }

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

// Simplified jump used by the workspace card click (Q7 decision):
// only `switch-client -t {session}` — do NOT select-window / select-pane,
// so tmux stays on whichever window/pane the session was last on. Notification
// jumps still use jumpToTmuxTarget for precise pane targeting.
async function jumpToTmuxSession(sessionName) {
  if (typeof sessionName !== 'string' || !sessionName || sessionName.startsWith('-')) {
    return { success: false, reason: 'invalid_session' };
  }
  if (!/^[A-Za-z0-9_.:%@+/-]+$/.test(sessionName)) {
    return { success: false, reason: 'invalid_session' };
  }

  try {
    // Confirm the session actually exists before we touch clients.
    await execTmux(['has-session', '-t', sessionName]);

    await raiseApp('kitty');

    let client = pickTmuxClient(await listTmuxClients(), sessionName);
    if (!client) {
      client = await waitForKittyClient(sessionName, 1500);
    }
    if (!client) {
      return { success: false, reason: 'no_attached_client' };
    }

    await execTmux(['switch-client', '-c', client.name, '-t', sessionName]);
    return { success: true };
  } catch (error) {
    if (error.message === 'tmux_not_found') {
      return { success: false, reason: 'tmux_not_found' };
    }
    // has-session on an unknown session errors with "can't find session: X".
    if (/can't find session|no such session|session not found/i.test(error?.message || '')) {
      return { success: false, reason: 'session_not_found' };
    }
    return { success: false, reason: error.message || 'tmux_error' };
  }
}

let tray = null;
let ntfyClient = null;
let updater = null;
let requestedDashboardView = 'workspace';

// 防止应用退出
app.on('window-all-closed', (e) => {
  e.preventDefault();
});

// macOS：Dock 图标被点或应用从后台切回时唤起主界面。tray-only 场景下
// activate 不会触发；只有主窗口被打开过、Dock 图标存在时才有这条路径。
app.on('activate', () => {
  openMainWindow();
  refreshTmuxProbeThrottled();
});

app.whenReady().then(async () => {
  setDockIcon();

  // Prime the tmux availability cache before wiring the tray so the very
  // first right-click already has an accurate `enabled` state.
  await refreshTmuxProbe();

  createTray();
  setupIPC();
  registerWorkspaceIpc({
    jumpToTmuxSession,
    syncTmuxToWorkspaces,
  });
  registerIntegrationIpc();
  registerLocalAiIpc();
  registerSettingsIpc();
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

// -----------------------------------------------------------------------
// Tmux availability cache
//
// A live read-only probe (`<tmux> -V`) drives whether the "同步 tmux …"
// tray item is enabled. We prime the cache before creating the tray at
// startup and refresh it (throttled, 5s min interval) on `activate` — so
// the user gets accurate menu state after installing / uninstalling tmux
// without needing to restart the app.
// -----------------------------------------------------------------------
let tmuxProbe = { available: false, path: null, version: null };
let lastTmuxProbeAt = 0;

async function refreshTmuxProbe() {
  try {
    tmuxProbe = await probeTmux();
  } catch (error) {
    console.warn('[tmux-probe] refresh failed:', error);
    tmuxProbe = { available: false, path: null, version: null };
  }
  lastTmuxProbeAt = Date.now();
}

function refreshTmuxProbeThrottled(minIntervalMs = 5000) {
  if (Date.now() - lastTmuxProbeAt < minIntervalMs) return;
  // Fire and forget; menu build reads the latest cache next right-click.
  void refreshTmuxProbe();
}

// -----------------------------------------------------------------------
// Workspace: tmux → workspace sync
//
// Reads local tmux session names via `tmux list-sessions -F '#S'`, hands
// them to the workspace data layer for idempotent reconciliation, then
// posts a system notification summarising the delta (Q6 decision).
// Red-line §11: this only runs a READ-ONLY tmux command; workspace.js
// side-effects are limited to its own uuid directories.
// -----------------------------------------------------------------------
async function syncTmuxToWorkspaces() {
  let sessionNames = [];
  try {
    const stdout = await execTmux(['list-sessions', '-F', '#S']);
    sessionNames = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    if (error && error.message === 'tmux_not_found') {
      new Notification({
        title: 'Noty · 同步失败',
        body: '未检测到 tmux，无法读取会话列表'
      }).show();
      return;
    }
    // `no server running on <socket>` is what tmux prints when nothing is
    // attached — treat it as "zero sessions" rather than an error.
    if (/no server running/i.test(error?.message || '')) {
      sessionNames = [];
    } else {
      console.error('[workspace] tmux list-sessions failed:', error);
      new Notification({
        title: 'Noty · 同步失败',
        body: '读取 tmux 会话时出错：' + (error?.message || 'unknown')
      }).show();
      return;
    }
  }

  let result;
  try {
    result = await workspace.syncFromTmux(sessionNames);
  } catch (error) {
    console.error('[workspace] syncFromTmux failed:', error);
    new Notification({
      title: 'Noty · 同步失败',
      body: '保存工作区时出错：' + (error?.message || 'unknown')
    }).show();
    return;
  }

  new Notification({
    title: 'Noty · 同步完成',
    body: `新增 ${result.added}，跳过 ${result.skipped}（共 ${sessionNames.length} 个 tmux session）`
  }).show();

  // Nudge the main window renderer to re-fetch (Step 4b will subscribe).
  const win = getMainWindow();
  if (win) {
    win.webContents.send('workspace:updated');
  }
}

function buildTrayContextMenu() {
  const tmuxAvailable = tmuxProbe.available;
  const syncItem = {
    label: '同步 tmux 到工作区',
    enabled: tmuxAvailable,
    click: () => {
      void syncTmuxToWorkspaces();
    }
  };
  if (!tmuxAvailable) {
    syncItem.toolTip = '未检测到 tmux，请先安装 tmux 或将其加入 PATH';
  }

  return Menu.buildFromTemplate([
    {
      label: '打开通知面板',
      click: () => {
        toggleWindow(tray);
      }
    },
    {
      label: '打开主界面',
      click: () => {
        openMainWindow();
      }
    },
    { type: 'separator' },
    syncItem,
    { type: 'separator' },
    {
      label: '设置',
      click: () => {
        openSettingsView();
      }
    },
    {
      label: '退出',
      click: () => {
        if (ntfyClient) {
          ntfyClient.unsubscribeAll();
        }
        destroyMainWindow();
        app.quit();
      }
    }
  ]);
}

function createTray() {
  // 创建托盘图标
  tray = new Tray(loadTrayTemplateImage());
  tray.setToolTip('Noty - ntfy.sh 通知');

  // 点击托盘图标
  tray.on('click', () => {
    toggleWindow(tray);
  });

  // 右键菜单：每次右键时按最新 tmux 探测结果动态构建，
  // 避免 tmux 安装/卸载后菜单状态不 refresh。
  tray.on('right-click', () => {
    tray.popUpContextMenu(buildTrayContextMenu());
  });
}


function updateTrayIcon() {
  const notifications = store.get('notifications');
  const unreadCount = notifications.filter(n => !n.read).length;

  tray.setImage(loadTrayTemplateImage());
  tray.setTitle(unreadCount > 0 ? ` ${unreadCount}` : '');
}

function openSettingsView() {
  requestedDashboardView = 'settings';
  const window = openMainWindow();
  const navigate = () => {
    if (!window.isDestroyed()) {
      window.webContents.send('dashboard:navigate', 'settings');
    }
  };

  if (window.webContents.isLoadingMainFrame()) {
    window.webContents.once('did-finish-load', navigate);
  } else {
    navigate();
  }
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

  // 关闭窗口
  ipcMain.on('close-window', () => {
    const window = getWindow();
    if (window) {
      window.hide();
    }
  });

  ipcMain.handle('dashboard:get-initial-view', () => requestedDashboardView);
  ipcMain.on('dashboard:set-view', (event, view) => {
    if (view === 'workspace' || view === 'settings') {
      requestedDashboardView = view;
    }
  });

  // 旧通知面板的设置入口现在导航到 dashboard。
  ipcMain.on('open-settings', () => {
    openSettingsView();
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
      const window = getMainWindow();
      if (window && !window.isDestroyed()) {
        window.webContents.send('update-download-progress', progress);
      }
    });
  });

  // 应用更新
  ipcMain.handle('apply-update', () => {
    return updater.applyUpdate();
  });
}
