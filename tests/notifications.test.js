const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {
  channelFromInput, normalizePlaneNotification, planeCommentPreview, safeWebUrl,
  isPendingNotification, retainNotifications, clearReadNotifications, setNotificationCompleted,
} = require('../dist/main/notification-core');

const channel = { id: 'plane', name: 'RtiTek Plane', type: 'plane', url: 'https://ntfy.example/plane', planeBaseUrl: 'https://plane.example' };
const payload = {
  event: 'issue', action: 'updated', workspace_slug: 'rtitek',
  data: { id: 'issue-1', project: 'project-1', name: 'Fix login (mobile)', sequence_id: 42 },
  activity: { field: 'state', old_value: 'Todo', new_value: 'Done', actor: { display_name: 'Anran' } },
};

test('legacy subscriptions default to tmux and Plane configuration is validated', () => {
  assert.deepEqual(channelFromInput('AI', 'my-topic'), { name: 'AI', url: 'https://ntfy.sh/my-topic', type: 'tmux-agent' });
  assert.equal(channelFromInput('', 'https://ntfy.example/topic/', { type: 'plane', planeBaseUrl: 'https://plane.example/' }).planeBaseUrl, 'https://plane.example');
  for (const value of ['', 'file:///tmp/x', 'https://example.com', 'https://example.com/topic?q=1', 'https://user:pass@example.com/topic']) {
    assert.throws(() => channelFromInput('x', value));
  }
  assert.throws(() => channelFromInput('', 'topic', { type: 'plane' }));
  assert.throws(() => channelFromInput('', 'topic', { type: 'other' }));
});

test('Plane issue and comment events resolve to the task and preserve filtering metadata', () => {
  const item = normalizePlaneNotification(channel, JSON.stringify(payload));
  assert.equal(item.title, 'Fix login (mobile)');
  assert.match(item.message, /Anran.*state.*Todo.*Done/);
  assert.equal(item.metadata.plane.url, 'https://plane.example/rtitek/projects/project-1/issues/issue-1');
  assert.equal(item.metadata.plane.field, 'state');
  assert.deepEqual(JSON.parse(item.metadata.plane.rawPayload), payload);

  const comment = normalizePlaneNotification(channel, JSON.stringify({
    ...payload, event: 'issue_comment', action: 'created',
    data: { id: 'comment-1', issue: 'issue-1', project: 'project-1' },
  }));
  assert.equal(comment.metadata.plane.issueId, 'issue-1');
  assert.equal(comment.metadata.plane.url, item.metadata.plane.url);
  const fallback = normalizePlaneNotification({ ...channel, planeWorkspaceSlug: 'fallback' }, JSON.stringify({
    event: 'issue', data: { id: 'i', project: { id: 'p', identifier: 'APP' }, sequence_id: 3, name: 'Task' },
  }));
  assert.equal(fallback.title, 'APP-3 Task');
  assert.equal(fallback.metadata.plane.url, 'https://plane.example/fallback/projects/p/issues/i');
});

test('unknown and malformed events are retained with no invented task destination', () => {
  for (const value of ['not json', 'null', '[]', '{}']) {
    const result = normalizePlaneNotification(channel, value);
    assert.ok(result.metadata.plane.parseError);
    assert.equal(result.metadata.plane.url, null);
    assert.equal(result.metadata.plane.rawPayload, value);
  }
  const project = normalizePlaneNotification(channel, JSON.stringify({ event: 'project', data: { id: 'p' } }));
  assert.equal(project.metadata.plane.url, null);
  const deleted = normalizePlaneNotification(channel, JSON.stringify({ event: 'issue', action: 'deleted', data: { id: 'i' } }));
  assert.equal(deleted.metadata.plane.issueId, 'i');
  assert.equal(deleted.metadata.plane.url, null);
});

