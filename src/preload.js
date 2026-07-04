const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('api', {
  // 通知相关
  getNotifications: () => ipcRenderer.invoke('get-notifications'),
  markAsRead: (id) => ipcRenderer.invoke('mark-as-read', id),
  markManyAsRead: (ids) => ipcRenderer.invoke('mark-many-as-read', ids),
  markAllAsRead: () => ipcRenderer.invoke('mark-all-as-read'),
  jumpToNotificationTarget: (id, options) => ipcRenderer.invoke('jump-to-notification-target', id, options),
  clearRead: () => ipcRenderer.invoke('clear-read'),

  // 频道相关
  getChannels: () => ipcRenderer.invoke('get-channels'),
  addChannel: (name, url) => ipcRenderer.invoke('add-channel', name, url),
  removeChannel: (id) => ipcRenderer.invoke('remove-channel', id),

  // 设置相关
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings) => ipcRenderer.invoke('update-settings', settings),

  // 窗口控制
  closeWindow: () => ipcRenderer.send('close-window'),
  openSettings: () => ipcRenderer.send('open-settings'),

  // 监听新通知
  onNewNotification: (callback) => {
    ipcRenderer.on('new-notification', (event, notification) => callback(notification));
  },

  // 监听窗口显示事件
  onWindowShown: (callback) => {
    ipcRenderer.on('window-shown', () => callback());
  },

  onNotificationJumped: (callback) => {
    ipcRenderer.on('notification-jumped', (event, id) => callback(id));
  },

  // 更新相关
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  applyUpdate: () => ipcRenderer.invoke('apply-update'),
  onUpdateDownloadProgress: (callback) => {
    ipcRenderer.on('update-download-progress', (event, progress) => callback(progress));
  },

  // 工作区 (Workspace) —— Step 3d
  workspace: {
    list: () => ipcRenderer.invoke('workspace:list'),
    syncFromTmux: () => ipcRenderer.invoke('workspace:sync-tmux'),
    jump: (id) => ipcRenderer.invoke('workspace:jump', id),
    openInFinder: (id) => ipcRenderer.invoke('workspace:open-in-finder', id),
    rename: (id, name) => ipcRenderer.invoke('workspace:rename', id, name),
    remove: (id, opts) => ipcRenderer.invoke('workspace:remove', id, opts),
    onUpdated: (callback) => {
      ipcRenderer.on('workspace:updated', () => callback());
    }
  }
});
