import type {
  ActionResult,
  BotLaunchPlan,
  BotProfile,
  GameAction,
  GameStateSnapshot,
  RuntimeBotSnapshot,
  SimulationRunConfig
} from '../types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AvailableGameActionLike } from './ActionPlanner';
import type { BotAdapter } from './Bot';
import { BotManager } from './BotManager';

const explorerProfile: BotProfile = {
  profileId: 'explorer',
  displayName: 'Explorer Bot',
  botType: 'explorer',
  playstyle: 'map-coverage',
  description: 'Explores spaces.',
  aggression: 0.2,
  curiosity: 0.9,
  riskTolerance: 0.5,
  repetitionTolerance: 0.6,
  bugHuntingBias: 0.7,
  preferredActions: ['move', 'inspect'],
  avoidedActions: ['idle'],
  goals: [],
  recommendedMinCount: 1,
  recommendedMaxCount: 20,
  defaultResourceWeight: 'medium',
  tags: [],
  config: {}
};

const combatProfile: BotProfile = {
  profileId: 'combat',
  displayName: 'Combat Bot',
  botType: 'combat',
  playstyle: 'combat-systems',
  description: 'Exercises combat.',
  aggression: 0.8,
  curiosity: 0.5,
  riskTolerance: 0.7,
  repetitionTolerance: 0.5,
  bugHuntingBias: 0.7,
  preferredActions: ['attack'],
  avoidedActions: ['avoid-combat'],
  goals: [],
  recommendedMinCount: 1,
  recommendedMaxCount: 10,
  defaultResourceWeight: 'medium',
  tags: [],
  config: {}
};

const profiles = [explorerProfile, combatProfile];

class ManagerTestAdapter implements BotAdapter {
  readonly actions: Array<{ botId: string; actionType: string }> = [];
  private readonly stateCounts = new Map<string, number>();

  async getState(instanceId: string, botId: string): Promise<GameStateSnapshot> {
    const count = (this.stateCounts.get(botId) ?? 0) + 1;
    this.stateCounts.set(botId, count);

    return {
      snapshotId: `${botId}-snapshot-${count}`,
      sessionId: 'session-manager',
      gameId: 'game',
      gameInstanceId: instanceId,
      botId,
      capturedAt: '2026-07-04T10:00:00.000Z',
      tick: count,
      scene: `scene-${count}`,
      state: {},
      metrics: {}
    };
  }

  async getAvailableActions(): Promise<AvailableGameActionLike[]> {
    return [
      { actionType: 'move-forward', label: 'Move Forward' },
      { actionType: 'inspect-hidden-area', label: 'Inspect Hidden Area' },
      { actionType: 'attack-enemy', label: 'Attack Enemy' },
      { actionType: 'idle-wait', label: 'Idle Wait' }
    ];
  }

  async performAction(_instanceId: string, botId: string, action: GameAction): Promise<ActionResult> {
    this.actions.push({ botId, actionType: action.type });

    return {
      actionId: action.actionId,
      botId,
      status: 'succeeded',
      startedAt: action.requestedAt,
      completedAt: '2026-07-04T10:00:00.000Z',
      durationMs: 1,
      message: 'ok',
      issueIds: []
    };
  }
}

function runConfig(runMode: SimulationRunConfig['runMode'], overrides: Partial<SimulationRunConfig> = {}): SimulationRunConfig {
  return {
    sessionId: 'session-manager',
    gameProfilePath: 'memory://game',
    adapterType: 'instrumented',
    runMode,
    runUntilStopped: false,
    maxRuntimeMinutes: 5,
    stopOnCriticalIssue: false,
    saveScreenshots: false,
    saveVideo: false,
    saveActionTimeline: true,
    saveStateSnapshots: true,
    botPools: [],
    globalBotLimit: 10,
    perGameInstanceBotLimit: 2,
    actionDelayMs: 0,
    maxActionsPerBot: 1,
    resourceLimits: {
      maxCpuPercent: 80,
      maxRamPercent: 80,
      maxGpuPercent: 80,
      reserveRamMb: 512,
      maxGameInstances: 2,
      allowAutoScaling: true
    },
    ...overrides
  };
}

function plan(botId: string, profileId: string, launchIndex: number, instanceId = 'game-instance-001'): BotLaunchPlan {
  return {
    botId,
    profileId,
    displayName: botId,
    playstyle: profileId,
    assignedGameInstanceId: instanceId,
    seed: launchIndex,
    resourceWeight: 'medium',
    launchIndex
  };
}

