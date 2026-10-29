const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { buildSync } = require('esbuild');
const { chromium, _electron: electron } = require('playwright');

let browser;
const controller = buildSync({
  entryPoints: [path.resolve('src/renderer/keyboard-navigation.ts')],
  bundle: true, write: false, format: 'iife', globalName: 'keyboardNavigation',
}).outputFiles[0].text;
const css = fs.readFileSync('src/renderer/keyboard-navigation.css', 'utf8');

before(async () => {
  if (process.env.NOTY_KEYBOARD_ELECTRON !== '1') {
    browser = await chromium.launch();
    return;
  }
  const app = await electron.launch({ args: [path.resolve('tests/browser/electron.cjs')] });
  browser = {
    async newPage({ viewport }) {
      const ready = app.waitForEvent('window');
      await app.evaluate(async ({ BrowserWindow }, size) => {
        const window = new BrowserWindow({ ...size, show: false, webPreferences: { sandbox: true, contextIsolation: true } });
        await window.loadURL('about:blank');
      }, viewport);
      const page = await ready;
      await page.setViewportSize(viewport);
      return page;
    },
    close: () => app.close(),
  };
});
after(async () => { await browser?.close(); });

async function fixture(t, html, viewport = { width: 440, height: 640 }) {
  const page = await browser.newPage({ viewport });
  t.after(() => page.close());
  await page.setContent(`<style>body { margin: 12px; } button, input, summary { display: block; margin: 12px; }</style><style>${css}</style>${html}`);
  await page.addScriptTag({ content: controller });
  await page.evaluate(() => { window.disposeKeyboard = keyboardNavigation.installKeyboardNavigation(); });
  return page;
}

async function hint(page, target) {
  await page.keyboard.press('f');
  const label = await target.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return Array.from(document.querySelectorAll('.keyboard-hint')).find(badge =>
      Math.abs(parseFloat(badge.style.left) - Math.max(0, rect.left)) < 1
      && Math.abs(parseFloat(badge.style.top) - Math.max(0, rect.top)) < 1
    )?.textContent;
  });
  assert.ok(label, 'target has a visible hint');
  await page.keyboard.type(label.toLowerCase());
}

test('hints include visible controls and exclude hidden, disabled, clipped and covered controls', async t => {
  const page = await fixture(t, `
    <button id="action" onclick="window.clicked = true">Open</button>
    <input id="text">
    <button disabled>Disabled</button>
    <fieldset disabled><button>Disabled by fieldset</button></fieldset>
    <button hidden style="display:none">Hidden</button>
    <button style="visibility:hidden">Invisible</button>
    <details><summary>Older</summary><button>Closed detail</button></details>
    <div style="height:0;overflow:hidden"><button>Clipped</button></div>
    <div style="position:relative"><button>Covered</button><div style="position:absolute;inset:0"></div></div>
    <button style="position:absolute;top:2000px">Offscreen</button>
  `);
  await page.keyboard.press('f');
  assert.equal(await page.locator('.keyboard-hint').count(), 3);
  await page.keyboard.press('Escape');
  await hint(page, page.locator('#action'));
  assert.equal(await page.evaluate(() => window.clicked), true);
  assert.equal(await page.locator('.keyboard-hint').count(), 0);
  await hint(page, page.locator('#text'));
  assert.equal(await page.locator('#text').evaluate(element => element === document.activeElement), true);
  await page.keyboard.type('fjkgg');
  assert.equal(await page.locator('#text').inputValue(), 'fjkgg');
});

test('multi-letter hints narrow without activating early and support backspace and Escape', async t => {
  const page = await fixture(t, `<div style="display:grid;grid-template-columns:repeat(8,1fr)">${Array.from({ length: 40 }, (_, i) => `<button onclick="window.clicked = ${i}">${i}</button>`).join('')}</div>`, { width: 1000, height: 600 });
  await page.keyboard.press('f');
  const labels = await page.locator('.keyboard-hint').allTextContents();
  assert.equal(labels.length, 40);
  assert.equal(new Set(labels).size, 40);
  assert.ok(labels.every(label => label.length === 2));
  await page.keyboard.press(labels[30][0].toLowerCase());
  assert.equal(await page.evaluate(() => window.clicked), undefined);
  assert.ok(await page.locator('.keyboard-hint:visible').count() < 40);
  await page.keyboard.press('Backspace');
  assert.equal(await page.locator('.keyboard-hint:visible').count(), 40);
  await page.keyboard.type(labels[30].toLowerCase());
  assert.equal(await page.evaluate(() => window.clicked), 30);
  await page.keyboard.press('f');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.keyboard-hint').count(), 0);
});

