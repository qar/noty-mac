const WebSocket = require('ws');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function queryThreadClient(threadId, socketPath, timeout) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket('ws://localhost/', {
      createConnection: () => net.createConnection(socketPath),
      perMessageDeflate: false, maxPayload: 2 * 1024 * 1024,
    });
    const pending = new Map();
    let nextId = 0;
    let finished = false;
    let bindingKnown = false;
    const timer = setTimeout(() => finish(new Error('source_project_unverified')), timeout);
    function finish(error, value) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      for (const request of pending.values()) request.reject(error || new Error('source_project_unverified'));
      pending.clear();
      socket.terminate();
      if (error) reject(error);
      else resolve(value);
    }
    function request(method, params) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    }
    socket.on('error', error => finish(error));
    socket.on('close', () => finish(new Error('source_project_unverified')));
    socket.on('message', bytes => {
      let message;
      try { message = JSON.parse(bytes.toString()); } catch { return finish(new Error('source_project_unverified')); }
      const waiting = pending.get(message?.id);
      if (!waiting) return;
      pending.delete(message.id);
      if (message.error) {
        const error = new Error('source_project_unverified');
        error.code = message.error.code;
        waiting.reject(error);
      } else waiting.resolve(message.result);
    });
    socket.on('open', async () => {
      try {
        await request('initialize', { clientInfo: { name: 'noty-mac', title: 'Noty', version: '1' }, capabilities: { experimentalApi: true } });
        socket.send(JSON.stringify({ method: 'initialized' }));
        const visited = new Set();
        for (let depth = 0; ; depth++) {
          if (depth >= 16 || visited.has(threadId)) throw new Error('source_project_unverified');
          visited.add(threadId);
          const result = await request('thread/read', { threadId, includeTurns: false });
          if (result?.thread?.id !== threadId) throw new Error('source_project_unverified');
          const parent = result.thread.source?.subAgent?.thread_spawn?.parent_thread_id;
          if (!parent) break;
          if (!THREAD_ID.test(parent)) throw new Error('source_project_unverified');
          threadId = parent;
        }
        const [diagnostics, inventory] = await Promise.all([
          request('server/diagnostics', {}),
          request('mcpServerStatus/list', { threadId, serverName: 'codex_tui', detail: 'toolsAndAuthOnly', limit: 10 }),
        ]);
        const registration = readRegistration(inventory);
        if (registration.reason) return finish(null, registration);
        bindingKnown = true;
        // Use the thread's existing authenticated MCP connection. An idle HTTP
        // transport need not retain a TCP socket, and a recycled port must fail auth.
        const proof = await request('mcpServer/tool/call', { threadId, server: 'codex_tui',
          ...(registration.environmentId ? { environmentId: registration.environmentId } : {}),
          tool: 'list_threads', arguments: { limit: 1 } });
        if (!Array.isArray(proof?.content) || proof.isError) return finish(null, { reason: 'source_unavailable' });
        const current = readRegistration(await request('mcpServerStatus/list', { threadId, serverName: 'codex_tui', detail: 'toolsAndAuthOnly', limit: 10 }));
        if (current.reason || current.origin !== registration.origin || current.environmentId !== registration.environmentId) {
          return finish(null, { reason: 'source_project_unverified' });
        }
        finish(null, { threadId, serverPid: diagnostics?.process?.id, port: registration.port });
      } catch (error) {
        if (bindingKnown && error.code === -32601) error.code = undefined;
        finish(error);
      }
    });
  });
}

function runLsof(args, timeout) {
  return new Promise((resolve, reject) => {
    execFile('/usr/sbin/lsof', ['-nP', '-a', ...args], { timeout, maxBuffer: 256 * 1024 }, (error, stdout) => {
      if (error && error.code !== 1) reject(error);
      else resolve(stdout || '');
    });
  });
}

async function inspectListeningPort(port, timeout) {
  const listeners = await runLsof([`-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], timeout);
  return {
    pids: [...new Set(listeners.split('\n').filter(line => /^p\d+$/.test(line)).map(line => Number(line.slice(1))))],
  };
}

function localPort(origin) {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    const port = Number(url.port);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
  } catch { return null; }
}

function readRegistration(inventory) {
  if (!Array.isArray(inventory?.data) || inventory.nextCursor) return { reason: 'source_project_unverified' };
  const entries = inventory.data.filter(entry => entry?.name === 'codex_tui');
  if (!entries.length) return { reason: 'unsupported' };
  if (entries.length !== 1) return { reason: 'source_ambiguous' };
  const entry = entries[0];
  if (!Object.hasOwn(entry, 'httpOrigin')) return { reason: 'unsupported' };
  if (entry.runtimeStatus !== 'connected') return { reason: 'source_unavailable' };
  const port = localPort(entry.httpOrigin);
  return port ? { port, origin: entry.httpOrigin, environmentId: entry.environmentId || null } : { reason: 'source_project_unverified' };
}

async function resolveCodexThreadSource(threadId, panes, processOutput, options = {}) {
  if (typeof threadId !== 'string' || !THREAD_ID.test(threadId)) return { reason: 'unsupported' };
  const timeout = options.timeout ?? 1500;
  const socketPath = options.socketPath || path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'app-server-control/app-server-control.sock');
  try {
    const client = await queryThreadClient(threadId, socketPath, timeout);
    if (client.reason) return client;
    const { port } = client;
    const processes = new Map();
    for (const line of processOutput.split('\n')) {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/);
      if (match) processes.set(Number(match[1]), { parent: Number(match[2]), command: path.basename(match[3]) });
    }
    if (processes.get(client.serverPid)?.command !== 'codex') return { reason: 'source_project_unverified' };
    const inspection = options.inspectPort ? await options.inspectPort(port) : await inspectListeningPort(port, Math.min(timeout, 1000));
    if (!inspection.pids.length) return { reason: 'source_unavailable' };
    if (inspection.pids.length !== 1) return { reason: 'source_ambiguous' };
    const clientPid = inspection.pids[0];
    if (processes.get(clientPid)?.command !== 'codex') return { reason: 'source_project_unverified' };
    const paneByPid = new Map(panes.map(pane => [pane.pid, pane]));
    const visited = new Set();
    let pid = clientPid;
    while (pid && !visited.has(pid)) {
      visited.add(pid);
      const pane = paneByPid.get(pid);
      if (pane) return { target: pane.id, panePid: pane.pid, clientPid, port, serverPid: client.serverPid, threadId: client.threadId, session: pane.sessionName };
      pid = processes.get(pid)?.parent;
    }
    return { reason: 'source_unavailable' };
  } catch (error) {
    return { reason: ['ENOENT', 'ECONNREFUSED', -32601].includes(error.code) ? 'unsupported' : 'source_project_unverified' };
  }
}

function sameCodexSource(a, b) {
  return Boolean(a?.target && b?.target && ['target', 'panePid', 'clientPid', 'port', 'serverPid', 'threadId'].every(key => a[key] === b[key]));
}

module.exports = { resolveCodexThreadSource, sameCodexSource };