function runningTracker() {
  const active = new Set<string>();
  let maxActive = 0;
  const history: RuntimeBotSnapshot[] = [];

  return {
    history,
    get maxActive() {
      return maxActive;
    },
    update(status: RuntimeBotSnapshot) {
      history.push(status);

      if (['starting', 'running', 'waiting'].includes(status.status)) {
        active.add(status.botId);
      } else {
        active.delete(status.botId);
      }

      maxActive = Math.max(maxActive, active.size);
    }
  };
}

describe('BotManager', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs multiple bot types and multiple bots of the same type in parallel', async () => {
    const adapter = new ManagerTestAdapter();
    const manager = new BotManager({
      sessionId: 'session-manager',
      runConfig: runConfig('parallel'),
      launchPlans: [
        plan('explorer-001', 'explorer', 1, 'game-instance-001'),
        plan('explorer-002', 'explorer', 2, 'game-instance-001'),
        plan('combat-001', 'combat', 3, 'game-instance-002')
      ],
      botProfiles: profiles,
      adapter,
      now: () => '2026-07-04T10:00:00.000Z',
      sleep: async () => {}
    });

    manager.startAll();
    await manager.whenIdle();

    expect(manager.getStatusSnapshots().map((status) => status.status)).toEqual(['completed', 'completed', 'completed']);
    expect(adapter.actions.map((action) => action.botId).sort()).toEqual([
      'combat-001',
      'explorer-001',
      'explorer-002'
    ]);
    expect(manager.getBotLogs('explorer-001').every((log) => log.source === 'bot:explorer-001')).toBe(true);
    expect(manager.getBotLogs('explorer-002').every((log) => log.source === 'bot:explorer-002')).toBe(true);
  });

  it('runs bots one after another in sequential mode', async () => {
    const adapter = new ManagerTestAdapter();
    const tracker = runningTracker();
    const manager = new BotManager({
      sessionId: 'session-manager',
      runConfig: runConfig('sequential'),
      launchPlans: [
        plan('explorer-001', 'explorer', 1),
        plan('explorer-002', 'explorer', 2),
        plan('combat-001', 'combat', 3)
      ],
      botProfiles: profiles,
      adapter,
      now: () => '2026-07-04T10:00:00.000Z',
      sleep: async () => {},
      onStatusChange: ({ status }) => tracker.update(status)
    });

    manager.startAll();
    await manager.whenIdle();

    expect(tracker.maxActive).toBe(1);
    expect(adapter.actions.map((action) => action.botId)).toEqual([
      'explorer-001',
      'explorer-002',
      'combat-001'
    ]);
  });

  it('limits active bots in hybrid mode', async () => {
    const adapter = new ManagerTestAdapter();
    const tracker = runningTracker();
    const manager = new BotManager({
      sessionId: 'session-manager',
      runConfig: runConfig('hybrid'),
      launchPlans: [
        plan('explorer-001', 'explorer', 1, 'game-instance-001'),
        plan('explorer-002', 'explorer', 2, 'game-instance-001'),
        plan('combat-001', 'combat', 3, 'game-instance-002'),
        plan('combat-002', 'combat', 4, 'game-instance-002')
      ],
      botProfiles: profiles,
      adapter,
      maxConcurrentBots: 2,
      now: () => '2026-07-04T10:00:00.000Z',
      sleep: async () => {},
      onStatusChange: ({ status }) => tracker.update(status)
    });

    manager.startAll();
    await manager.whenIdle();

    expect(manager.concurrency).toBe(2);
    expect(tracker.maxActive).toBeLessThanOrEqual(2);
    expect(adapter.actions).toHaveLength(4);
  });

  it('can stop one bot without stopping the rest', async () => {
    vi.useFakeTimers();

    const adapter = new ManagerTestAdapter();
    const manager = new BotManager({
      sessionId: 'session-manager',
      runConfig: runConfig('parallel', {
        actionDelayMs: 1000,
        maxActionsPerBot: undefined
      }),
      launchPlans: [
        plan('explorer-001', 'explorer', 1),
        plan('explorer-002', 'explorer', 2)
      ],
      botProfiles: profiles,
      adapter,
      now: () => '2026-07-04T10:00:00.000Z'
    });

    manager.startAll();
    await vi.advanceTimersByTimeAsync(0);

    expect(manager.stopBot('explorer-001')).toBe(true);

    const statuses = manager.getStatusSnapshots();
    expect(statuses.find((status) => status.botId === 'explorer-001')?.status).toBe('stopped');
    expect(statuses.find((status) => status.botId === 'explorer-002')?.status).not.toBe('stopped');

    manager.stopAll();
    await vi.advanceTimersByTimeAsync(1000);
    await manager.whenIdle();
  });
});
