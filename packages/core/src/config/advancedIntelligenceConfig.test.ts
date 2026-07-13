import { describe, expect, it } from 'vitest';
import {
  AdvancedIntelligenceConfigSchema,
  defaultAdvancedIntelligenceConfig,
  getAdvancedIntelligenceWarnings,
  getEnabledAdvancedIntelligenceFeatures
} from './advancedIntelligenceConfig';

describe('AdvancedIntelligenceConfig', () => {
  it('defaults every advanced feature off until real runtime is acknowledged', () => {
    expect(defaultAdvancedIntelligenceConfig.realRuntimePrerequisiteAcknowledged).toBe(false);
    expect(defaultAdvancedIntelligenceConfig.visionModelEnabled).toBe(false);
    expect(defaultAdvancedIntelligenceConfig.visionModelMode).toBe('off');
    expect(getEnabledAdvancedIntelligenceFeatures(defaultAdvancedIntelligenceConfig)).toEqual([]);
    expect(getAdvancedIntelligenceWarnings(defaultAdvancedIntelligenceConfig)).toEqual([]);
  });

  it('warns when advanced features are enabled before the real runtime prerequisite', () => {
    const config = AdvancedIntelligenceConfigSchema.parse({
      visionModelEnabled: true,
      visionModelMode: 'local',
      mapMemoryEnabled: true
    });

    expect(getEnabledAdvancedIntelligenceFeatures(config)).toEqual(['vision_model', 'map_memory']);
    expect(getAdvancedIntelligenceWarnings(config)).toHaveLength(1);
  });

  it('allows enabled advanced features after the real runtime prerequisite is acknowledged', () => {
    const config = AdvancedIntelligenceConfigSchema.parse({
      realRuntimePrerequisiteAcknowledged: true,
      actionReplayScriptsEnabled: true,
      bugDeduplicationMode: 'state-aware',
      engineSpecificPluginsEnabled: true
    });

    expect(getEnabledAdvancedIntelligenceFeatures(config)).toEqual([
      'action_replay_scripts',
      'advanced_bug_deduplication',
      'engine_specific_plugins'
    ]);
    expect(getAdvancedIntelligenceWarnings(config)).toEqual([]);
  });

  it('rejects unknown advanced mode values', () => {
    expect(() =>
      AdvancedIntelligenceConfigSchema.parse({
        visionModelMode: 'magic'
      })
    ).toThrow();
  });
});
