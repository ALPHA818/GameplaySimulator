import type {
  ActionResult,
  BotProfile,
  GameAction,
  GameInstanceStatus,
  GameProfile,
  GameStateSnapshot,
  SimulationRunConfig
} from '../types';
import { describe, expect, it } from 'vitest';
import { resolveBotPools } from '../bot/BotPoolResolver';
import { ProgressTracker } from '../bot/ProgressTracker';
import { RecoveryManager } from '../bot/RecoveryManager';
import { IssueDetectionRunner, defaultIssueDetectors } from '../detection/IssueDetectors';
import { ResourceManager, type SystemResourceSnapshot } from '../resources/ResourceManager';
import { planGameInstances } from '../sessions/GameInstanceManager';

const browserGameProfile: GameProfile = {
  gameId: 'sample-browser-game',
  gameName: 'Sample Browser Game',
  version: '1.0.0',
  buildId: 'hardening-build',
  engine: { type: 'browser' },
  launch: {
    platform: 'browser',
    url: 'https://example.local/game',
    arguments: []
  },
  adapter: {
    type: 'browser',
    supportsMultipleInstances: true,
    supportsStateRead: false,
    supportsDirectActions: false,
    supportsScreenshots: true,
    supportsVideo: false,
    supportsSaveIsolation: true
  },
  controls: [],
  testingTargets: [],
  progressSignals: [],
  failureSignals: [],
  knownContent: {
    scenes: ['Start Area'],
    levels: ['Level 1'],
    locations: [],
    characters: [],
    npcs: [],
    items: ['Potion'],
    quests: [],
    mainQuests: [],
    sideQuests: [],
    optionalStories: [],
    shops: ['General shop'],
    bosses: [],
    menus: ['Inventory'],
    dialogueBranches: [],
    minigames: [],
    endings: [],
    hiddenAreas: ['Boundary ledge'],
    postGameContent: [],
    collectibles: [],
    achievements: [],
    mechanics: [],
    notes: []
  }
};

const explorerProfile: BotProfile = {
  profileId: 'explorer-bot',
  displayName: 'Explorer Bot',
  botType: 'explorer',
  playstyle: 'coverage',
  goals: [],
  recommendedMinCount: 1,
  recommendedMaxCount: 20,
  defaultResourceWeight: 'medium',
  preferredActions: ['move', 'inspect'],
  avoidedActions: ['idle'],
  tags: [],
  config: {}
};

const chaosProfile: BotProfile = {
  profileId: 'chaos-monkey-bot',
  displayName: 'Chaos Monkey Bot',
  botType: 'chaos',
  playstyle: 'randomized-stress',
  goals: [],
  recommendedMinCount: 0,
  recommendedMaxCount: 5,
  defaultResourceWeight: 'very_heavy',
  preferredActions: ['random', 'menu'],
  avoidedActions: [],
  tags: [],
  config: {}
};

const systemSnapshot: SystemResourceSnapshot = {
  cpuCoreCount: 8,
  totalRamMb: 24000,
  freeRamMb: 18000,
  currentCpuLoadPercent: 10,
  currentRamUsagePercent: 25,
  platform: 'linux',
  osRelease: 'test'
};

const runConfig: SimulationRunConfig = {
  sessionId: 'hardening-browser-session',
  gameProfilePath: 'memory://game-profiles/sample-browser-game',
  adapterType: 'browser',
  runMode: 'parallel',
  runUntilStopped: false,
  maxRuntimeMinutes: 30,
  stopOnCriticalIssue: true,
  saveScreenshots: true,
  saveVideo: false,
  saveActionTimeline: true,
  saveStateSnapshots: true,
  botPools: [
    {
      profileId: 'explorer-bot',
      enabled: true,
      minCount: 1,
      desiredCount: 6,
      maxCount: 20,
      scalingMode: 'auto',
      priority: 10,
      resourceWeight: 'medium'
    },
    {
      profileId: 'chaos-monkey-bot',
      enabled: true,
      minCount: 0,
      desiredCount: 2,
      maxCount: 5,
      scalingMode: 'auto',
      priority: 2,
      resourceWeight: 'very_heavy'
    }
  ],
  globalBotLimit: 8,
  perGameInstanceBotLimit: 2,
  actionDelayMs: 100,
  maxActionsPerBot: 50,
  resourceLimits: {
    maxCpuPercent: 80,
    maxRamPercent: 75,
    maxGpuPercent: 80,
    reserveRamMb: 1024,
    maxGameInstances: 4,
    allowAutoScaling: true
  }
};

