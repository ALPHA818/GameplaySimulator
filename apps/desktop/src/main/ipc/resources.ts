import { ipcMain } from 'electron';
import { z } from 'zod';
import { RuntimeViabilityReportSchema, SimulationRunConfigSchema, GameProfileSchema } from '@core/types';
import { resourceManager } from '@core/resources/ResourceManager';

const RuntimeViabilityRequestSchema = z.object({
  runConfig: SimulationRunConfigSchema,
  gameProfile: GameProfileSchema
});

export function registerResourceIpc(): void {
  ipcMain.handle('resources:estimateViability', async (_event, payload: unknown) => {
    const request = RuntimeViabilityRequestSchema.parse(payload);
    const report = resourceManager.estimateViabilitySync(request);

    return RuntimeViabilityReportSchema.parse(report);
  });
}
