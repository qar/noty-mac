const { app, Tray, Menu, ipcMain, nativeImage, Notification, shell, safeStorage } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const NtfyClient = require('./ntfy-client');
const { channelFromInput, safeWebUrl, isPendingNotification, clearReadNotifications, setNotificationCompleted, setNotificationsDismissed } = require('./notification-core');
const Updater = require('./updater');
const { toggleWindow, showNotification, getSelectedNotificationId, getWindow } = require('./window');
const { openMainWindow, hideMainWindow, getMainWindow, destroyMainWindow, getMainWindowView, setMainWindowView, getReminderPinned, setReminderPinned } = require('./main-window');
const workspace = require('./workspace');
const { probeTmux } = require('./tmux-probe');
const { registerWorkspaceIpc } = require('./ipc-workspace');
const { registerIntegrationIpc } = require('./ipc-integration');
const { registerLocalAiIpc } = require('./ipc-local-ai');
const { registerSettingsIpc } = require('./ipc-settings');
const { registerProjectsIpc } = require('./ipc-projects');
const { registerWorkflowIpc } = require('./ipc-workflow');
const { recoverNotificationTarget } = require('./tmux-notification-target');
const { setDockIcon } = require('./app-icon');
const {
  TMUX_SESSION_SNAPSHOT_FORMAT,
  parseTmuxSessionSnapshots,
  TMUX_PANE_SNAPSHOT_FORMAT,
  parseTmuxPaneSnapshots,
} = require('./tmux-workspace');

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

async function openNotificationTarget(notification, options = {}) {
  if (notification?.type === 'plane') {
    const url = safeWebUrl(notification.metadata?.plane?.url);
    if (!url) return { success: false, reason: '消息缺少任务链接，请检查 Plane 网站地址和工作区配置' };
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch {
      return { success: false, reason: '无法打开浏览器，请重试' };
    }
  }
  let target = resolveNotificationTmuxTarget(notification);
  const expectedProject = notification?.metadata?.tmux?.sourceProject || notification?.metadata?.project?.name;
  let invalidReason;
  if (target && expectedProject) {
    try {
      const checkout = await readNotificationCheckout(target);
      if (!checkout || path.basename(checkout.root) !== expectedProject) {
        invalidReason = checkout ? 'source_project_mismatch' : 'source_project_unverified';
        target = null;
      }
    } catch {
      invalidReason = 'source_project_unverified';
      target = null;
    }
  }
  let recovered;
  if (!target) {
    try {
      const [snapshot, processes] = await Promise.all([
        execTmux(['list-panes', '-a', '-F', TMUX_PANE_SNAPSHOT_FORMAT]), listProcesses(),
      ]);
      recovered = await recoverNotificationTarget(notification, parseTmuxPaneSnapshots(snapshot), processes, readNotificationCheckout);
      if (!recovered.target) return { success: false, reason: recovered.reason === 'no_target' ? invalidReason || recovered.reason : recovered.reason };
      target = recovered.target;
    } catch {
      return { success: false, reason: 'source_unavailable' };
    }
  }
  const chainTestApp = options.chainTestApp || notification?.metadata?.chainTestApp || null;
  return jumpToTmuxTarget(target, { chainTestApp,
    expectedProject,
    expectedCheckout: recovered?.checkout });
}

async function readNotificationCheckout(target) {
  const panePath = await execTmux(['display-message', '-p', '-t', target, '#{pane_current_path}']);
  const git = (args) => new Promise(resolve => {
    execFile('/usr/bin/git', ['-C', panePath, ...args], { timeout: 5000 }, (error, stdout) => resolve(error ? null : stdout.trim()));
  });
  const root = await git(['rev-parse', '--show-toplevel']);
  if (!root) return null;
  const branch = await git(['branch', '--show-current']);
  return branch === null ? null : { root, branch };
}

function publicChannels() {
  return store.get('channels').map(({ encryptedAccessToken, encryptedPlaneApiKey, ...channel }) => ({
    ...channel,
    type: channel.type || 'tmux-agent',
    hasAccessToken: Boolean(encryptedAccessToken),
    hasPlaneApiKey: Boolean(encryptedPlaneApiKey),
  }));
}

