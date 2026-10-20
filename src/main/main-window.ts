// Main window (desktop) module.
//
// Distinct from the tray Popover (src/main/window.js): this is a standard
// macOS BrowserWindow used as the app's "desktop face" — hosts the workspace
// list (Step 4). Closing hides the window instead of destroying it, so
// reopening from the tray menu is instant and state (scroll, focus) survives.
//
// Dock policy: whenever the main window becomes visible, `app.dock.show()`
// promotes the app to a regular desktop process. When it hides and no other
// visible windows remain, we `app.dock.hide()` to revert to a tray-only
// footprint. This keeps the menubar identity as the default while letting
// the main window feel like a first-class desktop window while open.

import { BrowserWindow, app, screen, type Rectangle } from 'electron';
import * as path from 'path';
import { setDockIcon } from './app-icon';
import { stopLocalAiRunsForOwner } from './ipc-local-ai';

export type MainWindowView = 'dashboard' | 'workspace' | 'workflow' | 'settings' | 'notifications';
interface DesktopWindowState {
  view: MainWindowView;
  pinned: boolean;
  reminderBounds?: Rectangle;
  workspaceBounds?: Rectangle;
}

const store: { get(key: 'desktopWindow'): DesktopWindowState; set(key: 'desktopWindow', value: DesktopWindowState): void } = require('./store');

let mainWindow: BrowserWindow | null = null;
let currentView: MainWindowView = store.get('desktopWindow').view;
let boundsTimer: ReturnType<typeof setTimeout> | undefined;
let applyingBounds = false;
let quitting = false;

app.on('before-quit', () => {
  quitting = true;
  saveBounds();
});

export function getMainWindowView(): MainWindowView { return currentView; }

function boundsKey(): 'reminderBounds' | 'workspaceBounds' {
  return currentView === 'notifications' ? 'reminderBounds' : 'workspaceBounds';
}

function saveBounds(): void {
  clearTimeout(boundsTimer);
  if (!mainWindow || mainWindow.isDestroyed() || applyingBounds) return;
  store.set('desktopWindow', { ...store.get('desktopWindow'), [boundsKey()]: mainWindow.getNormalBounds() });
}

function restoredBounds(fallback?: Rectangle): Rectangle {
  const saved: Rectangle | undefined = store.get('desktopWindow')[boundsKey()];
  const reference = saved ?? fallback;
  const area = reference
    ? screen.getDisplayMatching(reference).workArea
    : screen.getPrimaryDisplay().workArea;
  const width = Math.min(area.width, Math.max(currentView === 'notifications' ? 380 : 880,
    saved?.width ?? (currentView === 'notifications' ? 440 : 1120)));
  const height = Math.min(area.height, Math.max(currentView === 'notifications' ? 480 : 560, saved?.height ?? 720));
  return {
    x: Math.round(Math.max(area.x, Math.min(saved?.x ?? fallback?.x ?? area.x + (area.width - width) / 2, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(saved?.y ?? fallback?.y ?? area.y + (area.height - height) / 2, area.y + area.height - height))),
    width, height,
  };
}

export function setMainWindowView(view: MainWindowView): void {
  if (currentView === view) return;
  const changingSize = (view === 'notifications') !== (currentView === 'notifications');
  if (changingSize) saveBounds();
  currentView = view;
  store.set('desktopWindow', { ...store.get('desktopWindow'), view });
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (changingSize) {
    applyingBounds = true;
    const bounds = restoredBounds(mainWindow.getNormalBounds());
    mainWindow.setMinimumSize(view === 'notifications' ? 380 : 880, view === 'notifications' ? 480 : 560);
    if (!mainWindow.isMaximized() && !mainWindow.isFullScreen()) mainWindow.setBounds(bounds);
    applyingBounds = false;
  }
  mainWindow.setAlwaysOnTop(view === 'notifications' && getReminderPinned());
}

export function getReminderPinned(): boolean { return store.get('desktopWindow').pinned; }

export function setReminderPinned(pinned: boolean): boolean {
  store.set('desktopWindow', { ...store.get('desktopWindow'), pinned });
  mainWindow?.setAlwaysOnTop(currentView === 'notifications' && pinned);
  return pinned;
}

function rendererHtmlPath(): string {
  // Loaded from the build output (see scripts/build-renderer.js). Both `dev`
  // and the packaged asar keep the same relative layout under `dist/renderer/`.
  return path.join(app.getAppPath(), 'dist/renderer/main.html');
}

function preloadPath(): string {
  // dist/main/main-window.js → dist/preload.js
  return path.join(__dirname, '..', 'preload.js');
}

function isAnyWindowVisible(): boolean {
  return BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isVisible());
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...restoredBounds(),
    minWidth: currentView === 'notifications' ? 380 : 880,
    minHeight: currentView === 'notifications' ? 480 : 560,
    alwaysOnTop: currentView === 'notifications' && getReminderPinned(),
    // Explicit for documentation; also the Electron default.
    resizable: true,
    movable: true,
    show: false,
    title: 'Noty',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#101411',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(rendererHtmlPath()).catch((err) => {
    console.error('[main-window] loadFile failed:', err);
  });

  win.on('close', (event) => {
    // Never destroy — just hide. Reopening from tray is meant to be instant.
    if (win.isDestroyed() || quitting) return;
    event.preventDefault();
    saveBounds();
    win.hide();
    // If we were the last visible window, drop the Dock icon.
    if (!isAnyWindowVisible()) {
      app.dock?.hide();
    }
  });

  win.on('hide', () => {
    stopLocalAiRunsForOwner(win.webContents.id);
  });
  const scheduleSave = () => {
    if (applyingBounds) return;
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(saveBounds, 200);
  };
  win.on('move', scheduleSave);
  win.on('resize', scheduleSave);
  win.on('show', () => win.webContents.send('window-shown'));

  return win;
}

/** Show the main window, creating it lazily on first call. Also promotes
 *  the app into the Dock. Safe to call repeatedly. */
export function openMainWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
  }
  // Show + focus (order matters on macOS after a `hide()`).
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
  // Only call show() on macOS; hide/show on other platforms are no-ops but
  // typed as maybe-undefined.
  setDockIcon();
  app.dock?.show()
    .then(() => { setDockIcon(); })
    .catch(() => { /* ignore */ });
  return mainWindow;
}

/** Hide the main window without destroying it. Also hides the Dock icon if
 *  no other visible windows remain. */
export function hideMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    mainWindow.hide();
  }
  if (!isAnyWindowVisible()) {
    app.dock?.hide();
  }
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

/** Called at app shutdown so listeners on the persisted window can be released. */
export function destroyMainWindow(): void {
  saveBounds();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
  }
  mainWindow = null;
}
