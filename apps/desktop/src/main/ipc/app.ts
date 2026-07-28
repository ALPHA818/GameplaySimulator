import { app, ipcMain } from 'electron';
import type { ApplicationLogger } from '../services/ApplicationLogger';
import { RendererErrorDetailsSchema } from './validation';

export function registerAppIpc(
  logger: ApplicationLogger,
  openPath: (path: string) => Promise<string>
): void {
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('app:openApplicationLogs', async () => {
    const error = await openPath(logger.logsDirectory);
    return {
      opened: error.length === 0,
      message: error.length === 0 ? 'Application logs opened.' : error
    };
  });
  ipcMain.handle('app:reportRendererError', (_event, details: unknown) => {
    logger.logFailure('renderer_error_boundary', new Error('Renderer interface failed.'), {
      details: RendererErrorDetailsSchema.parse(details)
    });
  });
}
