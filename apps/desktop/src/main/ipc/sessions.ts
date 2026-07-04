import { ipcMain } from 'electron';
import type { SimulationService } from '../services/simulationService';

export function registerSessionIpc(service: Pick<SimulationService, 'getStatus'>): void {
  ipcMain.handle('sessions:getStatus', () => service.getStatus());
}
