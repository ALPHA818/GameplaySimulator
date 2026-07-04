import { ipcMain } from 'electron';
import { z } from 'zod';
import { RuntimeViabilityReportSchema, SimulationRunConfigSchema, GameProfileSchema } from '@core/types';
import type { SimulationService } from '../services/simulationService';

const RuntimeViabilityRequestSchema = z.object({
  runConfig: SimulationRunConfigSchema,
  gameProfile: GameProfileSchema
});

export function registerResourceIpc(service: Pick<SimulationService, 'estimateViability'>): void {
  ipcMain.handle('resources:estimateViability', async (_event, payload: unknown) => {
    const request = RuntimeViabilityRequestSchema.parse(payload);
    const report = service.estimateViability(request);

    return RuntimeViabilityReportSchema.parse(report);
  });
}
