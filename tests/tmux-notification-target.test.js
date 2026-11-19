const test = require('node:test');
const assert = require('node:assert/strict');
const { recoverNotificationTarget } = require('../dist/main/tmux-notification-target');

const notification = { title: 'Codex update', metadata: { project: { name: 'source', branch: 'feature' } } };
const panes = [{ id: '%1', pid: 100 }, { id: '%2', pid: 200 }];
const processes = '100 1 zsh\n101 100 codex\n200 1 zsh\n201 200 claude';
const checkout = { root: '/work/source', branch: 'feature' };

test('recovery requires a verified project and prefers the matching sender agent', async () => {
  assert.equal((await recoverNotificationTarget(notification, panes, processes, async () => ({ ...checkout, root: '/work/other' }))).reason, 'source_unavailable');
  const visited = [];
  const result = await recoverNotificationTarget(notification, panes, processes, async target => { visited.push(target); return checkout; });
  assert.equal(result.target, '%1');
  assert.deepEqual(visited, ['%1']);
  for (const item of [{ ...notification, title: 'Unknown sender' }, { title: 'Codex update' }]) {
    assert.equal((await recoverNotificationTarget(item, panes, processes, async () => checkout)).reason, 'no_target');
  }
});

test('a unique source agent remains navigable after its checkout switches branches', async () => {
  const result = await recoverNotificationTarget(notification, panes, processes, async () => ({ ...checkout, branch: 'next-feature' }));
  assert.equal(result.target, '%1');
  assert.deepEqual(result.checkout, { ...checkout, branch: 'next-feature' });
});

test('exact branch matches take precedence over cross-branch agent recovery', async () => {
  for (const processOutput of [processes.replace('claude', 'codex'), '100 1 zsh\n101 100 codex\n200 1 zsh']) {
    const result = await recoverNotificationTarget(notification, panes, processOutput, async target => ({
      ...checkout, branch: target === '%1' ? 'next-feature' : checkout.branch,
    }));
    assert.equal(result.target, '%2');
    assert.equal(result.checkout.branch, checkout.branch);
  }
});

test('cross-branch recovery refuses multiple agents or failed competing probes', async () => {
  const twoCodex = processes.replace('claude', 'codex');
  const switched = { ...checkout, branch: 'next-feature' };
  assert.equal((await recoverNotificationTarget(notification, panes, twoCodex, async () => switched)).reason, 'source_ambiguous');
  const result = await recoverNotificationTarget(notification, panes, twoCodex, async target => {
    if (target === '%1') return switched;
    throw new Error('Pane disappeared');
  });
  assert.equal(result.reason, 'source_project_unverified');
});

test('a pane outside a Git checkout does not block the unique verified source agent', async () => {
  const twoCodex = processes.replace('claude', 'codex');
  const result = await recoverNotificationTarget(notification, panes, twoCodex, async target =>
    target === '%1' ? { ...checkout, branch: 'next-feature' } : null);
  assert.equal(result.target, '%1');
});

test('cross-branch recovery never falls back to a different agent or a plain shell', async () => {
  const switched = { ...checkout, branch: 'next-feature' };
  for (const processOutput of ['100 1 zsh\n101 100 claude\n200 1 zsh', '100 1 zsh\n200 1 zsh']) {
    assert.equal((await recoverNotificationTarget(notification, panes, processOutput, async () => switched)).reason, 'source_unavailable');
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

test('a unique source shell remains navigable after its agent exits', async () => {
  const result = await recoverNotificationTarget(notification, panes, '100 1 zsh\n200 1 zsh', async target =>
    target === '%1' ? checkout : { root: '/work/other', branch: 'main' });
  assert.equal(result.target, '%1');
  const ambiguous = await recoverNotificationTarget(notification, panes, '100 1 zsh\n200 1 zsh', async () => checkout);
  assert.equal(ambiguous.reason, 'source_ambiguous');
});
