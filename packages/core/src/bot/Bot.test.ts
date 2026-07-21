import type { ActionResult, BotProfile, GameAction, GameStateSnapshot, RuntimeBotSnapshot } from '../types';
import type { LogEntry } from '../logging/LogEntry';
import { describe, expect, it } from 'vitest';
import { Bot, type BotAdapter } from './Bot';
import type { AvailableGameActionLike } from './ActionPlanner';

const profile: BotProfile = {
  profileId: 'explorer-bot',
  displayName: 'Explorer Bot',
  botType: 'explorer',
  playstyle: 'map-coverage',
  description: 'Explores the game.',
  aggression: 0.2,
  curiosity: 0.9,
  riskTolerance: 0.4,
  repetitionTolerance: 0.5,
  bugHuntingBias: 0.8,
  preferredActions: ['move'],
  avoidedActions: ['idle'],
  goals: [
    {
      goalId: 'coverage',
      name: 'Coverage',
      priority: 1,
      successCriteria: ['move'],
      targetIssueCategories: ['navigation']
    }
  ],
  recommendedMinCount: 1,
  recommendedMaxCount: 3,
  defaultResourceWeight: 'medium',
  tags: [],
  config: {}
};

class FakeAdapter implements BotAdapter {
  readonly actions: GameAction[] = [];
  stateReads = 0;

  async getState(instanceId: string, botId: string): Promise<GameStateSnapshot> {
    this.stateReads += 1;

    return {
      snapshotId: `snapshot-${this.stateReads}`,
      sessionId: 'session',
      gameId: 'game',
      gameInstanceId: instanceId,
      botId,
      capturedAt: '2026-07-04T10:00:00.000Z',
      tick: this.stateReads,
      scene: `scene-${this.stateReads}`,
      state: {},
      metrics: {}
    };
  }

  async getAvailableActions(): Promise<AvailableGameActionLike[]> {
    return [
      { actionType: 'idle', label: 'Idle' },
      { actionType: 'move-forward', label: 'Move Forward' }
    ];
  }