function snapshot(id: string, state: Record<string, unknown>): GameStateSnapshot {
  return {
    snapshotId: id,
    sessionId: runConfig.sessionId,
    gameId: browserGameProfile.gameId,
    gameInstanceId: 'instance-001',
    botId: 'explorer-bot-001',
    capturedAt: '2026-07-05T09:00:00.000Z',
    scene: 'Start Area',
    state,
    metrics: {}
  };
}

function action(type: string): GameAction {
  return {
    actionId: `${type}-001`,
    sessionId: runConfig.sessionId,
    gameInstanceId: 'instance-001',
    botId: 'explorer-bot-001',
    type,
    payload: {},
    requestedAt: '2026-07-05T09:00:01.000Z'
  };
}

const succeededResult: ActionResult = {
  actionId: 'load-checkpoint-001',
  botId: 'explorer-bot-001',
  status: 'succeeded',
  completedAt: '2026-07-05T09:00:02.000Z',
  durationMs: 1,
  issueIds: []
};

const crashedInstance: GameInstanceStatus = {
  instanceId: 'instance-001',
  gameProfileId: browserGameProfile.gameId,
  adapterType: 'desktop',
  status: 'crashed',
  assignedBots: ['explorer-bot-001'],
  startTime: '2026-07-05T09:00:00.000Z',
  lastHeartbeat: '2026-07-05T09:00:01.000Z'
};

describe('full simulator hardening integration', () => {
  it('estimates resources, resolves multi-bot pools, and plans browser game instances', () => {
    const viabilityReport = new ResourceManager().estimateViabilitySync({
      runConfig,
      gameProfile: browserGameProfile,
      systemSnapshot
    });
    const launchPlans = resolveBotPools({
      runConfig,
      botProfiles: [explorerProfile, chaosProfile],
      viabilityReport
    });
    const instancePlan = planGameInstances({
      runConfig,
      gameProfile: browserGameProfile,
      launchPlans,
      adapterCapabilities: {
        supportsMultipleInstances: true,
        supportsSaveIsolation: true
      }
    });

    expect(viabilityReport.canRun).toBe(true);
    expect(launchPlans.length).toBeGreaterThan(1);
    expect(new Set(launchPlans.map((plan) => plan.botId)).size).toBe(launchPlans.length);
    expect(instancePlan.instances.length).toBeGreaterThan(0);
    expect(instancePlan.instances.every((instance) => instance.status.assignedBots.length <= runConfig.perGameInstanceBotLimit)).toBe(true);
  });

  it('detects a simulated stuck state and prepares recovery actions', () => {
    const tracker = new ProgressTracker({ noAvailableActionsLimit: 2 });
    const recoveryManager = new RecoveryManager({
      sessionId: runConfig.sessionId,
      gameInstanceId: 'instance-001',
      botId: 'explorer-bot-001',
      now: () => '2026-07-05T09:00:00.000Z'
    });

    tracker.recordState(snapshot('stuck-001', { currentScreen: 'menu', position: { x: 0, y: 0 } }));
    tracker.recordAvailableActions(0, '2026-07-05T09:00:01.000Z');
    tracker.recordAvailableActions(0, '2026-07-05T09:00:02.000Z');

    const attempt = recoveryManager.createNextAttempt({
      stuckReason: tracker.getStuckReason() ?? 'No available actions.',
      availableActions: []
    });

    expect(tracker.isPossiblyStuck()).toBe(true);
    expect(tracker.getStuckReason()).toContain('No available actions');
    expect(attempt?.recoveryType).toBe('wait');
    expect(attempt?.actions[0].payload.recovery).toBe(true);
  });

  it('detects simulated crash and duplicate item exploit evidence', () => {
    const runner = new IssueDetectionRunner(defaultIssueDetectors);
    const issues = runner.detect({
      sessionId: runConfig.sessionId,
      botId: 'explorer-bot-001',
      instanceId: 'instance-001',
      timestamp: '2026-07-05T09:00:03.000Z',
      instanceStatus: crashedInstance,
      memory: {
        previousState: snapshot('previous', { inventory: { potion: { quantity: 1 } } }),
        lastState: snapshot('current', {
          processAlive: false,
          inventory: { potion: { quantity: 3 } }
        }),
        lastAction: action('load-checkpoint'),
        lastResult: succeededResult,
        recentActionTypes: ['load-checkpoint'],
        currentArea: 'Start Area'
      }
    });

    expect(issues.some((issue) => issue.category === 'crash' && issue.severity === 'critical')).toBe(true);
    expect(issues.some((issue) => issue.category === 'exploit' && issue.title.includes('item duplication'))).toBe(true);
    expect(issues.every((issue) => issue.sessionId === runConfig.sessionId)).toBe(true);
  });
});
