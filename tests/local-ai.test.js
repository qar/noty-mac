const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  buildLocalAiArguments,
  buildLocalAiEnvironment,
  normalizeLocalAiProgram,
  redactLocalAiOutput,
  redactLocalAiStreamingOutput,
  resolveLocalAiExecutable,
} = require('../dist/main/local-ai-core');
const { startLocalAiProcess } = require('../dist/main/local-ai-process');

function program(overrides = {}) {
  return {
    id: 'test-program',
    name: 'Test AI',
    executable: process.execPath,
    args: ['--flag', '{{prompt}}'],
    promptMode: 'argument',
    workingDirectory: '',
    environment: [],
    proxy: {
      mode: 'inherit',
      httpProxy: '',
      httpsProxy: '',
      allProxy: '',
      noProxy: '',
    },
    timeoutMs: 10_000,
    enabled: true,
    versionArgs: ['--version'],
    ...overrides,
  };
}

test('builds argument arrays without changing quotes, newlines, or Unicode', () => {
  const prompt = '第一行\n"double" and \'single\' $(not-a-shell)';
  assert.deepEqual(buildLocalAiArguments(program(), prompt), ['--flag', prompt]);
  assert.deepEqual(
    buildLocalAiArguments(program({ args: ['run'], promptMode: 'argument' }), prompt),
    ['run', prompt]
  );
  assert.deepEqual(
    buildLocalAiArguments(program({ args: ['{{prompt}}'], promptMode: 'stdin' }), prompt),
    ['{{prompt}}']
  );
  assert.deepEqual(
    buildLocalAiArguments(program({ args: ['{{prompt}}'], promptMode: 'none' }), prompt),
    ['{{prompt}}']
  );
});

test('normalizes configuration and rejects duplicate or invalid environment keys', () => {
  const normalized = normalizeLocalAiProgram(program({ timeoutMs: 1000 }));
  assert.equal(normalized.name, 'Test AI');
  assert.throws(
    () => normalizeLocalAiProgram(program({ environment: [
      { key: 'TOKEN', value: 'one', secret: true },
      { key: 'TOKEN', value: 'two', secret: false },
    ] })),
    /重复/
  );
  assert.throws(
    () => normalizeLocalAiProgram(program({ environment: [
      { key: 'BAD-KEY', value: 'value', secret: false },
    ] })),
    /无效/
  );
  assert.throws(() => normalizeLocalAiProgram(program({ timeoutMs: 999 })), /超时时间/);
});

test('merges custom proxy values in both cases and collects secrets', () => {
  const configured = program({
    environment: [
      { key: 'TOKEN', value: 'top-secret', secret: true },
      { key: 'REGION', value: 'local', secret: false },
    ],
    proxy: {
      mode: 'custom',
      httpProxy: 'http://alice:s3cret@127.0.0.1:7890',
      httpsProxy: 'http://127.0.0.1:7891',
      allProxy: 'socks5://127.0.0.1:7892',
      noProxy: 'localhost,127.0.0.1',
    },
  });
  const { env, secrets } = buildLocalAiEnvironment(configured, {
    PATH: '/usr/bin',
    HTTP_PROXY: 'http://old',
    http_proxy: 'http://old-lower',
  });
  assert.equal(env.HTTP_PROXY, configured.proxy.httpProxy);
  assert.equal(env.http_proxy, configured.proxy.httpProxy);
  assert.equal(env.HTTPS_PROXY, configured.proxy.httpsProxy);
  assert.equal(env.ALL_PROXY, configured.proxy.allProxy);
  assert.equal(env.NO_PROXY, configured.proxy.noProxy);
  assert.equal(env.no_proxy, configured.proxy.noProxy);
  assert.equal(env.REGION, 'local');
  assert.ok(secrets.includes('top-secret'));
  assert.ok(secrets.includes('s3cret'));
  assert.ok(secrets.includes(configured.proxy.httpProxy));

  const withoutProxy = buildLocalAiEnvironment(
    program({ proxy: { ...configured.proxy, mode: 'none' } }),
    { HTTP_PROXY: 'http://old', http_proxy: 'http://old-lower' }
  );
  assert.equal(withoutProxy.env.HTTP_PROXY, undefined);
  assert.equal(withoutProxy.env.http_proxy, undefined);
});

