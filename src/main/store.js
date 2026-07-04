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
        read: { type: 'boolean' },
        metadata: {
          type: 'object',
          properties: {
            tmux: {
              type: 'object',
              properties: {
                target: { type: 'string' },
                session: { type: 'string' },
                window: { type: 'string' },
                pane: { type: 'string' }
              }
            },
            chainTestApp: { type: 'string' }
          }
        }
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
  },
  workspaces: {
    type: 'array',
    default: [],
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        tmuxSessionName: { type: ['string', 'null'] },
        directory: { type: 'string' },
        source: { type: 'string' },
        createdAt: { type: 'number' },
        updatedAt: { type: 'number' },
        lastActiveAt: { type: ['number', 'null'] }
      },
      required: ['id', 'name', 'directory', 'source', 'createdAt', 'updatedAt']
    }
  }
};

const store = new Store({ schema });

module.exports = store;
