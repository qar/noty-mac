const test = require('node:test');
const assert = require('node:assert/strict');
const { groupNotifications, notificationGroupKey } = require('../dist/main/notification-groups');

const plane = (id, issueId, timestamp, extra = {}) => ({ id, type: 'plane', channelId: 'plane', title: id,
  message: id, timestamp, read: false, metadata: { plane: { issueId, workspaceSlug: 'rti-tek', ...extra } } });
const tmux = (id, target, timestamp, source = 'project') => ({ id, channelId: 'tmux', title: id,
  message: id, timestamp, read: false, metadata: { tmux: { target }, project: { name: source } } });
const ids = groups => groups.map(group => group.map(item => item.id));

test('interleaved task and pane events group globally with newest groups and entries first', () => {
  const items = [plane('p-old', 'issue-a', 1), tmux('t-new', '%31', 5), plane('p-other', 'issue-b', 3),
    plane('p-new', 'issue-a', 4), tmux('t-old', '%31', 2), tmux('t-other', '%32', 0)];
  const before = structuredClone(items);
  assert.deepEqual(ids(groupNotifications(items)), [['t-new', 't-old'], ['p-new', 'p-old'], ['p-other'], ['t-other']]);
  assert.deepEqual(items, before);
});

test('task IDs stay stable across name changes and identifiers provide a fallback', () => {
  assert.equal(notificationGroupKey(plane('a', 'uuid', 1, { issueIdentifier: 'TRV-1' })),
    notificationGroupKey(plane('b', 'uuid', 2, { issueIdentifier: 'NEW-1', issueName: 'Renamed' })));
  assert.deepEqual(ids(groupNotifications([plane('a', '', 1, { issueIdentifier: 'TRV-0001' }),
    plane('b', '', 2, { issueIdentifier: 'trv-0001' }), plane('c', '', 3, { issueIdentifier: 'TRV-0002' })])), [['c'], ['b', 'a']]);
});

test('different subscriptions, workspaces and reused panes from other projects stay separate', () => {
  const first = plane('a', 'uuid', 1);
  const second = { ...first, id: 'b', channelId: 'other' };
  const third = plane('c', 'uuid', 3, { workspaceSlug: 'other' });
  assert.equal(groupNotifications([first, second, third]).length, 3);
  assert.equal(groupNotifications([tmux('a', '%31', 1), tmux('b', '%31', 2, 'other'), tmux('c', '%32', 3)]).length, 3);
});

test('source pane groups include different review worktrees and legacy message targets', () => {
  const first = tmux('a', '%31', 1, 'review-a');
  const second = tmux('b', '%31', 2, 'review-b');
  first.metadata.tmux.sourceProject = second.metadata.tmux.sourceProject = 'source';
  assert.equal(groupNotifications([first, second]).length, 1);
  const legacy = { ...tmux('legacy', '', 3), message: 'Done\ntmux: %31' };
  assert.equal(notificationGroupKey(legacy), notificationGroupKey(tmux('new', '%31', 4)));
});

test('missing task or pane identities never merge unrelated notifications', () => {
  assert.equal(groupNotifications([plane('a', '', 1), plane('b', '', 2), tmux('c', '', 3), tmux('d', '', 4)]).length, 4);
});