  async performAction(_instanceId: string, botId: string, action: GameAction): Promise<ActionResult> {
    this.actions.push(action);

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

class NoActionsAdapter implements BotAdapter {
  readonly recoveryActions: GameAction[] = [];
  stateReads = 0;

  async getState(instanceId: string, botId: string): Promise<GameStateSnapshot> {
    this.stateReads += 1;

    return {
      snapshotId: `no-actions-snapshot-${this.stateReads}`,
      sessionId: 'session',
      gameId: 'game',
      gameInstanceId: instanceId,
      botId,
      capturedAt: '2026-07-04T10:00:00.000Z',
      tick: this.stateReads,
      scene: 'menu',
      state: {
        currentScreen: 'menu'
      },
      metrics: {}
    };
  }

  async getAvailableActions(): Promise<AvailableGameActionLike[]> {
    return [];
  }

  async performAction(_instanceId: string, botId: string, action: GameAction): Promise<ActionResult> {
    this.recoveryActions.push(action);

    return {
      actionId: action.actionId,
      botId,
      status: 'failed',
      startedAt: action.requestedAt,
      completedAt: '2026-07-04T10:00:00.000Z',
      durationMs: 1,
      message: 'Recovery did not help.',
      issueIds: []
    };
  }
}

class RecoveringAdapter implements BotAdapter {
  readonly actions: GameAction[] = [];
  stateReads = 0;
  recovered = false;

  async getState(instanceId: string, botId: string): Promise<GameStateSnapshot> {
    this.stateReads += 1;

    return {
      snapshotId: `recovering-snapshot-${this.stateReads}`,
      sessionId: 'session',
      gameId: 'game',
      gameInstanceId: instanceId,
      botId,
      capturedAt: `2026-07-04T10:00:${String(this.stateReads).padStart(2, '0')}.000Z`,
      tick: this.stateReads,
      scene: this.recovered ? 'field' : 'menu',
      state: {
        currentScreen: this.recovered ? 'gameplay' : 'menu',
        position: this.recovered ? { x: this.stateReads, y: 0 } : { x: 0, y: 0 }
      },
      metrics: {}
    };
  }

  async getAvailableActions(): Promise<AvailableGameActionLike[]> {
    return this.recovered ? [{ actionType: 'move-forward', label: 'Move Forward' }] : [];
  }

  async performAction(_instanceId: string, botId: string, action: GameAction): Promise<ActionResult> {
    this.actions.push(action);

    if (action.payload.recovery === true) {
      this.recovered = true;
    }

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

describe('Bot', () => {
  it('reads state, plans actions, performs them, logs, and completes cleanly', async () => {
    const adapter = new FakeAdapter();
    const logs: LogEntry[] = [];
    const statuses: RuntimeBotSnapshot[] = [];
    const bot = new Bot({
      botId: 'explorer-bot-001',
      sessionId: 'session',
      profile,
      assignedInstanceId: 'game-instance-001',
      adapter,
      logger: {
        log: (entry) => {
          logs.push(entry);
        }
      },
      actionDelayMs: 0,
      maxActionsPerBot: 2,
      now: () => '2026-07-04T10:00:00.000Z',
      sleep: async () => {},
      onStatusChange: (status) => {
        statuses.push(status);
      }
    });

    await bot.start();

    expect(adapter.stateReads).toBe(2);
    expect(adapter.actions.map((action) => action.type)).toEqual(['move-forward', 'move-forward']);
    expect(bot.memory.actionCount).toBe(2);
    expect(bot.memory.currentArea).toBe('scene-2');
    expect(bot.status).toBe('completed');
    expect(statuses.at(-1)?.status).toBe('completed');
    expect(statuses.at(-1)?.currentGoal).toBe('Coverage');
    expect(statuses.at(-1)?.currentAction).toBe('move-forward');
    expect(statuses.at(-1)?.actionReason).toContain('Explorer Bot chose move-forward');
    expect(statuses.at(-1)?.actionQuality).toBe('repeated');
    expect(statuses.at(-1)?.lastResult).toBe('succeeded: ok');
    expect(logs.some((log) => log.message.includes('State read'))).toBe(true);
    expect(logs.some((log) => log.message.includes('Explorer Bot chose move-forward'))).toBe(true);
    expect(logs.some((log) => log.message.includes('Action move-forward succeeded'))).toBe(true);
  });

  it('blocks and logs a stuck reason when no actions are repeatedly available', async () => {
    const adapter = new NoActionsAdapter();
    const logs: LogEntry[] = [];
    const statuses: RuntimeBotSnapshot[] = [];
    const bot = new Bot({
      botId: 'explorer-bot-001',
      sessionId: 'session',
      profile,
      assignedInstanceId: 'game-instance-001',
      adapter,
      logger: {
        log: (entry) => {
          logs.push(entry);
        }
      },
      actionDelayMs: 0,
      maxRecoveryAttempts: 2,
      now: () => '2026-07-04T10:00:00.000Z',
      sleep: async () => {},
      onStatusChange: (status) => {
        statuses.push(status);
      }
    });

    await bot.start();

    expect(adapter.stateReads).toBe(3);
    expect(adapter.recoveryActions).toHaveLength(2);
    expect(bot.status).toBe('blocked');
    expect(bot.memory.progressState).toContain('Recovery failed');
    expect(bot.memory.stuckReason).toContain('No available actions');
    expect(statuses.at(-1)?.status).toBe('blocked');
    expect(logs.some((log) => log.message.includes('Recovery attempt'))).toBe(true);
    expect(logs.some((log) => log.message.includes('Recovery failed'))).toBe(true);
  });

  it('recovers from a stuck state before giving up', async () => {
    const adapter = new RecoveringAdapter();
    const logs: LogEntry[] = [];
    const statuses: RuntimeBotSnapshot[] = [];
    const bot = new Bot({
      botId: 'explorer-bot-001',
      sessionId: 'session',
      profile,
      assignedInstanceId: 'game-instance-001',
      adapter,
      logger: {
        log: (entry) => {
          logs.push(entry);
        }
      },
      actionDelayMs: 0,
      maxActionsPerBot: 1,
      now: () => '2026-07-04T10:00:00.000Z',
      sleep: async () => {},
      onStatusChange: (status) => {
        statuses.push(status);
      }
    });

    await bot.start();

    expect(adapter.actions.some((action) => action.payload.recovery === true)).toBe(true);
    expect(adapter.recovered).toBe(true);
    expect(bot.memory.recoveredFromStuckReason).toContain('No available actions');
    expect(bot.status).toBe('completed');
    expect(statuses.some((status) => status.message?.includes('Recovery attempt'))).toBe(true);
    expect(logs.some((log) => log.message.includes('Recovered from stuck state'))).toBe(true);
  });
});
