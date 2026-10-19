const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('system notification selection survives first window load and reopens a hidden panel', () => {
  const messages = [];
  let focused = 0;
  class BrowserWindow {
    constructor() { this.visible = false; this.webContents = { send: (...args) => messages.push(args) }; }
    on() {}
    loadFile() {}
    getBounds() { return { width: 400, height: 600 }; }
    setPosition() {}
    show() { this.visible = true; }
    hide() { this.visible = false; }
    focus() { focused++; }
  }
  const context = { module: { exports: {} }, __dirname: '/app/dist/main', require: name => name === 'electron'
    ? { BrowserWindow, app: { getAppPath: () => '/app', focus() {} } } : require(name) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/main/window'), 'utf8'), context);
  const window = context.module.exports;
  const tray = { getBounds: () => ({ x: 0, y: 0, width: 24, height: 24 }) };
  assert.equal(window.getWindow(), null);
  window.showNotification(tray, 'first');
  assert.equal(window.getWindow().visible, true);
  assert.equal(window.getSelectedNotificationId(), 'first');
  assert.deepEqual(messages.at(-1), ['notification-selected', 'first']);
  window.getWindow().hide();
  window.showNotification(tray, 'second');
  assert.equal(window.getWindow().visible, true);
  assert.equal(window.getSelectedNotificationId(), 'second');
  assert.equal(focused, 2);
});
