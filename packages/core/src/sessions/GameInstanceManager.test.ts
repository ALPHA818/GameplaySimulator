import type {
  AdapterType,
  BotLaunchPlan,
  GameInstanceConfig,
  GameProfile,
  SimulationRunConfig
} from '../types';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
  uiFlows: [],
  saveIsolation: {
    mode: 'temp-directory',
    cleanupTempSaves: false,
    preserveBotSaves: true
  },
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

const fileSystem = { cp, mkdir, rm };

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
  readonly healthOverrides = new Map<string, ManagedAdapterHealth>();

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
    const override = this.healthOverrides.get(instanceId);

    if (override) {
      return override;
    }

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
      resolve(process.cwd(), 'runs/session-001/saves/game-instance-001')
    );
    expect(plan.instances[0].status.saveIsolationMode).toBe('temp-directory');
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

  it('warns when multiple instances would share default saves', () => {
    const plan = planGameInstances({
      runConfig,
      gameProfile: {
        ...gameProfile,
        saveIsolation: {
          mode: 'none',
          cleanupTempSaves: false,
          preserveBotSaves: true
        }
      },
      launchPlans: launchPlans(5),
      adapterCapabilities: {
        supportsMultipleInstances: true,
        supportsMultipleBotsPerInstance: true,
        supportsSaveIsolation: true
      }
    });

    expect(plan.instances).toHaveLength(3);
    expect(plan.warnings.join(' ')).toContain('without save isolation');
    expect(plan.instances[0].config.saveProfileId).toBeUndefined();
  });

  it('launches, tracks, and stops game instances', async () => {
    const adapter = new FakeAdapter();
    const manager = new GameInstanceManager({
      adapter,
      runConfig,
      gameProfile,
      launchPlans: launchPlans(3),
      fileSystem
    });

    const launched = await manager.startAllInstances();

    expect(launched).toHaveLength(2);
    expect(launched.every((status) => status.status === 'running')).toBe(true);
    expect(launched[0].processId).toBeGreaterThan(4000);
    expect(manager.getInstanceStatus('game-instance-001').status).toBe('running');
    expect(manager.getAllInstanceStatuses()).toHaveLength(2);
    expect(manager.getLiveInstanceRecord('game-instance-001').adapterInstance?.metadata.processId).toBe(4001);
    expect(adapter.launchCalls[0].environment.GAMEPLAY_SIMULATOR_ASSIGNED_BOTS).toBe(
      'explorer-001,explorer-002'
    );
    expect(adapter.launchCalls[0].environment.GAMEPLAY_SIMULATOR_SAVE_PROFILE_ID).toBe(
      'session-001-game-instance-001'
    );
    expect(adapter.launchCalls[0].environment.GAMEPLAY_SIMULATOR_SAVE_DIRECTORY).toBe(
      resolve(process.cwd(), 'runs/session-001/saves/game-instance-001')
    );
    expect(manager.getAssignedLaunchPlans().map((plan) => plan.assignedGameInstanceId)).toEqual([
      'game-instance-001',
      'game-instance-001',
      'game-instance-002'
    ]);
    expect(manager.drainEvents().map((event) => event.eventType)).toEqual([
      'instance_save_isolation',
      'instance_start',
      'instance_save_isolation',
      'instance_start'
    ]);

    const stopped = await manager.stopInstance('game-instance-001');

    expect(stopped.status).toBe('stopped');
    expect(await adapter.isRunning('game-instance-001')).toBe(false);
    expect(manager.drainEvents().map((event) => event.eventType)).toEqual(['instance_stop']);
  });

  it('copies seed save folders and passes the isolated path through launch arguments', async () => {
    const sourceDir = join(tmpdir(), `gameplay-simulator-seed-${Date.now()}`);
    const rootDir = join(tmpdir(), `gameplay-simulator-saves-${Date.now()}`);
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, 'slot.json'), '{"gold":10}', 'utf8');
    const adapter = new FakeAdapter();
    const profile: GameProfile = {
      ...gameProfile,
      saveIsolation: {
        mode: 'launch-argument-profile',
        sourceSavePath: sourceDir,
        workingSaveRoot: rootDir,
        profileArgumentTemplate: '--save-dir={savePath}',
        cleanupTempSaves: false,
        preserveBotSaves: true
      }
    };
    const manager = new GameInstanceManager({
      adapter,
      runConfig,
      gameProfile: profile,
      launchPlans: launchPlans(1),
      fileSystem
    });

    await manager.startAllInstances();

    const savePath = join(rootDir, 'game-instance-001');
    expect(adapter.launchCalls[0].launch.arguments).toContain(`--save-dir=${savePath}`);
    expect(await readFile(join(savePath, 'slot.json'), 'utf8')).toBe('{"gold":10}');
    expect(manager.getInstanceStatus('game-instance-001').isolatedSaveDirectory).toBe(savePath);
    expect(manager.drainEvents().some((event) => event.eventType === 'instance_save_isolation')).toBe(true);
  });

  it('passes isolated save paths through environment variables', async () => {
    const rootDir = join(tmpdir(), `gameplay-simulator-env-saves-${Date.now()}`);
    const adapter = new FakeAdapter();
    const manager = new GameInstanceManager({
      adapter,
      runConfig,
      gameProfile: {
        ...gameProfile,
        saveIsolation: {
          mode: 'environment-variable',
          workingSaveRoot: rootDir,
          environmentVariableName: 'MY_GAME_SAVE_DIR',
          cleanupTempSaves: false,
          preserveBotSaves: true
        }
      },
      launchPlans: launchPlans(1),
      fileSystem
    });

    await manager.startAllInstances();

    expect(adapter.launchCalls[0].environment.MY_GAME_SAVE_DIR).toBe(join(rootDir, 'game-instance-001'));
    expect(existsSync(join(rootDir, 'game-instance-001'))).toBe(true);
  });

  it('cleans up temporary save folders only when configured to discard them', async () => {
    const rootDir = join(tmpdir(), `gameplay-simulator-cleanup-saves-${Date.now()}`);
    const adapter = new FakeAdapter();
    const manager = new GameInstanceManager({
      adapter,
      runConfig,
      gameProfile: {
        ...gameProfile,
        saveIsolation: {
          mode: 'temp-directory',
          workingSaveRoot: rootDir,
          cleanupTempSaves: true,
          preserveBotSaves: false
        }
      },
      launchPlans: launchPlans(1),
      fileSystem
    });

    await manager.startAllInstances();
    const savePath = join(rootDir, 'game-instance-001');
    expect(existsSync(savePath)).toBe(true);

    const stopped = await manager.stopInstance('game-instance-001');

    expect(existsSync(savePath)).toBe(false);
    expect(stopped.saveIsolationCleanedUp).toBe(true);
  });

  it('records health warnings and failed adapter health', async () => {
    const adapter = new FakeAdapter();
    const manager = new GameInstanceManager({
      adapter,
      runConfig,
      gameProfile,
      launchPlans: launchPlans(1),
      fileSystem
    });

    await manager.startAllInstances();
    manager.drainEvents();
    adapter.healthOverrides.set('game-instance-001', {
      instanceId: 'game-instance-001',
      status: 'degraded',
      checkedAt: '2026-07-02T20:02:00.000Z',
      message: 'Window stopped responding.',
      details: {
        processInfo: {
          pid: 4001,
          cpuPercent: 99,
          ramMb: 900
        }
      }
    });

    let statuses = await manager.refreshHealth();

    expect(statuses[0].status).toBe('unresponsive');
    expect(statuses[0].resourceUsage?.cpuPercent).toBe(99);
    expect(manager.drainEvents()[0]).toEqual(
      expect.objectContaining({
        eventType: 'instance_health_warning',
        instanceId: 'game-instance-001',
        status: 'unresponsive'
      })
    );

    adapter.healthOverrides.set('game-instance-001', {
      instanceId: 'game-instance-001',
      status: 'failed',
      checkedAt: '2026-07-02T20:03:00.000Z',
      message: 'Adapter health failed.',
      details: {}
    });

    statuses = await manager.refreshHealth();

    expect(statuses[0].status).toBe('failed');
    expect(manager.drainEvents()[0]).toEqual(
      expect.objectContaining({
        eventType: 'instance_crash',
        status: 'failed'
      })
    );
  });

  it('restarts crashed instances when configured', async () => {
    const adapter = new FakeAdapter();
    const manager = new GameInstanceManager({
      adapter,
      runConfig,
      gameProfile,
      launchPlans: launchPlans(1),
      restartCrashedInstances: true,
      fileSystem
    });

    await manager.startAllInstances();
    manager.drainEvents();
    adapter.running.set('game-instance-001', false);

    const statuses = await manager.refreshHealth();

    expect(statuses[0].status).toBe('running');
    expect(adapter.launchCalls).toHaveLength(2);
    expect(manager.drainEvents().map((event) => event.eventType)).toEqual([
      'instance_crash',
      'instance_restart',
      'instance_save_isolation',
      'instance_start'
    ]);
  });
});
