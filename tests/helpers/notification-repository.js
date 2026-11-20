const { isPendingNotification, clearReadNotifications, setNotificationsDismissed, setNotificationCompleted } = require('../../dist/main/notification-core');

module.exports = function notificationRepository(state) {
  return {
    async list({ pendingOnly = false, channelId, type } = {}) {
      return structuredClone(state.notifications.filter(item => (!pendingOnly || isPendingNotification(item))
        && (channelId === undefined || item.channelId === channelId) && (type === undefined || item.type === type)));
    },
    async get(id) { return structuredClone(state.notifications.find(item => item.id === id)); },
    async findNtfy(channelId, ntfyId) {
      return structuredClone(state.notifications.find(item => item.channelId === channelId && item.ntfyId === ntfyId));
    },
    async insert(item) {
      const duplicate = state.notifications.some(existing => existing.id === item.id || existing.channelId === item.channelId
        && (item.ntfyId && existing.ntfyId === item.ntfyId || item.metadata?.plane?.deliveryId
          && existing.metadata?.plane?.deliveryId === item.metadata.plane.deliveryId));
      if (duplicate) return false;
      state.notifications.unshift(structuredClone(item));
      return true;
    },
    async updateContent(items) {
      let count = 0;
      for (const item of items) {
        const index = state.notifications.findIndex(existing => existing.id === item.id);
        if (index < 0) continue;
        const current = state.notifications[index];
        state.notifications[index] = { ...structuredClone(item), read: current.read,
          ...(Object.hasOwn(current, 'completedAt') ? { completedAt: current.completedAt } : {}) };
        count++;
      }
      return count;
    },
    async markRead(ids = null) {
      for (const item of state.notifications) if (ids === null || ids.includes(item.id)) item.read = true;
    },
    async dismiss(ids, dismissed) { state.notifications = setNotificationsDismissed(state.notifications, ids, dismissed); },
    async complete(id, completed) { state.notifications = setNotificationCompleted(state.notifications, id, completed); },
    async clearRead() { state.notifications = clearReadNotifications(state.notifications); },
  };
};