test('redacts complete secrets and withholds a secret split across stream chunks', () => {
  const secrets = ['s3cret'];
  assert.equal(redactLocalAiOutput('token=s3cret', secrets), 'token=[REDACTED]');
  assert.equal(redactLocalAiStreamingOutput('token=s3', secrets), 'token=');
  assert.equal(
    redactLocalAiStreamingOutput('token=s3cret done', secrets),
    'token=[REDACTED] done'
  );
});

test('resolves an executable whose absolute path contains spaces', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'noty local ai-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const executable = path.join(directory, 'tool with spaces');
  await fs.writeFile(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const resolved = await resolveLocalAiExecutable(executable, process.env);
  assert.equal(resolved.path, await fs.realpath(executable));
});

test('runs directly with stdin, streams output, redacts secrets, and truncates', async () => {
  const snapshots = [];
  const prompt = '你好\n"quoted"';
  const script = [
    "let input = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', chunk => input += chunk);",
    "process.stdin.on('end', () => {",
    "  process.stdout.write(input);",
    "  process.stderr.write('token=s3');",
    "  setTimeout(() => { process.stderr.write('cret'); }, 10);",
    "});",
  ].join('\n');
  const handle = startLocalAiProcess({
    executable: process.execPath,
    args: ['-e', script],
    promptMode: 'stdin',
    prompt,
    env: process.env,
    secrets: ['s3cret'],
    timeoutMs: 3000,
  }, (snapshot) => snapshots.push(snapshot));
  const result = await handle.completion;
  assert.equal(result.status, 'success');
  assert.equal(result.stdout, prompt);
  assert.equal(result.stderr, 'token=[REDACTED]');
  assert.ok(snapshots.every((snapshot) => !snapshot.output.includes('s3')));

  const truncated = await startLocalAiProcess({
    executable: process.execPath,
    args: ['-e', "process.stdout.write('abcdefghijklmnop')"],
    promptMode: 'none',
    prompt: '',
    env: process.env,
    secrets: [],
    timeoutMs: 3000,
    outputLimit: 8,
  }).completion;
  assert.equal(truncated.stdoutTruncated, true);
  assert.match(truncated.stdout, /^abcdefgh\n\[输出已截断\]$/);
});

test('times out and cancels long-running process groups', async () => {
  const timeoutHandle = startLocalAiProcess({
    executable: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    promptMode: 'none',
    prompt: '',
    env: process.env,
    secrets: [],
    timeoutMs: 100,
  });
  const timedOut = await timeoutHandle.completion;
  assert.equal(timedOut.status, 'timed_out');
  assert.ok(timedOut.durationMs < 3000);

  const cancelHandle = startLocalAiProcess({
    executable: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    promptMode: 'none',
    prompt: '',
    env: process.env,
    secrets: [],
    timeoutMs: 5000,
  });
  setTimeout(() => cancelHandle.cancel(), 50);
  const cancelled = await cancelHandle.completion;
  assert.equal(cancelled.status, 'cancelled');
  assert.ok(cancelled.durationMs < 3000);
});

test('can force-stop a process that ignores graceful termination', async () => {
  let signalReady;
  const ready = new Promise((resolve) => { signalReady = resolve; });
  const handle = startLocalAiProcess({
    executable: process.execPath,
    args: ['-e', "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)"],
    promptMode: 'none',
    prompt: '',
    env: process.env,
    secrets: [],
    timeoutMs: 5000,
  }, (snapshot) => {
    if (snapshot.stream === 'stdout' && snapshot.output.includes('ready')) signalReady();
  });
  await ready;
  handle.cancel();
  setTimeout(() => handle.cancel('cancelled', true), 50);
  const result = await handle.completion;
  assert.equal(result.status, 'cancelled');
  assert.ok(result.durationMs < 1000);
});

test('reports spawn errors without hanging', async () => {
  const result = await startLocalAiProcess({
    executable: path.join(os.tmpdir(), 'noty-definitely-missing-command'),
    args: [],
    promptMode: 'none',
    prompt: '',
    env: process.env,
    secrets: [],
    timeoutMs: 1000,
  }).completion;
  assert.equal(result.status, 'spawn_error');
  assert.match(result.error, /ENOENT/);
});
