const Store = require('electron-store');

const schema = {
  channels: {
    type: 'array',
    default: [],
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        url: { type: 'string' }
      },
      required: ['id', 'name', 'url']
    }
  },
  notifications: {
    type: 'array',
    default: [],
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        ntfyId: { type: 'string' },
        channelId: { type: 'string' },
        title: { type: 'string' },
        message: { type: 'string' },
        timestamp: { type: 'number' },
        read: { type: 'boolean' }
      },
      required: ['id', 'channelId', 'message', 'timestamp', 'read']
    }
  },
  settings: {
    type: 'object',
    default: {
      soundEnabled: true,
      hideRead: true
    },
    properties: {
      soundEnabled: { type: 'boolean' },
      hideRead: { type: 'boolean' }
    }
  }
};

const store = new Store({ schema });

module.exports = store;
