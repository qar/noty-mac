const test = require('node:test');
const assert = require('node:assert/strict');
const { recoverNotificationTarget } = require('../dist/main/tmux-notification-target');

const notification = { title: 'Codex update', metadata: { project: { name: 'source', branch: 'feature' } } };
const panes = [{ id: '%1', pid: 100 }, { id: '%2', pid: 200 }];
const processes = '100 1 zsh\n101 100 codex\n200 1 zsh\n201 200 claude';
const checkout = { root: '/work/source', branch: 'feature' };

test('recovery requires both project and branch, and the matching sender agent', async () => {
  for (const current of [{ ...checkout, root: '/work/other' }, { ...checkout, branch: 'other' }]) {
    assert.equal((await recoverNotificationTarget(notification, panes, processes, async () => current)).reason, 'source_unavailable');
  }
  const visited = [];
  const result = await recoverNotificationTarget(notification, panes, processes, async target => { visited.push(target); return checkout; });
  assert.equal(result.target, '%1');
  assert.deepEqual(visited, ['%1']);
  for (const item of [{ ...notification, title: 'Unknown sender' }, { title: 'Codex update' }]) {
    assert.equal((await recoverNotificationTarget(item, panes, processes, async () => checkout)).reason, 'no_target');
  }
});

test('failed probes and multiple matching checkouts never select the first or most recent pane', async () => {
  const twoCodex = processes.replace('claude', 'codex');
  assert.equal((await recoverNotificationTarget(notification, panes, twoCodex, async () => checkout)).reason, 'source_ambiguous');
  assert.equal((await recoverNotificationTarget(notification, panes, twoCodex, async target => {
    if (target === '%2') throw new Error('Pane disappeared');
    return checkout;
  })).reason, 'source_project_unverified');
});
