const Store = require('electron-store');

const schema = {
  desktopWindow: {
    type: 'object',
    default: { view: 'dashboard', pinned: false },
    properties: {
      view: { type: 'string', enum: ['dashboard', 'workspace', 'workflow', 'settings', 'notifications'] },
      pinned: { type: 'boolean' },
      ...Object.fromEntries(['reminderBounds', 'workspaceBounds'].map(key => [key, {
        type: 'object',
        properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number', minimum: 1 }, height: { type: 'number', minimum: 1 } },
        required: ['x', 'y', 'width', 'height'],
      }])),
    },
    required: ['view', 'pinned'],
  },
  channels: {
    type: 'array',
    default: [],
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        url: { type: 'string' },
        type: { type: 'string', enum: ['tmux-agent', 'plane'] },
        planeBaseUrl: { type: 'string' },
        planeWorkspaceSlug: { type: 'string' },
        encryptedAccessToken: { type: 'string' },
        encryptedPlaneApiKey: { type: 'string' }
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
        ntfyId: { type: ['string', 'null'] },
        type: { type: 'string', enum: ['tmux-agent', 'plane'] },
        completedAt: { type: ['number', 'null'] },
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
      hideRead: true,
      projectsDirectory: '',
      worktreesDirectory: ''
    },
    properties: {
      soundEnabled: { type: 'boolean' },
      hideRead: { type: 'boolean' },
      projectsDirectory: { type: 'string' },
      worktreesDirectory: { type: 'string' }
    }
  },
  localAiPrograms: {
    type: 'array',
    default: [],
    maxItems: 32,
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        executable: { type: 'string' },
        args: { type: 'array', items: { type: 'string' } },
        promptMode: { type: 'string', enum: ['argument', 'stdin', 'none'] },
        workingDirectory: { type: 'string' },
        environment: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              value: { type: 'string' },
              secret: { type: 'boolean' }
            },
            required: ['key', 'value', 'secret']
          }
        },
        proxy: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['inherit', 'none', 'custom'] },
            httpProxy: { type: 'string' },
            httpsProxy: { type: 'string' },
            allProxy: { type: 'string' },
            noProxy: { type: 'string' }
          },
          required: ['mode', 'httpProxy', 'httpsProxy', 'allProxy', 'noProxy']
        },
        timeoutMs: { type: 'number', minimum: 1000, maximum: 1800000 },
        enabled: { type: 'boolean' },
        versionArgs: { type: 'array', items: { type: 'string' } }
      },
      required: [
        'id',
        'name',
        'executable',
        'args',
        'promptMode',
        'workingDirectory',
        'environment',
        'proxy',
        'timeoutMs',
        'enabled',
        'versionArgs'
      ]
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
        workingDirectory: { type: ['string', 'null'] },
        directory: { type: 'string' },
        source: { type: 'string' },
        createdAt: { type: 'number' },
        updatedAt: { type: 'number' },
        lastActiveAt: { type: ['number', 'null'] }
      },
      required: ['id', 'name', 'directory', 'source', 'createdAt', 'updatedAt']
    }
  },
  workflowDefinitions: {
    type: 'array',
    default: []
  },
  workflowRuns: {
    type: 'array',
    default: []
  }
};

const store = new Store({ schema });

module.exports = store;