test('only HTTP(S) browser links are accepted, with path components encoded', () => {
  for (const value of ['javascript:alert(1)', 'file:///tmp/test', 'https://u:p@example.com', '//example.com']) assert.equal(safeWebUrl(value), null);
  const item = normalizePlaneNotification(channel, JSON.stringify({ ...payload, data: { id: 'a/b?c', project: 'p' } }), 'javascript:alert(1)');
  assert.equal(item.metadata.plane.url, 'https://plane.example/rtitek/projects/p/issues/a%2Fb%3Fc');
  assert.equal(normalizePlaneNotification(channel, '{}', 'https://plane.example/task').metadata.plane.url, 'https://plane.example/task');
});

test('reading, clearing, retention and restart preserve every Plane event until explicit completion', () => {
  const pending = { id: 'p', type: 'plane', read: true, completedAt: null };
  const completed = { id: 'c', type: 'plane', read: true, completedAt: 1 };
  const items = [...Array.from({ length: 1100 }, (_, i) => ({ id: `tmux-${i}`, read: true })), pending, completed];
  const retained = JSON.parse(JSON.stringify(retainNotifications(items)));
  assert.equal(retained.length, 1002);
  assert.deepEqual(clearReadNotifications(retained), [pending, completed]);
  assert.equal(isPendingNotification(pending), true);
  const done = setNotificationCompleted(retained, 'p', true, 123).find(item => item.id === 'p');
  assert.equal(isPendingNotification(done), false);
  const restored = setNotificationCompleted([done], 'p', false)[0];
  assert.equal(isPendingNotification(restored), true);
  assert.equal(restored.completedAt, null);
});

function loadClient(fetchImpl) {
  const state = { notifications: [], settings: { soundEnabled: false }, channels: [] };
  const store = { get: key => structuredClone(state[key]), set: (key, value) => { state[key] = structuredClone(value); } };
  const timers = [];
  const notices = [];
  const nativeNotifications = [];
  class Notification extends require('node:events').EventEmitter {
    static isSupported() { return true; }
    constructor(options) { super(); notices.push(options); nativeNotifications.push(this); }
    show() {}
  }
  const context = {
    module: { exports: {} }, console, AbortController, TextDecoder, Buffer,
    fetch: fetchImpl,
    setTimeout: callback => { const timer = { callback }; timers.push(timer); return timer; },
    clearTimeout: timer => { if (timer) timer.cleared = true; },
    require: name => name === 'electron' ? { Notification } : name === './store' ? store
      : name === './notification-core' ? require('../dist/main/notification-core')
      : name === './plane-attachment' ? require('../dist/main/plane-attachment') : require(name),
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/main/ntfy-client'), 'utf8'), context);
  return { client: new context.module.exports(), state, timers, notices, nativeNotifications };
}

test('ntfy delivery deduplicates per subscription without coalescing events for the same task', () => {
  const { client, state, notices } = loadClient();
  const data = { id: 'event-1', time: 1780000000, message: JSON.stringify(payload) };
  client.handleNotification(channel, data);
  client.handleNotification(channel, data);
  client.handleNotification(channel, { ...data, id: 'event-2' });
  assert.equal(state.notifications.length, 2);
  assert.equal(state.notifications[0].completedAt, null);
  assert.equal(state.notifications[0].timestamp, 1780000000000);
  assert.equal(notices[0].title, 'Fix login (mobile)');
  client.handleNotification({ ...channel, id: 'another-source' }, data);
  assert.equal(state.notifications.length, 3);
  client.handleNotification({ id: 'legacy', name: 'AI' }, { id: 'old', message: 'done\ntmux: %1' });
  assert.equal(state.notifications[0].type, 'tmux-agent');
  assert.equal(state.notifications[0].metadata.tmux.target, '%1');
});

test('ntfy stream reconstructs split UTF-8 JSON, processes final lines and reconnects on EOF', async () => {
  const content = [
    { event: 'open' },
    { event: 'message', id: 'one', message: JSON.stringify({ ...payload, data: { ...payload.data, name: '中文任务' } }) },
    { event: 'message', id: 'two', message: JSON.stringify(payload) },
  ].map(item => JSON.stringify(item)).join('\n');
  const bytes = new TextEncoder().encode(content);
  const { client, state, timers } = loadClient(async () => new Response(new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += 7) controller.enqueue(bytes.slice(offset, offset + 7));
      controller.close();
    },
  })));
  await client.startSSEConnection(channel);
  assert.equal(state.notifications.length, 2);
  assert.equal(state.notifications[1].title, '中文任务');
  assert.equal(timers.length, 1);
  client.unsubscribeFromChannel(channel.id);
  assert.equal(timers[0].cleared, true);
  timers[0].callback();
  assert.equal(client.connections.size, 0);
});

