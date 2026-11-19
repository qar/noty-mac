const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { _electron: electron } = require('playwright');

function publish(command, id, message) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [], { env: { ...process.env, NOTY_TRANSPORT: 'local', NOTY_DATABASE_PATH: '' }, stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('exit', code => code ? reject(new Error(stderr)) : resolve());
    child.stdin.end(JSON.stringify({ id, title: 'Codex update', message, target: '%64' }));
  });
}

test('SQLite migration, live local receipt, both reminder windows and restart preserve state', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'noty-sqlite-ui-'));
  let application;
  t.after(async () => {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const legacy = { id: 'legacy', channelId: 'old', title: 'Legacy reminder', message: 'Migrated reminder content', timestamp: Date.now() - 1000, read: false };
  fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify({ notifications: [legacy], channels: [], settings: { soundEnabled: false } }));
  const launch = async () => {
    application = await electron.launch({ args: [path.resolve('tests/browser/local-app.cjs'), '--show-notifications'],
      env: { ...process.env, NOTY_TEST_USER_DATA: directory, NOTY_DATABASE_PATH: path.join(directory, 'notifications.sqlite3') } });
    const page = await application.firstWindow();
    await page.waitForFunction(() => Boolean(window.api));
    return page;
  };
  let page = await launch();
  await page.getByText('Migrated reminder content', { exact: true }).waitFor();
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'config.json'), 'utf8')).notifications, undefined);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'notifications-legacy-backup.json'), 'utf8')), [legacy]);
  const snapshot = await page.evaluate(() => window.api.integration.detect());
  assert.ok(fs.existsSync(snapshot.notify.scriptSourcePath));
  await publish(snapshot.notify.scriptSourcePath, 'local-event', 'Live local reminder');
  await page.getByText('Live local reminder', { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.api.getNotifications())).length, 2);
  await page.setViewportSize({ width: 420, height: 800 });
  await page.screenshot({ path: '/tmp/noty-sqlite-reminders-narrow.png' });

  const trayWindow = application.waitForEvent('window');
  await application.evaluate(({ app }) => app.notyTestShowNotification('local-event'));
  const tray = await trayWindow;
  await tray.getByText('Live local reminder', { exact: true }).waitFor();
  assert.equal((await tray.evaluate(() => window.api.getNotifications())).find(item => item.id === 'local-event').read, false);
  await tray.screenshot({ path: '/tmp/noty-sqlite-tray.png' });
  await tray.evaluate(() => window.api.setNotificationsDismissed(['local-event'], true));
  await page.waitForFunction(async () => (await window.api.getNotifications()).find(item => item.id === 'local-event').read);
  await application.close();
  application = null;

  await publish(snapshot.notify.scriptSourcePath, 'offline-event', 'Published while Noty was closed');
  page = await launch();
  await page.getByText('Published while Noty was closed', { exact: true }).waitFor();
  const records = await page.evaluate(() => window.api.getNotifications());
  assert.equal(records.length, 3);
  assert.equal(records.find(item => item.id === 'local-event').read, true);
  assert.equal(records.find(item => item.id === 'offline-event').read, false);
  const local = (await page.evaluate(() => window.api.getChannels())).find(channel => channel.transport === 'local');
  assert.equal(local.id, 'local-tmux');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '通知', exact: true }).click();
  const localSource = page.locator('.channel-settings-row').filter({ hasText: '本机 AI 通知' });
  await localSource.getByText('已启用', { exact: true }).waitFor();
  assert.equal(await localSource.getByRole('button').count(), 0);
  await page.setViewportSize({ width: 1100, height: 820 });
  await page.screenshot({ path: '/tmp/noty-sqlite-channel-settings.png' });
  await page.getByRole('button', { name: 'AI 集成', exact: true }).click();
  await page.getByText('本机通知命令', { exact: true }).waitFor();
  await page.screenshot({ path: '/tmp/noty-sqlite-integration-settings.png' });
});
