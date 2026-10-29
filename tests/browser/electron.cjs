const { app } = require('electron');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const userData = mkdtempSync(join(tmpdir(), 'noty-keyboard-test-'));
app.setPath('userData', userData);
app.on('window-all-closed', () => {});
app.on('quit', () => rmSync(userData, { recursive: true, force: true }));
