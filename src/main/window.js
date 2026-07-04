const { BrowserWindow, app } = require('electron');
const path = require('path');

let mainWindow = null;

function createWindow(tray) {
  if (mainWindow) {
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 400,
    height: 600,
    show: false,
    frame: false,
    resizable: false,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(app.getAppPath(), 'src/renderer/index.html'));

  // 窗口失焦时隐藏
  mainWindow.on('blur', () => {
    if (!mainWindow.webContents.isDevToolsOpened()) {
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function toggleWindow(tray) {
  if (!mainWindow) {
    mainWindow = createWindow(tray);
  }

  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    showWindow(tray);
  }
}

function showWindow(tray) {
  if (!mainWindow) {
    mainWindow = createWindow(tray);
  }

  const trayBounds = tray.getBounds();
  const windowBounds = mainWindow.getBounds();

  // 计算窗口位置（在托盘图标下方居中）
  const x = Math.round(trayBounds.x + (trayBounds.width / 2) - (windowBounds.width / 2));
  const y = Math.round(trayBounds.y + trayBounds.height + 4);

  mainWindow.setPosition(x, y, false);
  mainWindow.show();
  mainWindow.focus();

  // 每次显示窗口时通知渲染进程刷新数据
  mainWindow.webContents.send('window-shown');
}

function getWindow() {
  return mainWindow;
}

module.exports = {
  createWindow,
  toggleWindow,
  showWindow,
  getWindow
};
