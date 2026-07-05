import { z } from 'zod';
import { AdapterTypeSchema } from './adapter';
import { BotPoolConfigSchema } from './bot';

export const RunModeSchema = z.enum(['parallel', 'sequential', 'hybrid']);

export const ResourceLimitsSchema = z.object({
  maxCpuPercent: z.number().min(1).max(100),
  maxRamPercent: z.number().min(1).max(100),
  maxGpuPercent: z.number().min(1).max(100).optional(),
  reserveRamMb: z.number().min(0),
  maxGameInstances: z.number().int().min(1),
  allowAutoScaling: z.boolean()
});

export const SimulationRunConfigSchema = z
  .object({
    sessionId: z.string().min(1),
    gameProfilePath: z.string().min(1),
    adapterType: AdapterTypeSchema,
    runMode: RunModeSchema,
    runUntilStopped: z.boolean(),
    maxRuntimeMinutes: z.number().positive().optional(),
    stopOnCriticalIssue: z.boolean(),
    saveScreenshots: z.boolean(),
    saveVideo: z.boolean().optional(),
    screenshotEveryNActions: z.number().int().positive().optional(),
    saveActionTimeline: z.boolean(),
    saveStateSnapshots: z.boolean(),
    useMockRuntime: z.boolean().optional(),
    botPools: z.array(BotPoolConfigSchema).min(1),
    globalBotLimit: z.number().int().min(1),
    perGameInstanceBotLimit: z.number().int().min(1),
    actionDelayMs: z.number().int().min(0),
    maxActionsPerBot: z.number().int().positive().optional(),
    resourceLimits: ResourceLimitsSchema
  })
  .superRefine((config, context) => {
    const enabledMinimumBots = config.botPools
      .filter((pool) => pool.enabled)
      .reduce((total, pool) => total + pool.minCount, 0);

    if (enabledMinimumBots > config.globalBotLimit) {
      context.addIssue({
        code: 'custom',
        path: ['globalBotLimit'],
        message: 'globalBotLimit must allow the minimum enabled bot pool size.'
      });
    }
  });

export type RunMode = z.infer<typeof RunModeSchema>;
export type ResourceLimits = z.infer<typeof ResourceLimitsSchema>;
export type SimulationRunConfig = z.infer<typeof SimulationRunConfigSchema>;
