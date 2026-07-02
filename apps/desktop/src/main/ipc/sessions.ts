import { ipcMain } from 'electron';
import type { SessionService } from '../services/sessionService';

export function registerSessionIpc(service: SessionService): void {
  ipcMain.handle('sessions:getStatus', () => service.getStatus());
}
