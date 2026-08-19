import { BrowserWindow, ipcMain } from 'electron';
import { WorkflowService } from './workflow-service';
import type { CompleteWorkflowTaskInput, WorkflowDefinition, WorkflowRunInput } from './workflow-types';

export function registerWorkflowIpc(): void {
  const service = new WorkflowService();
  const changed = (): void => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('workflow:updated');
  };
  ipcMain.handle('workflow:snapshot', () => service.snapshot());
  ipcMain.handle('workflow:save', (_event, value: WorkflowDefinition) => {
    const result = service.saveDefinition(value); changed(); return result;
  });
  ipcMain.handle('workflow:create-run', async (_event, id: string, input: WorkflowRunInput) => {
    const result = await service.createRun(id, input); changed(); return result;
  });
  ipcMain.handle('workflow:complete-task', (_event, runId: string, taskId: string, input: CompleteWorkflowTaskInput) => {
    const result = service.complete(runId, taskId, input); changed(); return result;
  });
  ipcMain.handle('workflow:skip-task', (_event, runId: string, taskId: string, reason: string) => {
    const result = service.skip(runId, taskId, reason); changed(); return result;
  });
  ipcMain.handle('workflow:execute-task', async (event, runId: string, taskId: string) => {
    const result = await service.execute(runId, taskId, event.sender); changed(); return result;
  });
  ipcMain.handle('workflow:cancel-task', (_event, runId: string, taskId: string) =>
    service.cancel(runId, taskId)
  );
  ipcMain.handle('workflow:cleanup-run', async (_event, runId: string) => {
    const result = await service.cleanup(runId); changed(); return result;
  });
}
