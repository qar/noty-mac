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
            plane: {
              type: 'object',
              properties: {
                workItemId: { type: 'string' },
                projectId: { type: 'string' },
                workspaceSlug: { type: 'string' },
                identifier: { type: 'string' },
                sequenceId: {},
                url: { type: 'string' },
                kind: { type: 'string' },
                dedupKey: { type: 'string' }
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
  planeConfig: {
    type: 'object',
    default: {
      enabled: false,
      baseUrl: '',
      workspaceSlug: '',
      email: '',
      apiKeyEnc: '',
      resolvedUserId: '',
      pollIntervalMs: 90000
    },
    properties: {
      enabled: { type: 'boolean' },
      baseUrl: { type: 'string' },
      workspaceSlug: { type: 'string' },
      email: { type: 'string' },
      apiKeyEnc: { type: 'string' },
      resolvedUserId: { type: 'string' },
      pollIntervalMs: { type: 'number' }
    }
  },
  // 轮询状态机的持久化记忆，结构随 Plane 字段演进保持宽松
  planeState: {
    type: 'object',
    default: {
      baselineDone: false,
      items: {}
    },
    additionalProperties: true
  }
};

const store = new Store({ schema });

module.exports = store;
