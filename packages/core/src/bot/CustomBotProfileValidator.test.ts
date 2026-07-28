import { describe, expect, it } from 'vitest';
import type { CustomBotProfile } from '../types';
import { validateCustomBotProfile } from './CustomBotProfileValidator';

function customProfile(overrides: Partial<CustomBotProfile> = {}): CustomBotProfile {
  return {
    profileId: 'farming-system-tester',
    displayName: 'Farming System Tester',
    botType: 'farming-system-tester',
    profileGroup: 'custom',
    specializationCategory: 'gameplay-systems',
    requiredCapabilities: ['state-read', 'direct-actions'],
    recommendedGameTypes: ['instrumented', 'unity'],
    incompatibleGameTypes: [],
    bestUsedFor: ['Crop planting, growth, harvesting, and persistence.'],
    limitations: ['Weather quality still needs human review.'],
    beginnerRecommended: false,
    beginnerExplanation: 'Start with one crop and one bot.',
    defaultEnabled: false,
    estimatedComplexity: 'medium',
    playstyle: 'custom-gameplay-systems',
    description: 'Tests crop planting, growth, harvesting, and persistence.',
    aggression: 0.1,
    curiosity: 0.7,
    riskTolerance: 0.4,
    repetitionTolerance: 0.9,
    bugHuntingBias: 0.8,
    preferredActions: ['plant-crop', 'water-crop', 'harvest-crop'],
    avoidedActions: ['delete-farm'],
    targetScenes: ['Farm'],
    targetFeatures: ['farming', 'crop-growth'],
    targetIssueCategories: ['gameplay', 'save_load'],
    successCriteria: ['A planted crop grows and can be harvested after reload.'],
    goals: [{
      goalId: 'farming-system-tester-goal',
      name: 'Farming Test Goal',
      priority: 10,
      successCriteria: ['A planted crop grows and can be harvested after reload.'],
      targetIssueCategories: ['gameplay', 'save_load']
    }],
    recommendedMinCount: 1,
    recommendedMaxCount: 3,
    defaultResourceWeight: 'medium',
    tags: ['farming'],
    config: { customProfile: true },
    ...overrides
  };
}

describe('validateCustomBotProfile', () => {
  it('accepts a complete custom specialist profile', () => {
    const result = validateCustomBotProfile(customProfile(), []);

    expect(result.valid).toBe(true);
    expect(result.profile?.profileGroup).toBe('custom');
    expect(result.warnings).toEqual([]);
  });

  it('rejects duplicate profile IDs', () => {
    const profile = customProfile();
    const result = validateCustomBotProfile(profile, [profile]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      path: 'profileId',
      message: 'Profile ID must be unique.'
    });
  });

  it('rejects a maximum count below the minimum', () => {
    const result = validateCustomBotProfile(
      customProfile({ recommendedMinCount: 4, recommendedMaxCount: 2 }),
      []
    );

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.message).join(' ')).toContain(
      'cannot be below the recommended minimum'
    );
  });

  it('rejects unknown capabilities and unsupported issue categories', () => {
    const candidate = {
      ...customProfile(),
      requiredCapabilities: ['telepathy'],
      targetIssueCategories: ['crop_magic']
    };
    const result = validateCustomBotProfile(candidate, []);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.path === 'requiredCapabilities.0')).toBe(true);
    expect(result.errors.some((error) => error.path === 'targetIssueCategories.0')).toBe(true);
  });

  it('warns without rejecting an empty preferred-action list', () => {
    const result = validateCustomBotProfile(customProfile({ preferredActions: [] }), []);

    expect(result.valid).toBe(true);
    expect(result.warnings[0].path).toBe('preferredActions');
    expect(result.warnings[0].message).toContain('no preferred actions');
  });
});
