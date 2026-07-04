import type { ActionResult, GameAction, GameInstanceStatus, GameStateSnapshot } from '../types';
import { describe, expect, it } from 'vitest';
import {
  CrashDetector,
  EconomyExploitDetector,
  ExploitDetector,
  IssueDetectionRunner,
  SaveLoadDetector,
  SoftlockDetector,
  WorldBoundaryDetector,
  defaultIssueDetectors
} from './IssueDetectors';

function snapshot(state: Record<string, unknown>, metrics: Record<string, number> = {}): GameStateSnapshot {
  return {
    snapshotId: 'snapshot-001',
    sessionId: 'session',
    gameId: 'game',
    gameInstanceId: 'instance-001',
    botId: 'bot-001',
    capturedAt: '2026-07-04T10:00:00.000Z',
    scene: 'Test Scene',
    state,
    metrics
  };
}

function action(type: string): GameAction {
  return {
    actionId: 'action-001',
    sessionId: 'session',
    gameInstanceId: 'instance-001',
    botId: 'bot-001',
    type,
    payload: {},
    requestedAt: '2026-07-04T10:00:00.000Z'
  };
}

const failedResult: ActionResult = {
  actionId: 'action-001',
  botId: 'bot-001',
  status: 'failed',
  completedAt: '2026-07-04T10:00:01.000Z',
  durationMs: 1,
  message: 'Failed.',
  issueIds: []
};

const crashedInstance: GameInstanceStatus = {
  instanceId: 'instance-001',
  gameProfileId: 'game',
  adapterType: 'desktop',
  status: 'crashed',
  assignedBots: ['bot-001'],
  startTime: '2026-07-04T10:00:00.000Z',
  lastHeartbeat: '2026-07-04T10:00:00.000Z'
};

function context(overrides: Partial<Parameters<IssueDetectionRunner['detect']>[0]> = {}): Parameters<IssueDetectionRunner['detect']>[0] {
  return {
    sessionId: 'session',
    botId: 'bot-001',
    instanceId: 'instance-001',
    timestamp: '2026-07-04T10:00:02.000Z',
    memory: {
      lastState: snapshot({}),
      lastAction: null,
      lastResult: null,
      recentActionTypes: [],
      currentArea: 'Test Scene'
    },
    ...overrides
  };
}