test('Plane JSON attachments are read and persisted instead of the ntfy file placeholder', async () => {
  const raw = JSON.stringify({ event: 'issue_comment', action: 'created',
    data: { id: 'comment', issue: 'task', project: 'project', comment_html: '<p>Test comment</p>' },
    activity: { field: null, actor: { display_name: 'Tester' } },
  });
  const envelope = { event: 'message', id: 'attachment-event', message: 'You received a file: attachment.json',
    attachment: { url: 'https://ntfy.example/file/fixture.json', name: 'attachment.json', size: Buffer.byteLength(raw) },
  };
  const { client, state } = loadClient(async url => new Response(url.includes('/file/') ? raw : JSON.stringify(envelope) + '\n'));
  await client.startSSEConnection({ ...channel, planeWorkspaceSlug: 'rtitek' });
  assert.equal(state.notifications[0].metadata.plane.rawPayload, raw);
  assert.equal(state.notifications[0].metadata.plane.url, 'https://plane.example/rtitek/projects/project/issues/task');
  assert.equal(state.notifications[0].read, false);
});

test('comment payloads without a workspace slug retain their complete body and use configured workspace', () => {
  const raw = fs.readFileSync(require.resolve('./fixtures/plane-comment.json'), 'utf8');
  const withoutWorkspace = normalizePlaneNotification(channel, raw);
  assert.equal(withoutWorkspace.metadata.plane.url, null);
  assert.equal(withoutWorkspace.metadata.plane.rawPayload, raw);
  const withWorkspace = normalizePlaneNotification({ ...channel, planeWorkspaceSlug: 'company' }, raw);
  assert.equal(withWorkspace.metadata.plane.url, 'https://plane.example/company/projects/55555555-5555-4555-8555-555555555555/issues/77777777-7777-4777-8777-777777777777');
  assert.equal(JSON.parse(withWorkspace.metadata.plane.rawPayload).data.comment_html, '<p>测试评论</p><p>Raw comment content.</p>');
});

test('comment previews extract readable HTML text and preserve complete raw payloads in native notifications', () => {
  const raw = JSON.stringify({ event: 'issue_comment', action: 'created', data: {
    comment_html: '<p>修复 <strong>App</strong> &amp; Web</p><p>详情<br><a href="https://example.com">查看任务</a></p><script>alert(1)</script><style>p{color:red}</style><img src="https://example.com/track" onerror="alert(1)">',
  } });
  const expected = '修复 App & Web 详情 查看任务';
  assert.equal(planeCommentPreview(raw), expected);
  const { client, state, notices } = loadClient();
  client.handleNotification(channel, { id: 'comment-preview', message: raw });
  assert.equal(notices[0].body, expected);
  assert.equal(state.notifications[0].metadata.plane.rawPayload, raw);
  assert.equal(state.notifications[0].read, false);
  assert.equal(state.notifications[0].completedAt, null);
});

