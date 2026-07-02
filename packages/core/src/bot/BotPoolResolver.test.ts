import type { BotProfile, RuntimeViabilityReport, SimulationRunConfig } from '../types';
import { describe, expect, it } from 'vitest';
import { resolveBotPools } from './BotPoolResolver';

const botProfiles: BotProfile[] = [
  {
    profileId: 'explorer',
    displayName: 'Explorer Bot',
    botType: 'explorer',
    goals: [],
    recommendedMinCount: 1,
    recommendedMaxCount: 20,
    defaultResourceWeight: 'medium',
    tags: [],
    config: {}
  },
  {
    profileId: 'combat-tester',
    displayName: 'Combat Tester Bot',
    botType: 'combat',
    goals: [],
    recommendedMinCount: 1,
    recommendedMaxCount: 10,
    defaultResourceWeight: 'heavy',
    tags: [],
    config: { playstyle: 'combat' }
  },
  {
    profileId: 'chaos-monkey',
    displayName: 'Chaos Monkey Bot',
    botType: 'chaos',
    goals: [],
    recommendedMinCount: 0,
    recommendedMaxCount: 5,
    defaultResourceWeight: 'very_heavy',
    tags: [],
    config: {}
  }
];

const runConfig: SimulationRunConfig = {
  sessionId: 'session',
  gameProfilePath: 'memory://game',
  adapterType: 'unity',
  runMode: 'parallel',
  runUntilStopped: false,
  maxRuntimeMinutes: 10,
  stopOnCriticalIssue: true,
  saveScreenshots: true,
  saveVideo: false,
  saveActionTimeline: true,
  saveStateSnapshots: true,
  botPools: [
    {
      profileId: 'explorer',
      enabled: true,
      minCount: 1,
      desiredCount: 12,
      maxCount: 20,
      scalingMode: 'auto',
      priority: 10,
      resourceWeight: 'medium'
    },
    {
      profileId: 'combat-tester',
      enabled: true,
      minCount: 2,
      desiredCount: 2,
      maxCount: 10,
      scalingMode: 'fixed',
      priority: 8,
      resourceWeight: 'heavy'
    },
    {
      profileId: 'chaos-monkey',
      enabled: true,
      minCount: 0,
      desiredCount: 4,
      maxCount: 5,
      scalingMode: 'auto',
      priority: 1,
      resourceWeight: 'very_heavy'
    }
  ],
  globalBotLimit: 16,
  perGameInstanceBotLimit: 4,
  actionDelayMs: 250,
  maxActionsPerBot: 500,
  resourceLimits: {
    maxCpuPercent: 80,
    maxRamPercent: 80,
    maxGpuPercent: 80,
    reserveRamMb: 1024,
    maxGameInstances: 4,
    allowAutoScaling: true
  }
};

function report(overrides: Partial<RuntimeViabilityReport> = {}): RuntimeViabilityReport {
  return {
    canRun: true,
    recommendedTotalBots: 10,
    recommendedGameInstances: 3,
    warnings: [],
    blockers: [],
    estimatedCpuPercent: 40,
    estimatedRamMb: 6000,
    botAllocation: [
      {
        profileId: 'explorer',
        requestedCount: 12,
        recommendedCount: 6,
        reason: 'Auto scaled.'
      },
      {
        profileId: 'combat-tester',
        requestedCount: 2,
        recommendedCount: 2,
        reason: 'Fixed.'
      },
      {
        profileId: 'chaos-monkey',
        requestedCount: 4,
        recommendedCount: 2,
        reason: 'Auto scaled.'
      }
    ],
    ...overrides
  };
}

describe('BotPoolResolver', () => {
  it('creates multiple unique bots from the same profile', () => {
    const plans = resolveBotPools({ runConfig, botProfiles, viabilityReport: report() });

    expect(plans).toHaveLength(10);
    expect(plans.slice(0, 3).map((plan) => plan.botId)).toEqual([
      'explorer-001',
      'explorer-002',
      'explorer-003'
    ]);
    expect(new Set(plans.map((plan) => plan.botId)).size).toBe(plans.length);
  });

  it('uses fixed desired counts and auto recommendations', () => {
    const plans = resolveBotPools({ runConfig, botProfiles, viabilityReport: report() });

    expect(plans.filter((plan) => plan.profileId === 'combat-tester')).toHaveLength(2);
    expect(plans.filter((plan) => plan.profileId === 'explorer')).toHaveLength(6);
    expect(plans.filter((plan) => plan.profileId === 'chaos-monkey')).toHaveLength(2);
  });

  it('never exceeds maxCount or the global bot limit', () => {
    const plans = resolveBotPools({
      runConfig: {
        ...runConfig,
        globalBotLimit: 7,
        botPools: runConfig.botPools.map((pool) =>
          pool.profileId === 'explorer' ? { ...pool, maxCount: 4 } : pool
        )
      },
      botProfiles,
      viabilityReport: report({
        recommendedTotalBots: 30,
        botAllocation: [
          {
            profileId: 'explorer',
            requestedCount: 12,
            recommendedCount: 30,
            reason: 'High estimate.'
          },
          {
            profileId: 'combat-tester',
            requestedCount: 2,
            recommendedCount: 2,
            reason: 'Fixed.'
          },
          {
            profileId: 'chaos-monkey',
            requestedCount: 4,
            recommendedCount: 5,
            reason: 'Auto scaled.'
          }
        ]
      })
    });

    expect(plans).toHaveLength(7);
    expect(plans.filter((plan) => plan.profileId === 'explorer')).toHaveLength(4);
  });

  it('gives higher-priority pools bots first when limited', () => {
    const plans = resolveBotPools({
      runConfig: { ...runConfig, globalBotLimit: 1 },
      botProfiles,
      viabilityReport: report()
    });

    expect(plans.map((plan) => plan.profileId)).toEqual(['explorer']);
  });
});