function notificationsChanged() {
  updateTrayIcon();
  sendToNotificationWindows('notifications-updated');
}

function sendToNotificationWindows(event, ...args) {
  for (const window of [getWindow(), getMainWindow()]) {
    if (window && !window.isDestroyed()) window.webContents.send(event, ...args);
  }
}

function dismissNotifications(ids, dismissed) {
  const notifications = setNotificationsDismissed(store.get('notifications'), ids, dismissed);
  store.set('notifications', notifications);
  notificationsChanged();
  return notifications;
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

function listProcesses() {
  return new Promise((resolve, reject) => {
    execFile('/bin/ps', ['-A', '-o', 'pid=,ppid=,comm='], { timeout: 5000 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout || '');
    });
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
    if (options.expectedCheckout) {
      const current = await readNotificationCheckout(target);
      if (!current || current.root !== options.expectedCheckout.root || current.branch !== options.expectedCheckout.branch) {
        return { success: false, reason: 'source_project_unverified' };
      }
    }
    if (options.expectedProject) {
      const panePath = await execTmux(['display-message', '-p', '-t', target, '#{pane_current_path}']);
      const projectRoot = await new Promise(resolve => {
        execFile('/usr/bin/git', ['-C', panePath, 'rev-parse', '--show-toplevel'], { timeout: 5000 }, (error, stdout) => {
          resolve(error ? null : stdout.trim());
        });
      });
      if (!projectRoot) return { success: false, reason: 'source_project_unverified' };
      if (path.basename(projectRoot) !== options.expectedProject) {
        return { success: false, reason: 'source_project_mismatch' };
      }
    }
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
    jumpToTmuxPane: jumpToTmuxTarget,
    listTmuxPanes: (format) => execTmux(['list-panes', '-a', '-F', format]),
    listProcesses,
    capturePaneDigest: async (paneId) => crypto.createHash('sha256')
      .update(await execTmux(['capture-pane', '-p', '-t', paneId, '-S', '-40']))
      .digest('hex'),
    syncTmuxToWorkspaces,
  });
  registerIntegrationIpc();
  registerLocalAiIpc();
  registerSettingsIpc();
  registerProjectsIpc();
  registerWorkflowIpc();
  if (process.argv.includes('--show-notifications')) {
    openNotificationsView();
  } else if (process.argv.includes('--show-main-window')) {
    openMainWindow();
  }
  updateTrayIcon();

  updater = new Updater();
  updater.cleanupStagingDir();

  // 初始化 ntfy 客户端
  ntfyClient = new NtfyClient();

  // 监听新通知事件
  ntfyClient.on('notification', (notification) => {
    updateTrayIcon();

    // 通知渲染进程
    sendToNotificationWindows('new-notification', notification);
  });

  ntfyClient.on('notification-clicked', (notification) => showNotification(tray, notification.id));
  ntfyClient.on('notification-updated', notificationsChanged);

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
// Reads local tmux session names and each active pane directory, hands the
// snapshots to the workspace data layer for idempotent reconciliation, then
// posts a system notification summarising the delta (Q6 decision).
// Red-line §11: this only runs a READ-ONLY tmux command; workspace.js
// side-effects are limited to its own uuid directories.
// -----------------------------------------------------------------------
async function syncTmuxToWorkspaces() {
  let sessions = [];
  try {
    const stdout = await execTmux([
      'list-sessions',
      '-F',
      TMUX_SESSION_SNAPSHOT_FORMAT
    ]);
    sessions = parseTmuxSessionSnapshots(stdout);
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
      sessions = [];
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
    result = await workspace.syncFromTmux(sessions);
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
    body: `新增 ${result.added}，跳过 ${result.skipped}（共 ${sessions.length} 个 tmux session）`
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
  tray.setToolTip('Noty - AI agent 与 Plane 通知');

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
  const unreadCount = notifications.filter(isPendingNotification).length;

  tray.setImage(loadTrayTemplateImage());
  tray.setTitle(unreadCount > 0 ? ` ${unreadCount}` : '');
}

let requestedSettingsTab = 'general';

function openSettingsView(tab = 'general') {
  requestedSettingsTab = tab;
  setMainWindowView('settings');
  const window = openMainWindow();
  const navigate = () => {
    if (!window.isDestroyed()) {
      window.webContents.send('dashboard:navigate', 'settings', requestedSettingsTab);
    }
  };

  if (window.webContents.isLoadingMainFrame()) {
    window.webContents.once('did-finish-load', navigate);
  } else {
    navigate();
  }
}

function openNotificationsView() {
  setMainWindowView('notifications');
  const window = openMainWindow();
  const navigate = () => { if (!window.isDestroyed()) window.webContents.send('dashboard:navigate', 'notifications'); };
  if (window.webContents.isLoadingMainFrame()) window.webContents.once('did-finish-load', navigate);
  else navigate();
  getWindow()?.hide();
}

function setupIPC() {
  ipcMain.handle('get-selected-notification', () => getSelectedNotificationId());
  ipcMain.handle('retry-notification-attachment', async (_event, id) => {
    if (!ntfyClient || typeof id !== 'string') throw new Error('无法重试正文附件');
    await ntfyClient.retryAttachment(id);
  });
  // 获取通知列表
  ipcMain.handle('get-notifications', async () => {
    ntfyClient?.refreshPlaneNotifications();
    let sessions = new Map();
    if (store.get('notifications').some(item => item.type !== 'plane' && resolveNotificationTmuxTarget(item))) {
      try {
        const output = await execTmux(['list-panes', '-a', '-F', '#{pane_id}\t#{session_name}']);
        sessions = new Map(output.split('\n').map(line => line.split('\t')).filter(parts => parts.length === 2));
      } catch {
        // Notifications remain readable when tmux is stopped or unavailable.
      }
    }
    return store.get('notifications').map(item => {
      if (item.type === 'plane') return item;
      const target = resolveNotificationTmuxTarget(item);
      if (!target) return item;
      return { ...item, metadata: { ...item.metadata, tmux: {
        ...item.metadata?.tmux, target, session: sessions.get(target) || item.metadata?.tmux?.session,
      } } };
    });
  });

  // 标记已读
  ipcMain.handle('mark-as-read', (event, id) => {
    const notifications = store.get('notifications');
    const notification = notifications.find(n => n.id === id);
    if (notification) {
      notification.read = true;
      store.set('notifications', notifications);
      notificationsChanged();
    }
    return notifications;
  });

  // 全部标记为已读
  ipcMain.handle('mark-all-as-read', () => {
    const notifications = store.get('notifications');
    notifications.forEach(n => { n.read = true; });
    store.set('notifications', notifications);
    notificationsChanged();
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
      notificationsChanged();
    }
    return notifications;
  });

  // 清空已读
  ipcMain.handle('clear-read', () => {
    const notifications = clearReadNotifications(store.get('notifications'));
    store.set('notifications', notifications);
    notificationsChanged();
    return notifications;
  });

  ipcMain.handle('set-notification-completed', (_event, id, completed) => {
    if (typeof id !== 'string' || typeof completed !== 'boolean') throw new Error('通知状态无效');
    const notifications = setNotificationCompleted(store.get('notifications'), id, completed);
    store.set('notifications', notifications);
    notificationsChanged();
    return notifications;
  });

  ipcMain.handle('set-notifications-dismissed', (_event, ids, dismissed) => {
    if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string') || typeof dismissed !== 'boolean') throw new Error('提醒状态无效');
    return dismissNotifications(ids, dismissed);
  });

  // Only reminders visible in the clicked group are dismissed after navigation.
  ipcMain.handle('jump-to-notification-target', async (event, id, options = {}) => {
    const notifications = store.get('notifications');
    const notification = notifications.find(n => n.id === id);
    if (!notification) return { success: false, reason: '提醒已不存在' };
    options = options && typeof options === 'object' ? options : {};
    const relatedIds = new Set(Array.isArray(options.notificationIds) ? options.notificationIds : []);
    const target = resolveNotificationTmuxTarget(notification);
    const ids = notifications.filter(item => item.id === id || (notification.type !== 'plane' && target
      && relatedIds.has(item.id) && item.type !== 'plane' && item.channelId === notification.channelId
      && item.metadata?.project?.name === notification.metadata?.project?.name
      && item.metadata?.tmux?.sourceProject === notification.metadata?.tmux?.sourceProject
      && resolveNotificationTmuxTarget(item) === target)).map(item => item.id);
    const result = await openNotificationTarget(notification, options);
    if (result.success) dismissNotifications(ids, true);
    return result;
  });

  // 获取频道列表
  ipcMain.handle('get-channels', () => {
    return publicChannels();
  });

  // 添加频道
  ipcMain.handle('add-channel', (event, name, url, options = {}) => {
    const channels = store.get('channels');
    const channel = {
      id: generateId(),
      ...channelFromInput(name, url, options),
    };
    if (channels.some(c => c.url.replace(/\/+$/, '') === channel.url)) throw new Error('该 ntfy 频道已存在');
    if (typeof options.accessToken === 'string' && options.accessToken.trim()) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，无法保存访问令牌');
      channel.encryptedAccessToken = safeStorage.encryptString(options.accessToken.trim()).toString('base64');
    }
    if (channel.type === 'plane' && typeof options.planeApiKey === 'string' && options.planeApiKey.trim()) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，无法保存 Plane API 密钥');
      channel.encryptedPlaneApiKey = safeStorage.encryptString(options.planeApiKey.trim()).toString('base64');
    }

    channels.push(channel);
    store.set('channels', channels);

    // 订阅新频道
    if (ntfyClient) {
      ntfyClient.subscribeToChannel(channel);
    }
    notificationsChanged();

    return publicChannels();
  });

  ipcMain.handle('set-plane-api-key', (_event, id, apiKey) => {
    const channels = store.get('channels');
    const channel = channels.find(source => source.id === id && source.type === 'plane');
    if (!channel || typeof apiKey !== 'string') throw new Error('通知来源无效');
    if (apiKey.trim()) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，无法保存 Plane API 密钥');
      channel.encryptedPlaneApiKey = safeStorage.encryptString(apiKey.trim()).toString('base64');
    } else {
      // An explicit empty value also prevents re-importing a legacy credential.
      channel.encryptedPlaneApiKey = '';
    }
    store.set('channels', channels);
    ntfyClient?.resetPlaneDetails();
    return publicChannels();
  });

  // 删除频道
  ipcMain.handle('remove-channel', (event, id) => {
    const channels = store.get('channels').filter(c => c.id !== id);
    store.set('channels', channels);

    // 取消订阅
    if (ntfyClient) {
      ntfyClient.unsubscribeFromChannel(id);
    }
    notificationsChanged();

    return publicChannels();
  });

  // 关闭窗口
  ipcMain.on('close-window', () => {
    const window = getWindow();
    if (window) {
      window.hide();
    }
  });

  ipcMain.handle('dashboard:get-initial-view', () => getMainWindowView());
  ipcMain.handle('dashboard:get-settings-tab', () => requestedSettingsTab);
  ipcMain.on('dashboard:set-view', (event, view) => {
    if (view === 'dashboard' || view === 'workspace' || view === 'workflow' || view === 'settings' || view === 'notifications') {
      setMainWindowView(view);
    }
  });

  // 旧通知面板的设置入口现在导航到 dashboard。
  ipcMain.on('open-settings', () => {
    openSettingsView();
  });
  ipcMain.on('open-notification-settings', () => openSettingsView('channels'));
  ipcMain.on('open-notifications', () => openNotificationsView());
  ipcMain.handle('desktop:get-pinned', () => getReminderPinned());
  ipcMain.handle('desktop:set-pinned', (_event, pinned) => {
    if (typeof pinned !== 'boolean') throw new Error('窗口置顶状态无效');
    return setReminderPinned(pinned);
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
