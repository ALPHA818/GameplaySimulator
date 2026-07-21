import { describe, expect, it } from 'vitest';
import { ResourceManager, type RuntimeViabilityRequest, type SystemResourceSnapshot } from './ResourceManager';

const system: SystemResourceSnapshot = {
  cpuCoreCount: 8,
  totalRamMb: 16000,
  freeRamMb: 10000,
  currentCpuLoadPercent: 20,
  currentRamUsagePercent: 37.5,
  platform: 'linux',
  osRelease: 'test'
};

function request(overrides: Partial<RuntimeViabilityRequest['runConfig']> = {}): RuntimeViabilityRequest {
  return {
    systemSnapshot: system,
    gameProfile: {
      gameId: 'test-game',
      gameName: 'Test Game',
      version: '1',
      engine: { type: 'unity' },
      launch: { platform: 'linux', arguments: [] },
      adapter: {
        type: 'unity',
        supportsMultipleInstances: true,
        supportsStateRead: true,
        supportsDirectActions: true,
        supportsScreenshots: true,
        supportsVideo: false,
        supportsSaveIsolation: true
      },
      controls: [],
      testingTargets: [],
      progressSignals: [],
      failureSignals: [],
      uiFlows: [],
      knownContent: {
        scenes: [],
        levels: [],
        locations: [],
        characters: [],
        npcs: [],
        items: [],
        quests: [],
        mainQuests: [],
        sideQuests: [],
        optionalStories: [],
        shops: [],
        bosses: [],
        menus: [],
        dialogueBranches: [],
        minigames: [],
        endings: [],
        hiddenAreas: [],
        postGameContent: [],
        collectibles: [],
        achievements: [],
        mechanics: [],
        notes: []
      }
    },
    runConfig: {
      sessionId: 'session',
      gameProfilePath: 'memory://test-game',
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
          profileId: 'combat',
          enabled: true,
          minCount: 2,
          desiredCount: 2,
          maxCount: 10,
          scalingMode: 'fixed',
          priority: 8,
          resourceWeight: 'heavy'
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
      },
      ...overrides
    }
  };
}

describe('ResourceManager', () => {
  it('recommends counts using the selected machine and run limits', () => {
    const report = new ResourceManager().estimateViabilitySync(request());

    expect(report.canRun).toBe(true);
    expect(report.recommendedTotalBots).toBeGreaterThan(0);
    expect(report.botAllocation.find((allocation) => allocation.profileId === 'combat')?.recommendedCount).toBe(2);
  });

  it('downscales auto pools when the request is too heavy', () => {
    const report = new ResourceManager().estimateViabilitySync(
      request({
        resourceLimits: {
          maxCpuPercent: 35,
          maxRamPercent: 50,
          maxGpuPercent: 80,
          reserveRamMb: 2048,
          maxGameInstances: 2,
          allowAutoScaling: true
        }
      })
    );

    const explorer = report.botAllocation.find((allocation) => allocation.profileId === 'explorer');

    expect(explorer?.recommendedCount).toBeLessThan(explorer?.requestedCount ?? 0);
    expect(explorer?.reason).toContain('Reduced');
    expect(report.warnings.length).toBeGreaterThan(0);
  });

  it('reports a blocker when a fixed pool is impossible', () => {
    const report = new ResourceManager().estimateViabilitySync(
      request({
        globalBotLimit: 1,
        botPools: [
          {
            profileId: 'combat',
            enabled: true,
            minCount: 3,
            desiredCount: 3,
            maxCount: 3,
            scalingMode: 'fixed',
            priority: 10,
            resourceWeight: 'very_heavy'
          }
        ]
      })
    );

    expect(report.canRun).toBe(false);
    expect(report.blockers.length).toBeGreaterThan(0);
    expect(report.botAllocation[0].reason).toContain('Fixed');
  });
});
