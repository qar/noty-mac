const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

function desktop(initial = { view: 'dashboard', pinned: false }) {
  let saved = structuredClone(initial);
  const windows = [];
  const app = Object.assign(new EventEmitter(), { getAppPath: () => '/app', dock: { show: async () => {}, hide() {} } });
  const area = { x: 0, y: 25, width: 1440, height: 875 };
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.visible = false; this.destroyed = false;
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.pinned = options.alwaysOnTop;
      this.webContents = { id: 1, send() {} }; windows.push(this);
    }
    static getAllWindows() { return windows; }
    loadFile() { return Promise.resolve(); }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    isMaximized() { return false; }
    isFullScreen() { return false; }
    getNormalBounds() { return { ...this.bounds }; }
    setMinimumSize(width, height) { this.minimum = [width, height]; }
    setBounds(bounds) { this.bounds = { ...bounds }; this.emit('resize'); }
    setAlwaysOnTop(pinned) { this.pinned = pinned; }
    show() { this.visible = true; this.emit('show'); }
    hide() { this.visible = false; this.emit('hide'); }
    focus() {}
    destroy() { this.destroyed = true; }
  }
  const module = { exports: {} };
  const context = { module, exports: module.exports, __dirname: '/app/dist/main', console, setTimeout, clearTimeout,
    require(name) {
      if (name === 'electron') return { BrowserWindow, screen: { getDisplayMatching: () => ({ workArea: area }), getPrimaryDisplay: () => ({ workArea: area }) },
        app };
      if (name === './store') return { get: () => structuredClone(saved), set: (_key, value) => { saved = structuredClone(value); } };
      if (name === './app-icon') return { setDockIcon() {} };
      if (name === './ipc-local-ai') return { stopLocalAiRunsForOwner() {} };
      return require(name);
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/main/main-window'), 'utf8'), context);
  return { api: module.exports, saved: () => saved, area, app };
}

test('reminders retain narrow bounds and pin preference independently of other desktop views', () => {
  const { api, saved } = desktop();
  const win = api.openMainWindow();
  const wide = win.getNormalBounds();
  api.setMainWindowView('notifications');
  assert.equal(win.bounds.width, 440);
  assert.deepEqual(win.minimum, [380, 480]);
  const narrow = { x: 1040, y: 25, width: 400, height: 840 };
  win.setBounds(narrow);
  api.setReminderPinned(true);
  win.emit('blur');
  assert.equal(win.visible, true);
  assert.equal(win.pinned, true);
  api.setMainWindowView('settings');
  assert.deepEqual(win.getNormalBounds(), wide);
  assert.equal(win.pinned, false);
  assert.deepEqual(saved().reminderBounds, narrow);
  api.setMainWindowView('notifications');
  assert.deepEqual(win.getNormalBounds(), narrow);
  assert.equal(win.pinned, true);
  win.emit('close', { preventDefault() {} });
  assert.equal(win.visible, false);
  assert.equal(api.openMainWindow(), win);
  api.destroyMainWindow();
  const restarted = desktop(saved());
  const reopened = restarted.api.openMainWindow();
  assert.equal(restarted.api.getMainWindowView(), 'notifications');
  assert.deepEqual(reopened.getNormalBounds(), narrow);
  assert.equal(reopened.pinned, true);
  restarted.api.setReminderPinned(false);
  assert.equal(reopened.pinned, false);
  restarted.api.destroyMainWindow();
});

test('restoring a reminder from a removed display keeps it in the available work area', () => {
  const { api, area } = desktop({ view: 'notifications', pinned: false,
    reminderBounds: { x: 2800, y: -1000, width: 420, height: 1400 } });
  const win = api.openMainWindow();
  assert.equal(win.options.minWidth, 380);
  assert.equal(win.bounds.x + win.bounds.width, area.x + area.width);
  assert.equal(win.bounds.y, area.y);
  assert.equal(win.bounds.height, area.height);
  api.destroyMainWindow();
});

test('closing hides the desktop window but quitting saves bounds and allows shutdown', () => {
  const { api, app, saved } = desktop({ view: 'notifications', pinned: false });
  const win = api.openMainWindow();
  let prevented = 0;
  win.emit('close', { preventDefault() { prevented++; } });
  assert.equal(prevented, 1);
  assert.equal(win.visible, false);
  api.openMainWindow();
  win.setBounds({ x: 1010, y: 25, width: 430, height: 800 });
  app.emit('before-quit');
  win.emit('close', { preventDefault() { prevented++; } });
  assert.equal(prevented, 1);
  assert.deepEqual(saved().reminderBounds, win.getNormalBounds());
  api.destroyMainWindow();
});
