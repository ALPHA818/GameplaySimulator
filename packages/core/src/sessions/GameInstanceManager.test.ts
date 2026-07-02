import type {
  AdapterType,
  BotLaunchPlan,
  GameInstanceConfig,
  GameProfile,
  SimulationRunConfig
} from '../types';
import { describe, expect, it } from 'vitest';
import {
  GameInstanceManager,
  planGameInstances,
  type GameInstanceManagerCapabilities,
  type ManagedAdapterHealth,
  type ManagedGameAdapter,
  type ManagedGameAdapterInstance
} from './GameInstanceManager';

const gameProfile: GameProfile = {
  gameId: 'test-game',
  gameName: 'Test Game',
  version: '1.0',
  engine: { type: 'unity' },
  launch: {
    executablePath: '/games/test-game/TestGame',
    workingDirectory: '/games/test-game',
    arguments: ['--qa'],
    platform: 'linux'
  },
  adapter: {
    type: 'instrumented',
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
  knownContent: {
    locations: [],
    characters: [],
    items: [],
    quests: [],
    mechanics: [],
    notes: []
  }
};

const runConfig: SimulationRunConfig = {
  sessionId: 'session-001',
  gameProfilePath: 'memory://test-game',
  adapterType: 'instrumented',
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
      desiredCount: 5,
      maxCount: 20,
      scalingMode: 'auto',
      priority: 10,
      resourceWeight: 'medium'
    }
  ],
  globalBotLimit: 10,
  perGameInstanceBotLimit: 2,
  actionDelayMs: 250,
  maxActionsPerBot: 100,
  resourceLimits: {
    maxCpuPercent: 80,
    maxRamPercent: 80,
    maxGpuPercent: 80,
    reserveRamMb: 1024,
    maxGameInstances: 4,
    allowAutoScaling: true
  }
};

function launchPlans(count: number): BotLaunchPlan[] {
  return Array.from({ length: count }, (_, index) => ({
    botId: `explorer-${String(index + 1).padStart(3, '0')}`,
    profileId: 'explorer',
    displayName: `Explorer Bot ${index + 1}`,
    playstyle: 'explorer',
    seed: index + 100,
    resourceWeight: 'medium',
    launchIndex: index + 1
  }));
}

class FakeAdapter implements ManagedGameAdapter {
  readonly adapterType: AdapterType;
  readonly capabilities: GameInstanceManagerCapabilities;
  readonly launchCalls: GameInstanceConfig[] = [];
  readonly running = new Map<string, boolean>();

  constructor(capabilities: Partial<GameInstanceManagerCapabilities> = {}, adapterType: AdapterType = 'instrumented') {
    this.adapterType = adapterType;
    this.capabilities = {
      supportsMultipleInstances: true,
      supportsMultipleBotsPerInstance: true,
      supportsSaveIsolation: true,
      ...capabilities
    };
  }

  async launchInstance(config: GameInstanceConfig): Promise<ManagedGameAdapterInstance> {
    this.launchCalls.push(config);
    this.running.set(config.instanceId, true);

    return {
      instanceId: config.instanceId,
      gameProfileId: config.gameProfileId,
      startedAt: `2026-07-02T20:00:${String(this.launchCalls.length).padStart(2, '0')}.000Z`,
      metadata: {
        processId: 4000 + this.launchCalls.length
      }
    };
  }

  async stopInstance(instanceId: string): Promise<void> {
    this.running.set(instanceId, false);
  }

  async isRunning(instanceId: string): Promise<boolean> {
    return this.running.get(instanceId) ?? false;
  }

  async getHealth(instanceId: string): Promise<ManagedAdapterHealth> {
    const running = await this.isRunning(instanceId);

    return {
      instanceId,
      status: running ? 'running' : 'stopped',
      checkedAt: '2026-07-02T20:01:00.000Z',
      details: {
        processInfo: {
          pid: 4001,
          cpuPercent: 12,
          ramMb: 768
        }
      }
    };
  }
}

describe('GameInstanceManager', () => {
  it('plans multiple game instances and save/profile isolation', () => {
    const plan = planGameInstances({
      runConfig,
      gameProfile,
      launchPlans: launchPlans(5),
      adapterCapabilities: {
        supportsMultipleInstances: true,
        supportsMultipleBotsPerInstance: true,
        supportsSaveIsolation: true
      },
      now: '2026-07-02T20:00:00.000Z'
    });

    expect(plan.instances).toHaveLength(3);
    expect(plan.instances.map((instance) => instance.status.assignedBots.length)).toEqual([2, 2, 1]);
    expect(plan.instances[0].config.saveProfileId).toBe('session-001-game-instance-001');
    expect(plan.instances[0].config.isolatedSaveDirectory).toBe(
      'runs/session-001/saves/game-instance-001'
    );
  });

  it('supports one active bot per instance when the adapter requires it', () => {
    const plan = planGameInstances({
      runConfig: { ...runConfig, perGameInstanceBotLimit: 4 },
      gameProfile,
      launchPlans: launchPlans(3),
      adapterCapabilities: {
        supportsMultipleInstances: true,
        supportsMultipleBotsPerInstance: false,
        supportsSaveIsolation: false
      }
    });

    expect(plan.instances).toHaveLength(3);
    expect(plan.instances.every((instance) => instance.assignedBots.length === 1)).toBe(true);
    expect(plan.instances[0].config.maxBots).toBe(1);
  });

  it('queues later batches when the adapter cannot run multiple instances', () => {
    const plan = planGameInstances({
      runConfig: { ...runConfig, runMode: 'parallel' },
      gameProfile: {
        ...gameProfile,
        adapter: {
          ...gameProfile.adapter,
          supportsMultipleInstances: false
        }
      },
      launchPlans: launchPlans(3),
      adapterCapabilities: {
        supportsMultipleInstances: false,
        supportsMultipleBotsPerInstance: false,
        supportsSaveIsolation: false
      }
    });

    expect(plan.concurrencyModel).toBe('sequential');
    expect(plan.instances).toHaveLength(1);
    expect(plan.instances[0].status.assignedBots).toEqual(['explorer-001']);
    expect(plan.queuedBotIds).toEqual(['explorer-002', 'explorer-003']);
    expect(plan.warnings.join(' ')).toContain('sequential batches');
  });

  it('launches, tracks, and stops game instances', async () => {
    const adapter = new FakeAdapter();
    const manager = new GameInstanceManager({
      adapter,
      runConfig,
      gameProfile,
      launchPlans: launchPlans(3)
    });

    const launched = await manager.launchInstances();

    expect(launched).toHaveLength(2);
    expect(launched.every((status) => status.status === 'running')).toBe(true);
    expect(launched[0].processId).toBeGreaterThan(4000);
    expect(adapter.launchCalls[0].environment.GAMEPLAY_SIMULATOR_ASSIGNED_BOTS).toBe(
      'explorer-001,explorer-002'
    );

    const stopped = await manager.stopInstance('game-instance-001');

    expect(stopped.status).toBe('stopped');
    expect(await adapter.isRunning('game-instance-001')).toBe(false);
  });

  it('restarts crashed instances when configured', async () => {
    const adapter = new FakeAdapter();
    const manager = new GameInstanceManager({
      adapter,
      runConfig,
      gameProfile,
      launchPlans: launchPlans(1),
      restartCrashedInstances: true
    });

    await manager.launchInstances();
    adapter.running.set('game-instance-001', false);

    const statuses = await manager.refreshHealth();

    expect(statuses[0].status).toBe('running');
    expect(adapter.launchCalls).toHaveLength(2);
  });
});