test('comment previews truncate at 200 user-visible characters without splitting Unicode sequences', () => {
  const prefix = '中'.repeat(198) + 'e\u0301' + '\u{1F469}\u200D\u{1F4BB}';
  for (const suffix of ['', '多余内容']) {
    const raw = JSON.stringify({ event: 'issue_comment', data: { comment_stripped: prefix + suffix, comment_html: '<p>Fallback</p>' } });
    assert.equal(planeCommentPreview(raw), prefix + (suffix ? '…' : ''));
  }
  const longUnicode = '\u{1F469}\u200D\u{1F4BB}'.repeat(201);
  const { client, notices } = loadClient();
  client.handleNotification(channel, { id: 'unicode-preview', message: JSON.stringify({ event: 'issue_comment', data: { comment_stripped: longUnicode } }) });
  assert.equal(notices[0].body, '\u{1F469}\u200D\u{1F4BB}'.repeat(200) + '…');
  for (const raw of ['invalid', 'null', '{}', JSON.stringify({ event: 'issue', data: { comment_stripped: 'Not a comment event' } }), JSON.stringify({ event: 'issue_comment', data: { comment_html: '<p><br></p>' } })]) {
    assert.equal(planeCommentPreview(raw), null);
  }
});

test('expired attachments remain pending and retry repairs the same local item without new alerts', async () => {
  let expired = true;
  const raw = JSON.stringify(require('./fixtures/plane-comment.json'));
  const { client, state, notices } = loadClient(async () => expired ? new Response('', { status: 410 }) : new Response(raw));
  state.channels.push(channel);
  await client.receiveNotification(channel, { id: 'retry', message: 'You received a file: attachment.json',
    attachment: { url: 'https://ntfy.example/file/comment.json', name: 'attachment.json' },
  });
  const saved = state.notifications[0];
  assert.equal(saved.read, false);
  assert.equal(saved.completedAt, null);
  assert.equal(saved.metadata.plane.attachment.status, 'error');
  assert.match(saved.metadata.plane.attachment.error, /过期/);
  saved.read = true;
  saved.completedAt = 123;
  expired = false;
  await client.retryAttachment(saved.id);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].id, saved.id);
  assert.equal(state.notifications[0].read, true);
  assert.equal(state.notifications[0].completedAt, 123);
  assert.equal(state.notifications[0].metadata.plane.rawPayload, raw);
  assert.equal(state.notifications[0].metadata.plane.attachment.status, 'loaded');
  assert.equal(notices.length, 1);
});

test('cached historical attachment messages are backfilled without duplicating or acknowledging them', async () => {
  const raw = JSON.stringify(require('./fixtures/plane-comment.json'));
  const envelope = { event: 'message', id: 'old-file', message: 'You received a file: attachment.json',
    attachment: { url: 'https://ntfy.example/file/old.json', name: 'attachment.json' },
  };
  const requests = [];
  const { client, state, notices } = loadClient(async url => {
    requests.push(url);
    return new Response(url.includes('/file/') ? raw : JSON.stringify(envelope) + '\n');
  });
  state.notifications.push({ id: 'local-id', ntfyId: 'old-file', channelId: channel.id, type: 'plane',
    read: false, completedAt: null, timestamp: Date.now(), metadata: { plane: { parseError: 'invalid JSON' } },
  });
  await client.startSSEConnection(channel);
  assert.match(requests[0], /since=all/);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].id, 'local-id');
  assert.equal(state.notifications[0].read, false);
  assert.equal(state.notifications[0].metadata.plane.rawPayload, raw);
  assert.equal(notices.length, 0);
});

test('native notification callbacks stay alive until close and clicks do not acknowledge content', () => {
  const { client, state, nativeNotifications } = loadClient();
  let clicked;
  client.on('notification-clicked', item => { clicked = item.id; });
  client.handleNotification(channel, { id: 'native', message: JSON.stringify(payload) });
  const saved = structuredClone(state.notifications);
  assert.equal(client.systemNotifications.size, 1);
  nativeNotifications[0].emit('click');
  assert.equal(clicked, saved[0].id);
  assert.deepEqual(state.notifications, saved);
  nativeNotifications[0].emit('close');
  assert.equal(client.systemNotifications.size, 0);
});
