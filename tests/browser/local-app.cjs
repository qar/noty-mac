const { app, Notification } = require('electron');
const path = require('node:path');

if (!process.env.NOTY_TEST_USER_DATA) throw new Error('A temporary user-data directory is required');
app.setPath('userData', process.env.NOTY_TEST_USER_DATA);
app.getAppPath = () => path.resolve(__dirname, '../..');
Notification.isSupported = () => false;
require('../../dist/main/index');
app.notyTestShowNotification = id => require('../../dist/main/window').showNotification({
  getBounds: () => ({ x: 100, y: 20, width: 24, height: 24 }),
}, id);
