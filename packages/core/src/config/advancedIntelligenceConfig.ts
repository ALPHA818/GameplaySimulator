import { z } from 'zod';

export const VisionModelModeSchema = z.enum(['off', 'local', 'external']);
export const BotStrategyTuningModeSchema = z.enum([
  'profile-defaults',
  'balanced',
  'exploration-heavy',
  'bug-hunting-heavy'
]);
export const BugDeduplicationModeSchema = z.enum(['basic', 'fingerprint', 'state-aware']);

export const AdvancedIntelligenceConfigSchema = z.object({
  realRuntimePrerequisiteAcknowledged: z.boolean().default(false),
  visionModelEnabled: z.boolean().default(false),
  visionModelMode: VisionModelModeSchema.default('off'),
  mapMemoryEnabled: z.boolean().default(false),
  questInferenceEnabled: z.boolean().default(false),
  botStrategyTuningEnabled: z.boolean().default(false),
  botStrategyTuningMode: BotStrategyTuningModeSchema.default('profile-defaults'),
  longOvernightTestMode: z.boolean().default(false),
  performanceGraphsEnabled: z.boolean().default(false),
  heatmapsEnabled: z.boolean().default(false),
  actionReplayScriptsEnabled: z.boolean().default(false),
  bugDeduplicationMode: BugDeduplicationModeSchema.default('basic'),
  engineSpecificPluginsEnabled: z.boolean().default(false)
});

export type VisionModelMode = z.infer<typeof VisionModelModeSchema>;
export type BotStrategyTuningMode = z.infer<typeof BotStrategyTuningModeSchema>;
export type BugDeduplicationMode = z.infer<typeof BugDeduplicationModeSchema>;
export type AdvancedIntelligenceConfig = z.infer<typeof AdvancedIntelligenceConfigSchema>;

export const defaultAdvancedIntelligenceConfig: AdvancedIntelligenceConfig =
  AdvancedIntelligenceConfigSchema.parse({});

export function getEnabledAdvancedIntelligenceFeatures(config: AdvancedIntelligenceConfig): string[] {
  const features: string[] = [];

  if (config.visionModelEnabled) {
    features.push('vision_model');
  }

  if (config.mapMemoryEnabled) {
    features.push('map_memory');
  }

  if (config.questInferenceEnabled) {
    features.push('quest_inference');
  }

  if (config.botStrategyTuningEnabled) {
    features.push('bot_strategy_tuning');
  }

  if (config.longOvernightTestMode) {
    features.push('long_overnight_test_mode');
  }

  if (config.performanceGraphsEnabled) {
    features.push('performance_graphs');
  }

  if (config.heatmapsEnabled) {
    features.push('heatmaps');
  }

  if (config.actionReplayScriptsEnabled) {
    features.push('action_replay_scripts');
  }

  if (config.bugDeduplicationMode !== 'basic') {
    features.push('advanced_bug_deduplication');
  }

  if (config.engineSpecificPluginsEnabled) {
    features.push('engine_specific_plugins');
  }

  return features;
}

export function getAdvancedIntelligenceWarnings(config: AdvancedIntelligenceConfig): string[] {
  const enabledFeatures = getEnabledAdvancedIntelligenceFeatures(config);

  if (enabledFeatures.length === 0) {
    return [];
  }

  if (!config.realRuntimePrerequisiteAcknowledged) {
    return [
      'Advanced intelligence settings should stay off until real adapter runtime, state, control, evidence, and reports are working for the selected game.'
    ];
  }

  return [];
}