test('editing, IME composition, modifiers and key repeat do not trigger commands', async t => {
  const page = await fixture(t, '<input><textarea></textarea><div contenteditable="true">Editor</div><select><option>First</option><option>Second</option></select><button>Open</button>');
  for (const selector of ['input', 'textarea', '[contenteditable]', 'select']) {
    await page.locator(selector).focus();
    await page.keyboard.press('f');
    assert.equal(await page.locator('.keyboard-hint').count(), 0);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator(selector).evaluate(element => element === document.activeElement), false);
  }
  for (const options of [{ isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { repeat: true }]) {
    await page.evaluate(options => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true, ...options })), options);
    assert.equal(await page.locator('.keyboard-hint').count(), 0);
  }
  await page.keyboard.press('f');
  await page.evaluate(() => document.dispatchEvent(new CompositionEvent('compositionstart')));
  assert.equal(await page.locator('.keyboard-hint').count(), 0);
});

test('modal hints stay inside the dialog and preserve cancel as the default', async t => {
  const page = await fixture(t, `<button>Background</button><dialog><p>Confirm?</p><button autofocus onclick="this.closest('dialog').close()">Cancel</button><button onclick="window.confirmed=true">Confirm</button></dialog>`);
  await page.locator('dialog').evaluate(dialog => dialog.showModal());
  await page.keyboard.press('f');
  assert.equal(await page.locator('dialog .keyboard-hint').count(), 2);
  await page.screenshot({ path: '/tmp/noty-keyboard-dialog.png', caret: 'initial' });
  assert.equal(await page.locator('dialog .keyboard-hint').count(), 2);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('dialog').evaluate(dialog => dialog.open), true);
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.confirmed), undefined);
  assert.equal(await page.locator('dialog').evaluate(dialog => dialog.open), false);
});

test('layout changes and incoming content cancel stale hints; disposal removes the handler', async t => {
  const page = await fixture(t, '<button id="first">First</button><button>Second</button>');
  for (const change of [
    () => document.querySelector('#first').remove(),
    () => document.querySelector('button').disabled = true,
    () => document.body.append(document.createElement('button')),
    () => window.dispatchEvent(new Event('blur')),
    () => window.dispatchEvent(new Event('resize')),
  ]) {
    await page.keyboard.press('f');
    assert.ok(await page.locator('.keyboard-hint').count() > 0);
    await page.evaluate(change);
    await page.waitForFunction(() => !document.querySelector('.keyboard-hint'));
    await page.evaluate(() => { document.body.innerHTML = '<button id="first">First</button><button>Second</button>'; });
  }
  await page.evaluate(() => window.disposeKeyboard());
  await page.keyboard.press('f');
  assert.equal(await page.locator('.keyboard-hint').count(), 0);
});

test('scrolling uses the focused panel and gg expires after another key', async t => {
  const page = await fixture(t, '<div id="scroll" style="height:200px;overflow:auto"><button id="inside">Inside</button><div style="height:2000px"></div></div>');
  await page.locator('#inside').focus();
  await page.keyboard.press('d');
  assert.equal(await page.locator('#scroll').evaluate(element => element.scrollTop), 100);
  await page.keyboard.press('u');
  assert.equal(await page.locator('#scroll').evaluate(element => element.scrollTop), 0);
  await page.keyboard.press('G');
  assert.ok(await page.locator('#scroll').evaluate(element => element.scrollTop) > 1000);
  await page.keyboard.press('g');
  await page.keyboard.press('x');
  await page.keyboard.press('g');
  assert.ok(await page.locator('#scroll').evaluate(element => element.scrollTop) > 1000);
  await page.keyboard.press('g');
  assert.equal(await page.locator('#scroll').evaluate(element => element.scrollTop), 0);
  await page.keyboard.press('f');
  await page.locator('#scroll').evaluate(element => { element.scrollTop = 100; });
  await page.waitForFunction(() => !document.querySelector('.keyboard-hint'));
});

