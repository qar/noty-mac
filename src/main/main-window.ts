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

import { BrowserWindow, app } from 'electron';
import * as path from 'path';

let mainWindow: BrowserWindow | null = null;

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
    width: 1120,
    height: 720,
    minWidth: 880,
    minHeight: 560,
    // Explicit for documentation; also the Electron default.
    resizable: true,
    movable: true,
    show: false,
    title: 'Noty',
    titleBarStyle: 'hiddenInset',
    // macOS sidebar vibrancy — the design spec (§7.4) says the main window's
    // outer chrome is opaque `--color-bg-elevated`; the sidebar itself picks
    // up the system vibrancy material via CSS `-webkit-app-region` + the
    // window-level material set here. Setting `sidebar` gives the whole
    // window the sidebar material; the renderer CSS then paints an opaque
    // panel over the content area only.
    vibrancy: 'sidebar',
    // NOTE: Do NOT set `backgroundColor: '#00000000'` here. On macOS the
    // combination of hiddenInset + vibrancy + a fully transparent background
    // makes Electron treat the window as chromeless — the OS then omits the
    // native resize handles and the top drag region.
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
    if (win.isDestroyed()) return;
    event.preventDefault();
    win.hide();
    // If we were the last visible window, drop the Dock icon.
    if (!isAnyWindowVisible()) {
      app.dock?.hide();
    }
  });

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
  app.dock?.show().catch(() => { /* ignore */ });
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
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
  }
  mainWindow = null;
}
