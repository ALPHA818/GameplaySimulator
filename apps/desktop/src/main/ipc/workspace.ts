import { ipcMain } from 'electron';
import { WorkspaceDataPatchSchema, WorkspaceDataSchema } from '@core/config/workspaceData';
import type { WorkspaceRepository } from '../services/WorkspaceRepository';

export function registerWorkspaceIpc(repository: WorkspaceRepository): void {
  ipcMain.handle('workspace:load', () => repository.load());
  ipcMain.handle('workspace:save', (_event, payload: unknown) =>
    repository.save(WorkspaceDataSchema.parse(payload))
  );
  ipcMain.handle('workspace:update', (_event, payload: unknown) =>
    repository.update(WorkspaceDataPatchSchema.parse(payload))
  );
  ipcMain.handle('workspace:createBackup', () => repository.createBackup());
  ipcMain.handle('workspace:recoverFromBackup', () => repository.recoverFromBackup());
}