describe('issue detectors', () => {
  it('returns DetectedIssue objects for crashes', () => {
    const issues = new CrashDetector().detect(
      context({
        instanceStatus: crashedInstance,
        memory: {
          lastState: snapshot({ processAlive: false }),
          lastAction: null,
          lastResult: null,
          recentActionTypes: []
        }
      })
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      id: 'session-bot-001-crash-process-crashed',
      issueId: 'session-bot-001-crash-process-crashed',
      timestamp: '2026-07-04T10:00:02.000Z',
      severity: 'critical',
      category: 'crash',
      instanceId: 'instance-001'
    });
  });

  it('detects possible negative currency exploits with confidence', () => {
    const issues = new ExploitDetector().detect(
      context({
        memory: {
          previousState: snapshot({ currency: 15 }),
          lastState: snapshot({ currency: -10 }),
          lastAction: action('buy-shop-item'),
          lastResult: failedResult,
          recentActionTypes: ['buy-shop-item']
        }
      })
    );

    expect(issues[0].category).toBe('exploit');
    expect(issues[0].title).toContain('Possible exploit');
    expect(issues[0].title).toContain('negative currency');
    expect(issues[0].confidence).toBeGreaterThan(0);
    expect(issues[0].lastActions).toContain('buy-shop-item');
  });

  it('uses state diffs to detect possible item duplication', () => {
    const issues = new ExploitDetector().detect(
      context({
        memory: {
          previousState: snapshot({ inventory: { potion: { quantity: 1 } } }),
          lastState: snapshot({ inventory: { potion: { quantity: 2 } } }),
          lastAction: action('load-checkpoint'),
          lastResult: { ...failedResult, status: 'succeeded' },
          recentActionTypes: ['load-checkpoint']
        }
      })
    );

    expect(issues.some((issue) => issue.title === 'Possible exploit: item duplication')).toBe(true);
    expect(issues[0].rawEvidence).toBeDefined();
  });

  it('detects repeated reward and quest flag loopholes as possible exploits', () => {
    const issues = new ExploitDetector().detect(
      context({
        memory: {
          previousState: snapshot({ claimedRewards: { questReward: 1 }, questFlags: { intro: true } }),
          lastState: snapshot({
            claimedRewards: { questReward: 2 },
            completedQuest: 'intro',
            missingRequiredFlags: ['talked_to_npc'],
            questFlags: { intro: true }
          }),
          lastAction: action('claim-quest-reward'),
          lastResult: { ...failedResult, status: 'succeeded' },
          recentActionTypes: ['claim-quest-reward']
        }
      })
    );

    expect(issues.some((issue) => issue.title === 'Possible exploit: reward claimed multiple times')).toBe(true);
    expect(issues.some((issue) => issue.title === 'Possible exploit: quest completed without required flags')).toBe(true);
    expect(issues.every((issue) => issue.description?.includes('possible exploit'))).toBe(true);
  });

  it('detects sequence breaks and stats exceeding expected maximum', () => {
    const issues = new ExploitDetector().detect(
      context({
        memory: {
          previousState: snapshot({ scene: 'Town', progressionFlags: { gateOpen: false } }),
          lastState: snapshot({
            scene: 'Final Castle',
            enteredFutureContent: true,
            stats: { strength: 150 },
            statMaximums: { strength: 99 }
          }),
          lastAction: action('enter-locked-area-early'),
          lastResult: { ...failedResult, status: 'succeeded' },
          recentActionTypes: ['enter-locked-area-early']
        }
      })
    );

    expect(issues.some((issue) => issue.title === 'Possible exploit: sequence break into future content')).toBe(true);
    expect(issues.some((issue) => issue.title === 'Possible exploit: stat exceeds expected maximum')).toBe(true);
  });

  it('groups repeated possible exploit detections in the runner', () => {
    const runner = new IssueDetectionRunner([new ExploitDetector()]);
    const input = context({
      memory: {
        previousState: snapshot({ currency: 5 }),
        lastState: snapshot({ currency: -1 }),
        lastAction: action('buy-shop-item'),
        lastResult: failedResult,
        recentActionTypes: ['buy-shop-item']
      }
    });

    expect(runner.detect(input)).toHaveLength(1);
    expect(runner.detect(input)).toHaveLength(0);
  });

  it('still detects legacy economy pricing anomalies', () => {
    const issues = new EconomyExploitDetector().detect(
      context({
        memory: {
          lastState: snapshot({ itemPrice: -10 }),
          lastAction: action('buy-shop-item'),
          lastResult: failedResult,
          recentActionTypes: ['buy-shop-item']
        }
      })
    );

    expect(issues[0].category).toBe('economy');
    expect(issues[0].title).toContain('price');
  });

  it('detects world boundary failures', () => {
    const issues = new WorldBoundaryDetector().detect(
      context({
        memory: {
          lastState: snapshot({ position: { x: 0, y: -250, z: 0 } }),
          lastAction: action('boundary-jump-corner'),
          lastResult: { ...failedResult, status: 'succeeded' },
          recentActionTypes: ['boundary-jump-corner']
        }
      })
    );

    expect(issues[0].severity).toBe('critical');
    expect(issues[0].category).toBe('world_boundary');
  });

  it('detects save/load failures', () => {
    const issues = new SaveLoadDetector().detect(
      context({
        memory: {
          lastState: snapshot({}),
          lastAction: action('load-checkpoint'),
          lastResult: failedResult,
          recentActionTypes: ['load-checkpoint']
        }
      })
    );

    expect(issues[0].severity).toBe('critical');
    expect(issues[0].category).toBe('save_load');
  });

  it('detects softlocks from failed recovery', () => {
    const issues = new SoftlockDetector().detect(
      context({
        memory: {
          lastState: snapshot({ currentScreen: 'menu' }),
          lastAction: action('cancel-back'),
          lastResult: failedResult,
          recentActionTypes: ['cancel-back'],
          progressState: 'Recovery failed after 2 attempt(s): No available actions.',
          stuckReason: 'No available actions have been reported repeatedly.'
        }
      })
    );

    expect(issues[0].category).toBe('softlock');
    expect(issues[0].severity).toBe('critical');
  });

  it('reduces duplicate issue spam across detector runs', () => {
    const runner = new IssueDetectionRunner(defaultIssueDetectors);
    const input = context({
      memory: {
        lastState: snapshot({ processAlive: false }),
        lastAction: null,
        lastResult: null,
        recentActionTypes: []
      },
      instanceStatus: crashedInstance
    });

    expect(runner.detect(input).length).toBeGreaterThan(0);
    expect(runner.detect(input)).toHaveLength(0);
  });
});
