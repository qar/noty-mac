import { app, ipcMain } from 'electron';
import { LocalAiService } from './local-ai-service';
import type {
  LocalAiCreateResult,
  LocalAiDetectionResult,
  LocalAiProgram,
  LocalAiStartResult,
} from './local-ai-types';

let service: LocalAiService | null = null;

export function registerLocalAiIpc(): LocalAiService {
  service = new LocalAiService();

  ipcMain.handle('local-ai:list', (): LocalAiProgram[] => service!.list());
  ipcMain.handle(
    'local-ai:create',
    (_event, templateId: unknown): LocalAiCreateResult => service!.create(templateId)
  );
  ipcMain.handle(
    'local-ai:duplicate',
    (_event, id: unknown): LocalAiCreateResult => service!.duplicate(id)
  );
  ipcMain.handle(
    'local-ai:save',
    (_event, program: unknown): LocalAiProgram[] => service!.save(program)
  );
  ipcMain.handle(
    'local-ai:remove',
    (_event, id: unknown): LocalAiProgram[] => service!.remove(id)
  );
  ipcMain.handle(
    'local-ai:detect',
    (_event, id: unknown): Promise<LocalAiDetectionResult> => service!.detect(id)
  );
  ipcMain.handle(
    'local-ai:run',
    (event, id: unknown, prompt: unknown, runId: unknown): Promise<LocalAiStartResult> =>
      service!.start(id, prompt, runId, event.sender)
  );
  ipcMain.handle('local-ai:cancel', (event, runId: unknown): boolean =>
    service!.cancel(runId, event.sender.id)
  );

  app.once('before-quit', () => service?.stopAll());
  return service;
}

export function stopLocalAiRunsForOwner(ownerId: number): void {
  service?.stopRunsForOwner(ownerId);
}
