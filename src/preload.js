const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('api', {
  // 通知相关
  getNotifications: () => ipcRenderer.invoke('get-notifications'),
  getSelectedNotification: () => ipcRenderer.invoke('get-selected-notification'),
  retryNotificationAttachment: (id) => ipcRenderer.invoke('retry-notification-attachment', id),
  markAsRead: (id) => ipcRenderer.invoke('mark-as-read', id),
  markManyAsRead: (ids) => ipcRenderer.invoke('mark-many-as-read', ids),
  markAllAsRead: () => ipcRenderer.invoke('mark-all-as-read'),
  jumpToNotificationTarget: (id, options) => ipcRenderer.invoke('jump-to-notification-target', id, options),
  clearRead: () => ipcRenderer.invoke('clear-read'),
  setNotificationCompleted: (id, completed) => ipcRenderer.invoke('set-notification-completed', id, completed),
  onNotificationsUpdated: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('notifications-updated', listener);
    return () => ipcRenderer.removeListener('notifications-updated', listener);
  },

  // 频道相关
  getChannels: () => ipcRenderer.invoke('get-channels'),
  addChannel: (name, url, options) => ipcRenderer.invoke('add-channel', name, url, options),
  removeChannel: (id) => ipcRenderer.invoke('remove-channel', id),

  // 设置相关
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings) => ipcRenderer.invoke('update-settings', settings),
  selectProjectsDirectory: (currentValue) =>
    ipcRenderer.invoke('select-projects-directory', currentValue),
  saveProjectsDirectory: (directory) =>
    ipcRenderer.invoke('save-projects-directory', directory),
  selectWorktreesDirectory: (currentValue) =>
    ipcRenderer.invoke('select-worktrees-directory', currentValue),
  saveWorktreesDirectory: (directory) =>
    ipcRenderer.invoke('save-worktrees-directory', directory),

  // 窗口控制
  closeWindow: () => ipcRenderer.send('close-window'),
  openSettings: () => ipcRenderer.send('open-settings'),
  openNotificationSettings: () => ipcRenderer.send('open-notification-settings'),

  // 监听新通知
  onNewNotification: (callback) => {
    const listener = (event, notification) => callback(notification);
    ipcRenderer.on('new-notification', listener);
    return () => ipcRenderer.removeListener('new-notification', listener);
  },

  // 监听窗口显示事件
  onWindowShown: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('window-shown', listener);
    return () => ipcRenderer.removeListener('window-shown', listener);
  },

  onNotificationSelected: (callback) => {
    const listener = (event, id) => callback(id);
    ipcRenderer.on('notification-selected', listener);
    return () => ipcRenderer.removeListener('notification-selected', listener);
  },

  // 更新相关
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  applyUpdate: () => ipcRenderer.invoke('apply-update'),
  onUpdateDownloadProgress: (callback) => {
    const listener = (event, progress) => callback(progress);
    ipcRenderer.on('update-download-progress', listener);
    return () => ipcRenderer.removeListener('update-download-progress', listener);
  },

  dashboard: {
    getInitialView: () => ipcRenderer.invoke('dashboard:get-initial-view'),
    getSettingsTab: () => ipcRenderer.invoke('dashboard:get-settings-tab'),
    setView: (view) => ipcRenderer.send('dashboard:set-view', view),
    onNavigate: (callback) => {
      const listener = (event, view, settingsTab) => callback(view, settingsTab);
      ipcRenderer.on('dashboard:navigate', listener);
      return () => ipcRenderer.removeListener('dashboard:navigate', listener);
    }
  },

  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    onUpdated: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('projects:updated', listener);
      return () => ipcRenderer.removeListener('projects:updated', listener);
    }
  },

  // 工作区 (Workspace) —— Step 3d
  workspace: {
    list: () => ipcRenderer.invoke('workspace:list'),
    activeAiPanes: () => ipcRenderer.invoke('workspace:active-ai-panes'),
    jumpPane: (paneId) => ipcRenderer.invoke('workspace:jump-pane', paneId),
    syncFromTmux: () => ipcRenderer.invoke('workspace:sync-tmux'),
    jump: (id) => ipcRenderer.invoke('workspace:jump', id),
    openInFinder: (id) => ipcRenderer.invoke('workspace:open-in-finder', id),
    rename: (id, name) => ipcRenderer.invoke('workspace:rename', id, name),
    remove: (id, opts) => ipcRenderer.invoke('workspace:remove', id, opts),
    onUpdated: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('workspace:updated', listener);
      return () => ipcRenderer.removeListener('workspace:updated', listener);
    }
  },

  workflow: {
    snapshot: () => ipcRenderer.invoke('workflow:snapshot'),
    save: (definition) => ipcRenderer.invoke('workflow:save', definition),
    createRun: (id, input) => ipcRenderer.invoke('workflow:create-run', id, input),
    completeTask: (runId, taskId, input) => ipcRenderer.invoke('workflow:complete-task', runId, taskId, input),
    skipTask: (runId, taskId, reason) => ipcRenderer.invoke('workflow:skip-task', runId, taskId, reason),
    executeTask: (runId, taskId) => ipcRenderer.invoke('workflow:execute-task', runId, taskId),
    cancelTask: (runId, taskId) => ipcRenderer.invoke('workflow:cancel-task', runId, taskId),
    cleanupRun: (runId) => ipcRenderer.invoke('workflow:cleanup-run', runId),
    onUpdated: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('workflow:updated', listener);
      return () => ipcRenderer.removeListener('workflow:updated', listener);
    },
    onTaskOutput: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('workflow:task-output', listener);
      return () => ipcRenderer.removeListener('workflow:task-output', listener);
    }
  },

  // AI 集成向导 (Settings > AI 集成)
  integration: {
    detect: () => ipcRenderer.invoke('integration:detect'),
    copy: (text) => ipcRenderer.invoke('integration:copy', text),
    openClaudeDir: () => ipcRenderer.invoke('integration:open-claude-dir')
  },

  // 本地 AI 程序 (Settings > 本地 AI)
  localAi: {
    list: () => ipcRenderer.invoke('local-ai:list'),
    create: (templateId) => ipcRenderer.invoke('local-ai:create', templateId),
    duplicate: (id) => ipcRenderer.invoke('local-ai:duplicate', id),
    save: (program) => ipcRenderer.invoke('local-ai:save', program),
    remove: (id) => ipcRenderer.invoke('local-ai:remove', id),
    detect: (id) => ipcRenderer.invoke('local-ai:detect', id),
    run: (id, prompt, runId) => ipcRenderer.invoke('local-ai:run', id, prompt, runId),
    cancel: (runId) => ipcRenderer.invoke('local-ai:cancel', runId),
    onOutput: (callback) => {
      const listener = (event, payload) => callback(payload);
      ipcRenderer.on('local-ai:output', listener);
      return () => ipcRenderer.removeListener('local-ai:output', listener);
    },
    onFinished: (callback) => {
      const listener = (event, payload) => callback(payload);
      ipcRenderer.on('local-ai:finished', listener);
      return () => ipcRenderer.removeListener('local-ai:finished', listener);
    }
  }
});
