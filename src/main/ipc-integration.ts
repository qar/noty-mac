// IPC endpoints for the Settings > AI 集成 wizard.
//
// Every write path here is limited to `clipboard.writeText`. The one
// filesystem side-effect is `shell.openPath('~/.claude')`, which only
// opens the directory in Finder — Finder itself does not modify anything.
// If the directory doesn't exist we deliberately do NOT create it (that
// would be a filesystem write outside our sandbox); the renderer surfaces
// a friendly error and asks the user to create it themselves.

import { ipcMain, clipboard, shell } from 'electron';
import * as os from 'os';
import * as path from 'path';
import type { IntegrationSnapshot } from './integration';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const integration = require('./integration');

export function registerIntegrationIpc(): void {
  ipcMain.handle('integration:detect', async (): Promise<IntegrationSnapshot> => {
    return integration.snapshot();
  });

  ipcMain.handle('integration:copy', async (_event, text: unknown): Promise<boolean> => {
    if (typeof text !== 'string' || text.length === 0) return false;
    // Electron clipboard.writeText is synchronous and returns void; treat the
    // absence of an exception as success.
    clipboard.writeText(text);
    return true;
  });

  ipcMain.handle(
    'integration:open-claude-dir',
    async (): Promise<{ opened: boolean; reason?: string }> => {
      const dir = path.join(os.homedir(), '.claude');
      const err = await shell.openPath(dir);
      if (err) {
        return { opened: false, reason: err };
      }
      return { opened: true };
    }
  );
}
