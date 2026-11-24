const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { WebSocketServer } = require('ws');
const { resolveCodexThreadSource } = require('../dist/main/codex-tmux-source');

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const child = '33333333-3333-4333-8333-333333333333';
const panes = [{ id: '%93', pid: 100 }, { id: '%94', pid: 200 }];
const processes = '100 1 zsh\n101 100 codex\n200 1 zsh\n201 200 codex\n999 1 codex';

async function fixture(t, { origins, parents = {}, hang = false, unsupported = false, malformed = false, proofError = false, originChanges = false, proofUnsupported = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'noty-codex-source-'));
  const socketPath = path.join(directory, 'control.sock');
  const server = http.createServer();
  const websocket = new WebSocketServer({ server });
  const requests = [];
  let inventoryReads = 0;
  websocket.on('connection', socket => socket.on('message', bytes => {
    const request = JSON.parse(bytes);
    requests.push(request);
    if (hang || request.id === undefined) return;
    if (malformed) return socket.send('invalid json');
    let result;
    if (request.method === 'initialize') result = {};
    else if (request.method === 'thread/read') result = { thread: { id: request.params.threadId,
      source: parents[request.params.threadId] ? { subAgent: { thread_spawn: { parent_thread_id: parents[request.params.threadId] } } } : 'vscode' } };
    else if (request.method === 'server/diagnostics') result = { process: { id: 999 } };
    else if (request.method === 'mcpServerStatus/list') result = { data: origins || [{ name: 'codex_tui', runtimeStatus: 'connected',
      httpOrigin: `http://127.0.0.1:${request.params.threadId === first || originChanges && inventoryReads++ > 0 ? 55187 : 55467}` }], nextCursor: null };
    else if (request.method === 'mcpServer/tool/call') {
      assert.equal(request.params.server, 'codex_tui');
      assert.equal(request.params.tool, 'list_threads');
      result = { content: [], isError: proofError };
    }
    else assert.fail(`Unexpected mutation or request: ${request.method}`);
    socket.send(JSON.stringify(unsupported && request.method !== 'initialize' || proofUnsupported && request.method === 'mcpServer/tool/call'
      ? { id: request.id, error: { code: -32601, message: 'Unsupported method' } } : { id: request.id, result }));
  }));
  await new Promise(resolve => server.listen(socketPath, resolve));
  t.after(async () => {
    for (const client of websocket.clients) client.terminate();
    await new Promise(resolve => websocket.close(resolve));
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const calls = [];
  const options = { socketPath, timeout: 500, inspectPort: async port => {
    calls.push({ port });
    return { pids: [port === 55187 ? 101 : 201] };
  } };
  return { options, requests, calls, resolve: (thread = second, extra = {}) => resolveCodexThreadSource(thread, panes, processes, { ...options, ...extra }) };
}

test('same-checkout threads resolve through their own authenticated TUI connection', async t => {
  const app = await fixture(t);
  assert.equal((await app.resolve(first)).target, '%93');
  const source = await app.resolve(second);
  assert.equal(source.target, '%94');
  assert.equal(source.clientPid, 201);
  assert.equal(source.port, 55467);
  assert.equal(source.threadId, second);
  assert.ok(app.requests.filter(item => item.method === 'mcpServerStatus/list').every(item => item.params.serverName === 'codex_tui'));
  assert.deepEqual(app.calls, [{ port: 55187 }, { port: 55467 }]);
});

test('native subagents use their parent thread client instead of the review checkout', async t => {
  const app = await fixture(t, { parents: { [child]: second } });
  const source = await app.resolve(child);
  assert.equal(source.target, '%94');
  assert.equal(source.threadId, second);
  assert.deepEqual(app.requests.filter(item => item.method === 'thread/read').map(item => item.params.threadId), [child, second]);
});

test('a stale or reused endpoint without authenticated confirmation never becomes a source', async t => {
  const app = await fixture(t);
  const stale = await fixture(t, { proofError: true });
  assert.equal((await stale.resolve()).reason, 'source_unavailable');
  assert.equal(stale.calls.length, 0);
  assert.equal((await app.resolve(second, { inspectPort: async () => ({ pids: [] }) })).reason, 'source_unavailable');
  const ambiguous = await app.resolve(second, { inspectPort: async () => ({ pids: [101, 201], connected: true }) });
  assert.equal(ambiguous.reason, 'source_ambiguous');
  const unrelated = await resolveCodexThreadSource(second, panes, processes.replace('201 200 codex', '201 200 other'), {
    ...app.options, inspectPort: async () => ({ pids: [201], connected: true }),
  });
  assert.equal(unrelated.reason, 'source_project_unverified');
  const changed = await fixture(t, { originChanges: true });
  assert.equal((await changed.resolve()).reason, 'source_project_unverified');
  const missingProof = await fixture(t, { proofUnsupported: true });
  assert.equal((await missingProof.resolve()).reason, 'source_project_unverified');
});

test('remote, credential-bearing and malformed origins never trigger process probing', async t => {
  for (const origin of ['https://example.com:55467', 'http://user:secret@127.0.0.1:55467',
    'http://127.0.0.1:55467/path', 'http://127.0.0.1:55467/?token=secret', 'not a url']) {
    await t.test(origin.replace('secret', 'REDACTED'), async t => {
      const app = await fixture(t, { origins: [{ name: 'codex_tui', runtimeStatus: 'connected', httpOrigin: origin }] });
      assert.equal((await app.resolve()).reason, 'source_project_unverified');
      assert.equal(app.calls.length, 0);
    });
  }
});

test('disconnected and conflicting TUI registrations never fall back to another client', async t => {
  const app = await fixture(t, { origins: [{ name: 'codex_tui', runtimeStatus: 'failed', httpOrigin: 'http://127.0.0.1:55467' }] });
  assert.equal((await app.resolve()).reason, 'source_unavailable');
  const other = await fixture(t, { origins: [55187, 55467].map(port => ({ name: 'codex_tui', runtimeStatus: 'connected', httpOrigin: `http://127.0.0.1:${port}` })) });
  assert.equal((await other.resolve()).reason, 'source_ambiguous');
});

test('unsupported installations remain distinguishable from broken source verification', async t => {
  const unsupported = await fixture(t, { unsupported: true });
  assert.equal((await unsupported.resolve()).reason, 'unsupported');
  const missingField = await fixture(t, { origins: [{ name: 'codex_tui', runtimeStatus: 'connected' }] });
  assert.equal((await missingField.resolve()).reason, 'unsupported');
  assert.equal((await missingField.resolve('invalid-thread')).reason, 'unsupported');
  const missingSocket = await missingField.resolve(second, { socketPath: path.join(os.tmpdir(), 'noty-nonexistent-control.sock') });
  assert.equal(missingSocket.reason, 'unsupported');
});

test('timeouts, malformed responses and cyclic parent threads preserve an unverified source', async t => {
  const hung = await fixture(t, { hang: true });
  assert.equal((await hung.resolve(second, { timeout: 40 })).reason, 'source_project_unverified');
  const malformed = await fixture(t, { malformed: true });
  assert.equal((await malformed.resolve()).reason, 'source_project_unverified');
  const cyclic = await fixture(t, { parents: { [child]: second, [second]: child } });
  assert.equal((await cyclic.resolve(child)).reason, 'source_project_unverified');
});
