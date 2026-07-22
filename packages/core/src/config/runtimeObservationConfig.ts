import { z } from 'zod';

export const ObservationModeSchema = z.enum([
  'background',
  'follow-first-bot',
  'follow-selected-bot',
  'show-all-instances'
]);

export const RuntimeObservationConfigSchema = z.object({
  showBotGameplay: z.boolean().default(false),
  observationMode: ObservationModeSchema.default('background'),
  selectedBotId: z.string().trim().min(1).optional(),
  bringGameToFrontOnAction: z.boolean().default(false),
  visibleActionDelayMs: z.number().int().min(0).max(60_000).default(250),
  showActionInformation: z.boolean().default(true),
  maxVisibleGameWindows: z.number().int().min(1).max(32).default(1)
});

export type ObservationMode = z.infer<typeof ObservationModeSchema>;
export type RuntimeObservationConfig = z.infer<typeof RuntimeObservationConfigSchema>;

export interface RuntimeObservationOverrides {
  showBotGameplay?: boolean;
  observationMode?: ObservationMode;
  selectedObservationBotId?: string;
  bringGameToFrontOnAction?: boolean;
  visibleActionDelayMs?: number;
  showActionInformation?: boolean;
  maxVisibleGameWindows?: number;
}

export const defaultRuntimeObservationConfig: RuntimeObservationConfig =
  RuntimeObservationConfigSchema.parse({});

export function hasRuntimeObservationOverrides(config: RuntimeObservationOverrides): boolean {
  return config.showBotGameplay !== undefined ||
    config.observationMode !== undefined ||
    config.selectedObservationBotId !== undefined ||
    config.bringGameToFrontOnAction !== undefined ||
    config.visibleActionDelayMs !== undefined ||
    config.showActionInformation !== undefined ||
    config.maxVisibleGameWindows !== undefined;
}

export function resolveRuntimeObservationConfig(
  overrides: RuntimeObservationOverrides,
  globalConfig: RuntimeObservationConfig = defaultRuntimeObservationConfig
): RuntimeObservationConfig {
  const resolved = RuntimeObservationConfigSchema.parse({
    ...globalConfig,
    showBotGameplay: overrides.showBotGameplay ?? globalConfig.showBotGameplay,
    observationMode: overrides.observationMode ?? globalConfig.observationMode,
    selectedBotId: overrides.selectedObservationBotId ?? globalConfig.selectedBotId,
    bringGameToFrontOnAction:
      overrides.bringGameToFrontOnAction ?? globalConfig.bringGameToFrontOnAction,
    visibleActionDelayMs: overrides.visibleActionDelayMs ?? globalConfig.visibleActionDelayMs,
    showActionInformation: overrides.showActionInformation ?? globalConfig.showActionInformation,
    maxVisibleGameWindows: overrides.maxVisibleGameWindows ?? globalConfig.maxVisibleGameWindows
  });

  if (!resolved.showBotGameplay) {
    return {
      ...resolved,
      observationMode: 'background',
      bringGameToFrontOnAction: false
    };
  }

  return resolved;
}

export function applyRuntimeObservationToRunConfig<T extends object>(
  runConfig: T & RuntimeObservationOverrides,
  observation: RuntimeObservationConfig
): T & Required<Omit<RuntimeObservationOverrides, 'selectedObservationBotId'>> & {
  selectedObservationBotId?: string;
} {
  return {
    ...runConfig,
    showBotGameplay: observation.showBotGameplay,
    observationMode: observation.observationMode,
    selectedObservationBotId: observation.selectedBotId,
    bringGameToFrontOnAction: observation.bringGameToFrontOnAction,
    visibleActionDelayMs: observation.visibleActionDelayMs,
    showActionInformation: observation.showActionInformation,
    maxVisibleGameWindows: observation.maxVisibleGameWindows
  };
}