async function reminderPage(t, entry, width) {
  const page = await browser.newPage({ viewport: { width, height: 640 } });
  t.after(() => page.close());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.addInitScript(() => {
    const handlers = {};
    const on = name => callback => { handlers[name] = callback; return () => delete handlers[name]; };
    const make = (id, offset, issue = id) => ({
      id, channelId: 'plane', type: 'plane', timestamp: Date.now() - offset * 60000,
      title: `TRV-${issue} 测试任务名称与评论`, message: JSON.stringify({ event: 'issue_comment', data: { comment_html: '<p>评论内容</p>' } }), read: false,
      metadata: { plane: { event: 'issue_comment', issueId: issue, issueIdentifier: `TRV-${issue}`, url: `https://example.com/TRV-${issue}`, commentAuthor: '测试用户', commentCreatedAt: new Date().toISOString() } },
    });
    window.items = [make('1', 1), make('old', 2, '1'), ...Array.from({ length: 8 }, (_, i) => make(String(i + 2), i + 3))];
    window.calls = [];
    window.failJump = false;
    window.pushReminder = () => { window.items.unshift(make('new', 0)); handlers.updated?.(); };
    window.api = {
      getNotifications: async () => window.items,
      getChannels: async () => [{ id: 'plane', name: 'RtiTek Plane', type: 'plane' }],
      getSelectedNotification: async () => null,
      onNewNotification: on('new'), onWindowShown: on('shown'), onNotificationsUpdated: on('updated'), onNotificationSelected: on('selected'),
      jumpToNotificationTarget: async (id, options) => {
        window.calls.push({ id, options });
        if (window.failJump) return { success: false, reason: '测试跳转失败' };
        window.items = window.items.map(item => options.notificationIds.includes(item.id) ? { ...item, read: true, completedAt: Date.now() } : item);
        return { success: true };
      },
      setNotificationsDismissed: async (ids, dismissed) => {
        window.calls.push({ ids, dismissed });
        window.items = window.items.map(item => ids.includes(item.id) ? { ...item, read: dismissed, completedAt: dismissed ? Date.now() : null } : item);
        return window.items;
      },
      openSettings() {}, openNotificationSettings() {}, openNotifications() {},
      desktop: { getPinned: async () => false, setPinned: async value => value },
      dashboard: { getInitialView: async () => 'notifications', getSettingsTab: async () => 'general', setView() {}, onNavigate: on('navigate') },
      projects: { list: async () => [], onUpdated: on('projects') },
      workspace: { list: async () => [], activeAiPanes: async () => [], onUpdated: on('workspace') },
    };
  });
  await page.goto(pathToFileURL(path.resolve(`dist/renderer/${entry}.html`)).href);
  await page.locator('#notification-1').waitFor();
  return page;
}

for (const [entry, width] of [['main', 440], ['index', 380]]) {
  test(`${entry}: reminder navigation preserves groups, follows live updates and opens through the existing API`, async t => {
    const page = await reminderPage(t, entry, width);
    await page.keyboard.press('j');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'notification-1');
    await page.keyboard.press('j');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'notification-2');
    await page.keyboard.press('k');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'notification-1');
    assert.deepEqual(await page.evaluate(() => window.calls), []);
    await hint(page, page.locator('.notification-group-history > summary'));
    await page.locator('#notification-1').focus();
    await page.keyboard.press('j');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'notification-old');
    await page.keyboard.press('G');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'notification-9');
    await page.keyboard.type('gg');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'notification-1');
    await page.keyboard.press('f');
    await page.screenshot({ path: `/tmp/noty-keyboard-${entry}.png`, caret: 'initial' });
    assert.ok(await page.locator('.keyboard-hint').count() > 0);
    await page.evaluate(() => window.pushReminder());
    await page.locator('#notification-new').waitFor();
    await page.waitForFunction(() => !document.querySelector('.keyboard-hint'));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'notification-1');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('notification-1'));
    assert.deepEqual(await page.evaluate(() => window.calls), [{ id: '1', options: { notificationIds: ['1', 'old'] } }]);
    assert.equal(await page.locator('#notification-new').count(), 1);
    await page.evaluate(() => { window.failJump = true; });
    await page.keyboard.press('j');
    await page.keyboard.press('Enter');
    await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('#notification-new').count(), 1);
  });

  test(`${entry}: batch dismissal requires explicit confirmation and does not include new arrivals`, async t => {
    const page = await reminderPage(t, entry, width);
    await hint(page, page.getByRole('button', { name: '收起全部提醒', exact: true }));
    await page.locator('dialog').waitFor({ state: 'visible' });
    await page.keyboard.press('Enter');
    await page.locator('dialog').waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => window.calls), []);
    await hint(page, page.getByRole('button', { name: '收起全部提醒', exact: true }));
    await page.locator('dialog').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.locator('dialog').waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => window.calls), []);
    await hint(page, page.getByRole('button', { name: '收起全部提醒', exact: true }));
    await page.locator('dialog').waitFor({ state: 'visible' });
    await page.evaluate(() => window.pushReminder());
    await page.locator('#notification-new').waitFor();
    await hint(page, page.getByRole('button', { name: '确认收起', exact: true }));
    await page.waitForFunction(() => window.calls.length === 1);
    assert.equal(await page.evaluate(() => window.calls[0].ids.length), 10);
    assert.equal(await page.locator('#notification-new').count(), 1);
  });
}
