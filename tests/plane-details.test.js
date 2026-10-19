const test = require('node:test');
const assert = require('node:assert/strict');
const { PlaneDetailsClient, migratePlaneCredentials } = require('../dist/main/plane-details');

const channel = { id: 'plane', type: 'plane', planeBaseUrl: 'https://plane.example', planeWorkspaceSlug: 'team' };
const plane = { workspaceSlug: 'team', projectId: 'p', issueId: 'i' };

test('Plane credentials migrate only to matching configured site and workspace', () => {
  const legacy = { baseUrl: 'https://plane.example/', workspaceSlug: 'team', apiKeyEnc: 'encrypted' };
  const channels = [channel, { ...channel, planeBaseUrl: 'https://other.example' }, { ...channel, planeWorkspaceSlug: 'other' },
    { ...channel, encryptedPlaneApiKey: 'existing' }, { ...channel, encryptedPlaneApiKey: '' }, { ...channel, type: 'tmux-agent' }];
  const migrated = migratePlaneCredentials(channels, legacy);
  assert.equal(migrated[0].encryptedPlaneApiKey, 'encrypted');
  for (let i = 1; i < channels.length; i++) assert.deepEqual(migrated[i], channels[i]);
  assert.deepEqual(migratePlaneCredentials(channels), channels);
});

test('task lookup uses read-only configured-origin endpoints and caches project identifiers', async () => {
  const requests = [];
  const client = new PlaneDetailsClient(async (url, options) => {
    requests.push({ url, options });
    return Response.json(url.endsWith('/projects/p/') ? { identifier: 'APP' } : { name: 'Task name', sequence_id: 7 });
  });
  assert.deepEqual(await client.read(channel, plane, 'key'), { issueIdentifier: 'APP-7', issueName: 'Task name' });
  await client.read(channel, { ...plane, issueId: 'i/2' }, 'key');
  assert.equal(requests.length, 3);
  assert.equal(requests[2].url, 'https://plane.example/api/v1/workspaces/team/projects/p/issues/i%2F2/');
  for (const { options } of requests) {
    assert.equal(options.redirect, 'error');
    assert.deepEqual(options.headers, { 'X-API-Key': 'key' });
    assert.ok(options.signal);
  }
  await client.read(channel, { ...plane, workspaceSlug: 'other' }, 'key');
  await client.read(channel, plane, '');
  assert.equal(requests.length, 3);
});

test('partial permissions retain task name and retry project lookup on the next task', async () => {
  let projects = 0;
  const client = new PlaneDetailsClient(async url => {
    if (url.endsWith('/projects/p/')) return ++projects === 1 ? new Response('', { status: 403 }) : Response.json({ identifier: 'APP' });
    return Response.json({ name: 'Task name', sequence_id: 7 });
  });
  assert.deepEqual(await client.read(channel, plane, 'key'), { issueName: 'Task name' });
  assert.equal((await client.read(channel, plane, 'key')).issueIdentifier, 'APP-7');
});
