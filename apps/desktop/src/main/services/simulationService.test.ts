import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type {
  ActionResult,
  BotProfile,
  GameAction,
  GameInstanceConfig,
  GameProfile,
  GameStateSnapshot,
  SimulationRunConfig
} from '@core/types';
import type { SystemResourceSnapshot } from '@core/resources/ResourceManager';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AdapterCapabilities,
  AdapterHealth,
  AvailableGameAction,
  GameAdapter,
  GameAdapterInstance
} from '../../../../../packages/adapters/src';
import { SimulationService } from './simulationService';

const gameProfile: GameProfile = {
  gameId: 'sample-browser-game',
  gameName: 'Sample Browser Game',
  version: '1.0.0',
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
  uiFlows: [],
  knownContent: {
    scenes: ['Start Area', 'Traversal Loop'],
    levels: ['Level 1'],
    locations: [],
    characters: [],
    npcs: ['Guide NPC'],
    items: [],
    quests: [],
    mainQuests: ['Main objective'],
    sideQuests: ['Side quest'],
    optionalStories: ['Ambient optional story'],
    shops: ['General shop'],
    bosses: ['Enemy encounter'],
    menus: ['Settings menu'],
    dialogueBranches: ['Dialogue branch'],
    minigames: ['Minigame'],
    endings: ['Demo ending'],
    hiddenAreas: ['Hidden area'],
    postGameContent: ['Post-game checkpoint'],
    collectibles: ['Collectible'],
    achievements: ['First run'],
    mechanics: [],
    notes: []
  }
};

const botProfiles: BotProfile[] = [
  {
    profileId: 'explorer',
    displayName: 'Explorer Bot',
    botType: 'explorer',
    goals: [],
    recommendedMinCount: 1,
    recommendedMaxCount: 5,
    defaultResourceWeight: 'medium',
    tags: [],
    config: {}
  }
];

const boundaryBotProfiles: BotProfile[] = [
  {
    profileId: 'boundary-breaker-bot',
    displayName: 'Boundary Breaker Bot',
    botType: 'boundary',
    playstyle: 'collision-boundary-testing',
    goals: [],
    recommendedMinCount: 1,
    recommendedMaxCount: 2,
    defaultResourceWeight: 'medium',
    preferredActions: ['boundary', 'jump', 'corner'],
    avoidedActions: [],
    tags: [],
    config: {}
  }
];

const runConfig: SimulationRunConfig = {
  sessionId: 'session-test',
  gameProfilePath: 'memory://game-profiles/sample-browser-game',
  adapterType: 'browser',
  runMode: 'parallel',
  runUntilStopped: false,
  maxRuntimeMinutes: 5,
  stopOnCriticalIssue: true,
  saveScreenshots: true,
  saveVideo: false,
  saveActionTimeline: true,
  saveStateSnapshots: true,
  useMockRuntime: true,
  botPools: [
    {
      profileId: 'explorer',
      enabled: true,
      minCount: 2,
      desiredCount: 2,
      maxCount: 5,
      scalingMode: 'fixed',
      priority: 10,
      resourceWeight: 'medium'
    }
  ],
  globalBotLimit: 4,
  perGameInstanceBotLimit: 2,
  actionDelayMs: 250,
  maxActionsPerBot: 20,
  resourceLimits: {
    maxCpuPercent: 80,
    maxRamPercent: 80,
    maxGpuPercent: 80,
    reserveRamMb: 512,
    maxGameInstances: 2,
    allowAutoScaling: true
  }
};

const boundaryRunConfig: SimulationRunConfig = {
  ...runConfig,
  sessionId: 'session-critical-boundary',
  actionDelayMs: 0,
  maxActionsPerBot: 10,
  botPools: [
    {
      profileId: 'boundary-breaker-bot',
      enabled: true,
      minCount: 1,
      desiredCount: 1,
      maxCount: 1,
      scalingMode: 'fixed',
      priority: 10,
      resourceWeight: 'medium'
    }
  ]
};

const systemSnapshot: SystemResourceSnapshot = {
  cpuCoreCount: 8,
  totalRamMb: 32000,
  freeRamMb: 24000,
  currentCpuLoadPercent: 5,
  currentRamUsagePercent: 25,
  platform: 'linux',
  osRelease: 'test'
};

function parseJsonl(contents: string): Array<Record<string, unknown>> {
  return contents
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const adapterCapabilities: AdapterCapabilities = {
  supportsMultipleInstances: true,
  supportsMultipleBotsPerInstance: true,
  supportsStateRead: true,
  supportsDirectActions: true,
  supportsInputSimulation: true,
  supportsScreenshots: true,
  supportsVideo: false,
  supportsGameLogs: true,
  supportsSaveIsolation: true,
  supportsReset: false,
  supportsCheckpointReload: false
};

class RecordingGameAdapter implements GameAdapter {
  readonly id = 'recording-browser';
  readonly name = 'Recording Browser Adapter';
  readonly adapterType = 'browser';
  readonly capabilities = adapterCapabilities;
  readonly launchConfigs: GameInstanceConfig[] = [];
  readonly stoppedInstances: string[] = [];
  stoppedAll = false;
  private readonly runningInstances = new Set<string>();

  async launchInstance(config: GameInstanceConfig): Promise<GameAdapterInstance> {
    this.launchConfigs.push(config);
    this.runningInstances.add(config.instanceId);

    return {
      instanceId: config.instanceId,
      adapterId: this.id,
      gameProfileId: config.gameProfileId,
      launchConfig: config,
      startedAt: '2026-07-04T09:00:00.000Z',
      metadata: {
        targetUrl: config.launch.url
      }
    };
  }

  async stopInstance(instanceId: string): Promise<void> {
    this.stoppedInstances.push(instanceId);
    this.runningInstances.delete(instanceId);
  }

  async stopAll(): Promise<void> {
    this.stoppedAll = true;

    for (const instanceId of [...this.runningInstances]) {
      await this.stopInstance(instanceId);
    }
  }

  async getState(instanceId: string, botId: string): Promise<GameStateSnapshot | null> {
    if (!(await this.isRunning(instanceId))) {
      return null;
    }

    return {
      snapshotId: `${instanceId}-${botId}-recording-state`,
      sessionId: 'adapter-backed-session',
      gameId: gameProfile.gameId,
      gameInstanceId: instanceId,
      botId,
      capturedAt: '2026-07-04T09:00:00.000Z',
      scene: 'Recording Adapter Scene',
      state: {
        area: 'Recording Adapter Scene'
      },
      metrics: {}
    };
  }

  async getAvailableActions(): Promise<AvailableGameAction[]> {
    return [
      {
        actionType: 'wait',
        label: 'Wait',
        requiresDirectAction: true
      }
    ];
  }

  async performAction(_instanceId: string, botId: string, action: GameAction): Promise<ActionResult> {
    return {
      actionId: action.actionId,
      botId,
      status: 'succeeded',
      startedAt: action.requestedAt,
      completedAt: '2026-07-04T09:00:00.000Z',
      durationMs: 1,
      message: 'Recording adapter action succeeded.',
      issueIds: []
    };
  }

  async isRunning(instanceId: string): Promise<boolean> {
    return this.runningInstances.has(instanceId);
  }

  async getHealth(instanceId: string): Promise<AdapterHealth> {
    const running = await this.isRunning(instanceId);

    return {
      instanceId,
      status: running ? 'running' : 'stopped',
      checkedAt: '2026-07-04T09:00:00.000Z',
      message: running ? 'Recording instance is running.' : 'Recording instance is stopped.',
      details: {
        adapterId: this.id
      }
    };
  }
}

class FailingLaunchAdapter extends RecordingGameAdapter {
  override async launchInstance(_config: GameInstanceConfig): Promise<GameAdapterInstance> {
    throw new Error('configured game could not launch');
  }
}

class StartupFlowGameAdapter extends RecordingGameAdapter {
  readonly actionOrder: Array<{ botId: string; actionType: string }> = [];
  readonly screenshotRequests: Array<{ instanceId: string; botId: string }> = [];
  private inGameplay = false;

  constructor(
    private readonly startupGate?: Promise<void>,
    private readonly failStartupAction = false
  ) {
    super();
  }

  override async getState(instanceId: string, botId: string): Promise<GameStateSnapshot | null> {
    if (!(await this.isRunning(instanceId))) {
      return null;
    }

    const currentScreen = this.inGameplay ? 'Gameplay' : 'Main Menu';

    return {
      snapshotId: `${instanceId}-${botId}-${currentScreen.toLowerCase().replace(/\s+/g, '-')}`,
      sessionId: 'session-startup-flow',
      gameId: gameProfile.gameId,
      gameInstanceId: instanceId,
      botId,
      capturedAt: '2026-07-04T09:00:00.000Z',
      scene: currentScreen,
      uiState: {
        currentScreen,
        openMenus: this.inGameplay ? [] : ['main-menu'],
        visibleButtons: this.inGameplay ? [] : [{ label: 'Start World', disabled: false }],
        modalStack: [],
        canStartGame: !this.inGameplay,
        isInGameplay: this.inGameplay,
        isPaused: false,
        isLoading: false,
        source: 'hook'
      },
      state: { currentScreen },
      metrics: {}
    };
  }

  override async getAvailableActions(_instanceId?: string, botId?: string): Promise<AvailableGameAction[]> {
    return botId === 'startup-flow-001'
      ? [{ actionType: 'start-world', label: 'Start World', requiresDirectAction: true }]
      : [{ actionType: 'move-forward', label: 'Move Forward', requiresDirectAction: true }];
  }

  override async performAction(
    _instanceId: string,
    botId: string,
    action: GameAction
  ): Promise<ActionResult> {
    this.actionOrder.push({ botId, actionType: action.type });

    if (botId === 'startup-flow-001') {
      await this.startupGate;

      if (this.failStartupAction) {
        throw new Error('Start World button did not open the game.');
      }

      this.inGameplay = true;
    }

    return {
      actionId: action.actionId,
      botId,
      status: 'succeeded',
      startedAt: action.requestedAt,
      completedAt: '2026-07-04T09:00:00.000Z',
      durationMs: 1,
      message: `${action.type} succeeded.`,
      issueIds: []
    };
  }

  async captureScreenshot(instanceId: string, botId: string) {
    this.screenshotRequests.push({ instanceId, botId });

    return {
      instanceId,
      botId,
      capturedAt: '2026-07-04T09:00:00.000Z',
      mimeType: 'image/png',
      data: new Uint8Array([137, 80, 78, 71])
    };
  }
}

function startupFlowProfile(): GameProfile {
  return {
    ...gameProfile,
    uiFlows: [
      {
        flowId: 'create-world',
        name: 'Create World',
        startState: 'Main Menu',
        endState: 'Gameplay',
        steps: [
          {
            stepId: 'start-world',
            expectedScreen: 'Main Menu',
            actionType: 'start-world',
            targetLabel: 'Start World',
            successCondition: 'Gameplay screen is visible.',
            maxRetries: 0
          }
        ]
      }
    ]
  };
}

function startupFlowRunConfig(sessionId: string): SimulationRunConfig {
  return {
    ...runConfig,
    sessionId,
    useMockRuntime: false,
    startupFlowId: 'create-world',
    startupFlowTimeoutMs: 5_000,
    continueOnStartupFlowFailure: false,
    actionDelayMs: 0,
    maxActionsPerBot: 1,
    globalBotLimit: 2,
    botPools: [
      {
        profileId: 'explorer',
        enabled: true,
        minCount: 1,
        desiredCount: 1,
        maxCount: 1,
        scalingMode: 'fixed',
        priority: 10,
        resourceWeight: 'medium'
      }
    ]
  };
}

async function waitForCondition(assertion: () => void): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  throw lastError;
}

describe('SimulationService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates, starts, ticks, and stops a mock session', async () => {
    vi.useFakeTimers();
    const service = new SimulationService({
      now: () => new Date('2026-07-04T09:00:00.000Z').toISOString(),
      systemSnapshot
    });

    const payload = { runConfig, gameProfile, botProfiles };
    const validation = service.validateSessionConfig(payload);
    const created = service.createSession(payload);

    expect(validation.valid).toBe(true);
    expect(created.status.status).toBe('created');
    expect(created.botStatuses).toHaveLength(2);
    expect(created.instanceStatuses).toHaveLength(1);

    const starting = await service.startSession(runConfig.sessionId);
    expect(starting.status).toBe('starting');

    await vi.advanceTimersByTimeAsync(350);

    expect(service.getSessionStatus(runConfig.sessionId).status).toBe('running');
    expect(service.getBotStatuses(runConfig.sessionId).every((bot) => bot.status === 'running')).toBe(true);

    await vi.advanceTimersByTimeAsync(1100);

    expect(service.getBotStatuses(runConfig.sessionId)[0].lastActionId).toContain('explorer-001-action');
    expect(service.getLogs(runConfig.sessionId).some((log) => log.message.includes('State read'))).toBe(true);
    expect(service.getCoverage(runConfig.sessionId).totalObserved).toBeGreaterThan(0);

    const oneStopped = service.stopBot(runConfig.sessionId, 'explorer-001');
    expect(oneStopped.find((bot) => bot.botId === 'explorer-001')?.status).toBe('stopped');

    const poolStopped = service.stopBotPool(runConfig.sessionId, 'explorer');
    expect(poolStopped.every((bot) => bot.status === 'stopped')).toBe(true);

    expect(service.getSessionStatus(runConfig.sessionId).status).toBe('stopped');

    const restarted = await service.startSession(runConfig.sessionId);
    expect(restarted.status).toBe('starting');

    const stopped = await service.stopSession(runConfig.sessionId);

    expect(stopped.status).toBe('stopped');
    expect(service.getBotStatuses(runConfig.sessionId).every((bot) => bot.status === 'stopped')).toBe(true);
  });

  it('launches and stops adapter-backed sessions through AdapterFactory by default', async () => {
    const adapter = new RecordingGameAdapter();
    const createAdapter = vi.fn((_adapterType: SimulationRunConfig['adapterType'], _options?: unknown) => adapter);
    const service = new SimulationService({
      now: () => new Date('2026-07-04T09:00:00.000Z').toISOString(),
      systemSnapshot,
      adapterFactory: { createAdapter }
    });
    const adapterRunConfig: SimulationRunConfig = {
      ...runConfig,
      sessionId: 'session-real-adapter',
      useMockRuntime: false,
      stopOnCriticalIssue: false,
      actionDelayMs: 1,
      maxActionsPerBot: undefined
    };

    const created = service.createSession({
      runConfig: adapterRunConfig,
      gameProfile,
      botProfiles
    });

    expect(created.status.status).toBe('created');
    expect(createAdapter).toHaveBeenCalledWith(
      'browser',
      expect.objectContaining({
        browser: expect.objectContaining({
          targetUrl: gameProfile.launch.url
        })
      })
    );

    const started = await service.startSession(adapterRunConfig.sessionId);

    expect(started.status).toBe('running');
    expect(adapter.launchConfigs).toHaveLength(1);
    expect(adapter.launchConfigs[0].launch.url).toBe(gameProfile.launch.url);
    expect((await service.getInstanceStatuses(adapterRunConfig.sessionId)).every((instance) => instance.status === 'running')).toBe(true);

    const stopped = await service.stopSession(adapterRunConfig.sessionId);

    expect(stopped.status).toBe('stopped');
    expect(adapter.stoppedAll).toBe(true);
    expect((await service.getInstanceStatuses(adapterRunConfig.sessionId)).every((instance) => instance.status === 'stopped')).toBe(true);
  });

  it('completes a startup flow before running the normal bot pool', async () => {
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-startup-success-'));
    const adapter = new StartupFlowGameAdapter();
    const sessionConfig = startupFlowRunConfig('session-startup-success');
    const service = new SimulationService({
      reportRoot,
      now: () => '2026-07-04T09:00:00.000Z',
      systemSnapshot,
      adapterFactory: { createAdapter: vi.fn(() => adapter) }
    });

    service.createSession({
      runConfig: sessionConfig,
      gameProfile: startupFlowProfile(),
      botProfiles
    });
    await service.startSession(sessionConfig.sessionId);

    await waitForCondition(() => {
      expect(adapter.actionOrder.map((entry) => entry.botId)).toEqual([
        'startup-flow-001',
        'explorer-001'
      ]);
      expect(service.getBotStatuses(sessionConfig.sessionId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ botId: 'startup-flow-001', status: 'completed' }),
          expect.objectContaining({ botId: 'explorer-001', status: 'completed' })
        ])
      );
    });

    const metadata = service.listSessions().find((session) => session.sessionId === sessionConfig.sessionId);
    const summaryPath = metadata?.reportPaths.summaryMarkdown;

    expect(summaryPath).toBeTruthy();
    const summary = await readFile(summaryPath!, 'utf8');
    expect(summary).toContain('## Startup Flow');
    expect(summary).toContain('Status: succeeded');
    expect(summary).toContain('startup_flow_succeeded');

    await service.stopSession(sessionConfig.sessionId);
  });

  it('keeps normal bots queued until the startup flow ends', async () => {
    let releaseStartup!: () => void;
    const startupGate = new Promise<void>((resolve) => {
      releaseStartup = resolve;
    });
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-startup-gate-'));
    const adapter = new StartupFlowGameAdapter(startupGate);
    const sessionConfig = startupFlowRunConfig('session-startup-gate');
    const service = new SimulationService({
      reportRoot,
      now: () => '2026-07-04T09:00:00.000Z',
      systemSnapshot,
      adapterFactory: { createAdapter: vi.fn(() => adapter) }
    });

    service.createSession({
      runConfig: sessionConfig,
      gameProfile: startupFlowProfile(),
      botProfiles
    });
    await service.startSession(sessionConfig.sessionId);

    await waitForCondition(() => {
      expect(adapter.actionOrder).toEqual([
        { botId: 'startup-flow-001', actionType: 'start-world' }
      ]);
    });
    expect(service.getBotStatuses(sessionConfig.sessionId)).toContainEqual(
      expect.objectContaining({
        botId: 'explorer-001',
        status: 'queued',
        progressState: 'Waiting for startup flow'
      })
    );

    releaseStartup();

    await waitForCondition(() => {
      expect(adapter.actionOrder.some((entry) => entry.botId === 'explorer-001')).toBe(true);
    });

    await service.stopSession(sessionConfig.sessionId);
  });

  it('records a failed startup step with screenshot evidence and never starts normal bots', async () => {
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-startup-failure-'));
    const adapter = new StartupFlowGameAdapter(undefined, true);
    const sessionConfig = startupFlowRunConfig('session-startup-failure');
    const service = new SimulationService({
      reportRoot,
      now: () => '2026-07-04T09:00:00.000Z',
      systemSnapshot,
      adapterFactory: { createAdapter: vi.fn(() => adapter) }
    });

    service.createSession({
      runConfig: sessionConfig,
      gameProfile: startupFlowProfile(),
      botProfiles
    });
    await service.startSession(sessionConfig.sessionId);

    await waitForCondition(() => {
      expect(service.getSessionStatus(sessionConfig.sessionId).status).toBe('failed');
      expect(service.getIssues(sessionConfig.sessionId)).toContainEqual(
        expect.objectContaining({
          title: 'Startup flow failed',
          severity: 'critical',
          category: 'ui',
          screenshotPath: expect.stringMatching(/issue-detected.*\.png$/)
        })
      );
    });

    const issue = service.getIssues(sessionConfig.sessionId)[0];

    expect(issue.screenshotPath && existsSync(issue.screenshotPath)).toBe(true);
    expect(issue.evidencePaths).toContain(issue.screenshotPath);
    expect(adapter.screenshotRequests).toEqual([
      expect.objectContaining({ botId: 'startup-flow-001' })
    ]);
    expect(adapter.actionOrder.map((entry) => entry.botId)).toEqual(['startup-flow-001']);
    expect(service.getBotStatuses(sessionConfig.sessionId)).toContainEqual(
      expect.objectContaining({ botId: 'explorer-001', status: 'stopped' })
    );
  });

  it('tests a game profile through the selected adapter and cleans up the instance', async () => {
    const adapter = new RecordingGameAdapter();
    const createAdapter = vi.fn((_adapterType: SimulationRunConfig['adapterType'], _options?: unknown) => adapter);
    const service = new SimulationService({
      now: () => new Date('2026-07-04T09:00:00.000Z').toISOString(),
      systemSnapshot,
      adapterFactory: { createAdapter }
    });

    const result = await service.testGameProfile({ gameProfile });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('succeeded');
    expect(result.runtimeMode).toBe('browser');
    expect(result.launched).toBe(true);
    expect(result.stopped).toBe(true);
    expect(result.availableActions).toEqual(['Wait']);
    expect(result.stateSummary).toContain('Recording Adapter Scene');
    expect(result.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'State read', supported: true }),
        expect.objectContaining({ label: 'Keyboard/mouse input', supported: true })
      ])
    );
    expect(adapter.launchConfigs).toHaveLength(1);
    expect(adapter.launchConfigs[0].environment.GAMEPLAY_SIMULATOR_PROFILE_TEST).toBe('1');
    expect(adapter.stoppedAll).toBe(true);
  });

  it('rejects invalid desktop adapter profiles before session startup', () => {
    const createAdapter = vi.fn((_adapterType: SimulationRunConfig['adapterType'], _options?: unknown) => new RecordingGameAdapter());
    const service = new SimulationService({
      now: () => new Date('2026-07-04T09:00:00.000Z').toISOString(),
      systemSnapshot,
      adapterFactory: { createAdapter }
    });
    const desktopRunConfig: SimulationRunConfig = {
      ...runConfig,
      sessionId: 'session-invalid-desktop-profile',
      adapterType: 'desktop',
      useMockRuntime: false
    };
    const desktopProfile: GameProfile = {
      ...gameProfile,
      engine: { type: 'unknown' },
      launch: {
        platform: 'windows',
        arguments: []
      },
      adapter: {
        ...gameProfile.adapter,
        type: 'desktop',
        supportsMultipleInstances: false,
        supportsStateRead: false,
        supportsDirectActions: false
      },
      controls: []
    };
    const payload = {
      runConfig: desktopRunConfig,
      gameProfile: desktopProfile,
      botProfiles
    };
    const validation = service.validateSessionConfig(payload);

    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'launch.executablePath' }),
        expect.objectContaining({ path: 'controls' })
      ])
    );
    expect(() => service.createSession(payload)).toThrow(/Desktop adapter profiles need an executable path/);
    expect(createAdapter).not.toHaveBeenCalled();
  });

  it('reports adapter launch failures as failed sessions with critical issues', async () => {
    const adapter = new FailingLaunchAdapter();
    const createAdapter = vi.fn((_adapterType: SimulationRunConfig['adapterType'], _options?: unknown) => adapter);
    const service = new SimulationService({
      now: () => new Date('2026-07-04T09:00:00.000Z').toISOString(),
      systemSnapshot,
      adapterFactory: { createAdapter }
    });
    const failingRunConfig: SimulationRunConfig = {
      ...runConfig,
      sessionId: 'session-adapter-launch-failed',
      useMockRuntime: false
    };

    service.createSession({
      runConfig: failingRunConfig,
      gameProfile,
      botProfiles
    });

    const started = await service.startSession(failingRunConfig.sessionId);
    const issues = service.getIssues(failingRunConfig.sessionId);

    expect(started.status).toBe('failed');
    expect(adapter.stoppedAll).toBe(true);
    expect(service.getLogs(failingRunConfig.sessionId).some((log) => log.message.includes('Adapter startup failed'))).toBe(true);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'critical',
          category: 'crash',
          title: 'Game adapter failed to launch'
        })
      ])
    );
  });

  it('writes and opens a mock report', async () => {
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-reports-'));
    const openedPaths: string[] = [];
    const service = new SimulationService({
      reportRoot,
      systemSnapshot,
      openPath: async (path) => {
        openedPaths.push(path);
        return '';
      }
    });

    service.createSession({ runConfig, gameProfile, botProfiles });

    const result = await service.openReport(runConfig.sessionId);
    const contents = await readFile(result.reportPath, 'utf8');

    expect(result.opened).toBe(true);
    expect(openedPaths).toEqual([result.reportPath]);
    expect(contents).toContain('GameplaySimulator Session');
    expect(contents).toContain(runConfig.sessionId);
    expect(contents).toContain('## Bot Counts');
    expect(contents).toContain('## Resource Viability');
    expect(contents).toContain('## Content Coverage');
    expect(contents).toContain('HTML report:');
    expect(existsSync(join(dirname(result.reportPath), 'session-report.html'))).toBe(true);
  });

  it('writes and opens structured JSONL logs', async () => {
    vi.useFakeTimers();
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-logs-'));
    const openedPaths: string[] = [];
    const service = new SimulationService({
      reportRoot,
      now: () => new Date('2026-07-04T09:00:00.000Z').toISOString(),
      systemSnapshot,
      openPath: async (path) => {
        openedPaths.push(path);
        return '';
      }
    });

    service.createSession({ runConfig, gameProfile, botProfiles });
    await service.startSession(runConfig.sessionId);
    await vi.advanceTimersByTimeAsync(350);
    await vi.advanceTimersByTimeAsync(1100);

    const result = await service.openLogs(runConfig.sessionId);
    const contents = await readFile(result.logsPath, 'utf8');
    const sessionEvents = parseJsonl(contents);
    const sessionDirectory = dirname(result.logsPath);
    const botDirectory = join(sessionDirectory, 'bots', 'explorer-001');
    const actions = parseJsonl(await readFile(join(botDirectory, 'actions.jsonl'), 'utf8'));
    const states = parseJsonl(await readFile(join(botDirectory, 'states.jsonl'), 'utf8'));

    expect(result.opened).toBe(true);
    expect(openedPaths).toEqual([result.logsPath]);
    expect(result.logsPath.endsWith('full-structured-logs.jsonl')).toBe(true);
    expect(sessionEvents.some((event) => event.eventType === 'session_start')).toBe(true);
    expect(sessionEvents.some((event) => event.eventType === 'instance_start')).toBe(true);
    expect(sessionEvents.some((event) => event.eventType === 'bot_start')).toBe(true);
    expect(sessionEvents.some((event) => event.eventType === 'action_performed')).toBe(true);
    expect(sessionEvents.some((event) => event.eventType === 'state_snapshot')).toBe(true);
    expect(actions.length).toBeGreaterThan(0);
    expect(states.length).toBeGreaterThan(0);
    expect(existsSync(join(sessionDirectory, 'config.json'))).toBe(true);
    expect(existsSync(join(sessionDirectory, 'viability-report.json'))).toBe(true);
    expect(existsSync(join(sessionDirectory, 'session-summary.json'))).toBe(true);
    expect(existsSync(join(sessionDirectory, 'important-events.jsonl'))).toBe(true);
    expect(existsSync(join(sessionDirectory, 'issues.json'))).toBe(true);
    expect(existsSync(join(sessionDirectory, 'issue-timeline.json'))).toBe(true);
    expect(existsSync(join(sessionDirectory, 'metadata.json'))).toBe(true);
    expect(existsSync(join(sessionDirectory, 'reports'))).toBe(true);
    expect(existsSync(join(sessionDirectory, 'exports'))).toBe(true);
    expect(existsSync(join(sessionDirectory, 'replay'))).toBe(true);
    expect(existsSync(join(botDirectory, 'bot-report.md'))).toBe(true);
  });

  it('detects critical issues, logs them, and stops the session when configured', async () => {
    vi.useFakeTimers();
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-critical-'));
    const service = new SimulationService({
      reportRoot,
      now: () => new Date('2026-07-04T09:00:00.000Z').toISOString(),
      systemSnapshot
    });

    service.createSession({
      runConfig: boundaryRunConfig,
      gameProfile,
      botProfiles: boundaryBotProfiles
    });
    await service.startSession(boundaryRunConfig.sessionId);

    await vi.advanceTimersByTimeAsync(350);
    await vi.advanceTimersByTimeAsync(1000);

    const issues = service.getIssues(boundaryRunConfig.sessionId);
    const boundaryIssue = issues.find((issue) => issue.category === 'world_boundary' && issue.severity === 'critical');
    expect(boundaryIssue).toBeDefined();
    expect(boundaryIssue?.screenshotPath).toBeDefined();
    expect(boundaryIssue?.screenshotPath ? existsSync(boundaryIssue.screenshotPath) : false).toBe(true);
    expect(boundaryIssue?.evidencePaths).toContain(boundaryIssue?.screenshotPath);
    expect(service.getSessionStatus(boundaryRunConfig.sessionId).status).toBe('stopped');

    const logsResult = await service.openLogs(boundaryRunConfig.sessionId);
    const sessionEvents = parseJsonl(await readFile(logsResult.logsPath, 'utf8'));
    expect(sessionEvents.some((event) => event.eventType === 'issue_detected')).toBe(true);
    expect(sessionEvents.some((event) => event.eventType === 'session_stop')).toBe(true);
  });

  it('attaches optional video evidence to issues when video capture is enabled', async () => {
    vi.useFakeTimers();
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-video-'));
    const service = new SimulationService({
      reportRoot,
      now: () => new Date('2026-07-04T09:00:00.000Z').toISOString(),
      systemSnapshot
    });
    const videoProfile: GameProfile = {
      ...gameProfile,
      adapter: {
        ...gameProfile.adapter,
        supportsVideo: true
      }
    };
    const videoRunConfig: SimulationRunConfig = {
      ...boundaryRunConfig,
      sessionId: 'session-critical-boundary-video',
      saveVideo: true
    };

    service.createSession({
      runConfig: videoRunConfig,
      gameProfile: videoProfile,
      botProfiles: boundaryBotProfiles
    });
    await service.startSession(videoRunConfig.sessionId);

    await vi.advanceTimersByTimeAsync(350);
    await vi.advanceTimersByTimeAsync(1000);

    const issue = service.getIssues(videoRunConfig.sessionId).find((item) => item.category === 'world_boundary');

    expect(issue?.videoPath).toBeDefined();
    expect(issue?.videoPath ? existsSync(issue.videoPath) : false).toBe(true);
    expect(issue?.evidencePaths).toContain(issue?.videoPath);
  });

  it('generates a build comparison report between sessions', async () => {
    vi.useFakeTimers();
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-comparison-'));
    const openedPaths: string[] = [];
    let nowOffsetSeconds = 0;
    const service = new SimulationService({
      reportRoot,
      now: () => new Date(Date.UTC(2026, 6, 4, 9, 0, nowOffsetSeconds++)).toISOString(),
      systemSnapshot,
      openPath: async (path) => {
        openedPaths.push(path);
        return '';
      }
    });
    const oldRunConfig: SimulationRunConfig = {
      ...boundaryRunConfig,
      sessionId: 'session-old-build'
    };
    const newRunConfig: SimulationRunConfig = {
      ...boundaryRunConfig,
      sessionId: 'session-new-build'
    };

    service.createSession({
      runConfig: oldRunConfig,
      gameProfile: { ...gameProfile, version: '1.0.0', buildId: 'old-build' },
      botProfiles: boundaryBotProfiles
    });
    await service.startSession(oldRunConfig.sessionId);
    await vi.advanceTimersByTimeAsync(350);
    await vi.advanceTimersByTimeAsync(1000);

    service.createSession({
      runConfig: newRunConfig,
      gameProfile: { ...gameProfile, version: '1.0.1', buildId: 'new-build' },
      botProfiles: boundaryBotProfiles
    });
    await service.startSession(newRunConfig.sessionId);
    await vi.advanceTimersByTimeAsync(350);
    await vi.advanceTimersByTimeAsync(1000);

    const result = await service.compareSessions(oldRunConfig.sessionId, newRunConfig.sessionId);
    const contents = await readFile(result.reportPath, 'utf8');

    expect(result.opened).toBe(true);
    expect(openedPaths).toContain(result.reportPath);
    expect(result.summary.repeatedIssues).toBeGreaterThan(0);
    expect(contents).toContain('Build Comparison');
    expect(contents).toContain('## New Issues');
    expect(contents).toContain('## Fixed Issues');
    expect(contents).toContain('## Repeated Issues');
    expect(contents).toContain('Player fell out of the world');
    expect(contents).toContain('## Coverage Difference');
    expect(contents).toContain('## Crash Frequency Changes');
  });

  it('loads saved sessions from disk after restart and compares persisted runs', async () => {
    vi.useFakeTimers();
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-persisted-sessions-'));
    const openedPaths: string[] = [];
    let nowOffsetSeconds = 0;
    const service = new SimulationService({
      reportRoot,
      now: () => new Date(Date.UTC(2026, 6, 4, 10, 0, nowOffsetSeconds++)).toISOString(),
      systemSnapshot,
      openPath: async (path) => {
        openedPaths.push(path);
        return '';
      }
    });
    const oldRunConfig: SimulationRunConfig = {
      ...boundaryRunConfig,
      sessionId: 'session-persisted-old'
    };
    const newRunConfig: SimulationRunConfig = {
      ...boundaryRunConfig,
      sessionId: 'session-persisted-new'
    };

    service.createSession({
      runConfig: oldRunConfig,
      gameProfile: { ...gameProfile, version: '1.0.0', buildId: 'persisted-old-build' },
      botProfiles: boundaryBotProfiles
    });
    await service.startSession(oldRunConfig.sessionId);
    await vi.advanceTimersByTimeAsync(350);
    await vi.advanceTimersByTimeAsync(1000);

    service.createSession({
      runConfig: newRunConfig,
      gameProfile: { ...gameProfile, version: '1.0.1', buildId: 'persisted-new-build' },
      botProfiles: boundaryBotProfiles
    });
    await service.startSession(newRunConfig.sessionId);
    await vi.advanceTimersByTimeAsync(350);
    await vi.advanceTimersByTimeAsync(1000);

    const restartedService = new SimulationService({
      reportRoot,
      now: () => new Date('2026-07-04T11:00:00.000Z').toISOString(),
      systemSnapshot,
      openPath: async (path) => {
        openedPaths.push(path);
        return '';
      }
    });
    const savedSessions = restartedService.listSessions();
    const oldMetadata = savedSessions.find((session) => session.sessionId === oldRunConfig.sessionId);
    const newMetadata = savedSessions.find((session) => session.sessionId === newRunConfig.sessionId);

    expect(oldMetadata).toEqual(expect.objectContaining({
      gameName: gameProfile.gameName,
      buildId: 'persisted-old-build',
      status: 'stopped'
    }));
    expect(newMetadata).toEqual(expect.objectContaining({
      buildId: 'persisted-new-build',
      status: 'stopped'
    }));
    expect(oldMetadata?.issueCounts.total).toBeGreaterThan(0);
    expect(existsSync(join(oldMetadata!.reportPaths.sessionDirectory, 'session.json'))).toBe(true);

    const persistedIssues = restartedService.getIssues(oldRunConfig.sessionId);
    expect(persistedIssues.some((issue) => issue.category === 'world_boundary')).toBe(true);

    const report = await restartedService.openReport(oldRunConfig.sessionId);
    const comparison = await restartedService.compareSessions(oldRunConfig.sessionId, newRunConfig.sessionId);
    const comparisonContents = await readFile(comparison.reportPath, 'utf8');

    expect(report.opened).toBe(true);
    expect(comparison.opened).toBe(true);
    expect(openedPaths).toContain(report.reportPath);
    expect(openedPaths).toContain(comparison.reportPath);
    expect(comparisonContents).toContain('Build Comparison');
    expect(comparisonContents).toContain('persisted-old-build');
    expect(comparisonContents).toContain('persisted-new-build');
  });

  it('previews and exports GitHub issue markdown without a token', async () => {
    vi.useFakeTimers();
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-github-export-'));
    const openedPaths: string[] = [];
    const service = new SimulationService({
      reportRoot,
      now: () => new Date('2026-07-04T09:00:00.000Z').toISOString(),
      systemSnapshot,
      openPath: async (path) => {
        openedPaths.push(path);
        return '';
      }
    });
    const githubRunConfig: SimulationRunConfig = {
      ...boundaryRunConfig,
      sessionId: 'session-github-export'
    };

    service.createSession({
      runConfig: githubRunConfig,
      gameProfile: { ...gameProfile, version: '2.0.0', buildId: 'github-export-build' },
      botProfiles: boundaryBotProfiles
    });
    await service.startSession(githubRunConfig.sessionId);
    await vi.advanceTimersByTimeAsync(350);
    await vi.advanceTimersByTimeAsync(1000);

    const issue = service.getIssues(githubRunConfig.sessionId).find((item) => item.category === 'world_boundary');
    expect(issue).toBeDefined();

    const payload = {
      sessionId: githubRunConfig.sessionId,
      issueIds: [issue!.id ?? issue!.issueId],
      minimumSeverity: 'warning',
      minimumConfidence: 0.8
    };
    const preview = service.previewGitHubIssueExport(payload);
    const exportResult = await service.exportGitHubIssueMarkdown(payload);
    const indexContents = await readFile(exportResult.indexPath, 'utf8');
    const issueContents = await readFile(exportResult.markdownPaths[0], 'utf8');

    expect(preview.issueCount).toBe(1);
    expect(preview.combinedMarkdown).toContain('GitHub Issue Export');
    expect(preview.issues[0].body).toContain('## Steps To Reproduce');
    expect(preview.issues[0].body).toContain('Game build');
    expect(preview.issues[0].body).toContain('github-export-build');
    expect(preview.issues[0].body).toContain(issue?.screenshotPath);
    expect(exportResult.opened).toBe(true);
    expect(openedPaths).toContain(exportResult.indexPath);
    expect(indexContents).toContain('[critical] [world_boundary]');
    expect(issueContents).toContain('Player fell out of the world');
  });

  it('does not post GitHub issues without explicit confirmation', async () => {
    vi.useFakeTimers();
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-github-post-'));
    const service = new SimulationService({
      reportRoot,
      now: () => new Date('2026-07-04T09:00:00.000Z').toISOString(),
      systemSnapshot
    });
    const githubRunConfig: SimulationRunConfig = {
      ...boundaryRunConfig,
      sessionId: 'session-github-post'
    };

    service.createSession({
      runConfig: githubRunConfig,
      gameProfile,
      botProfiles: boundaryBotProfiles
    });
    await service.startSession(githubRunConfig.sessionId);
    await vi.advanceTimersByTimeAsync(350);
    await vi.advanceTimersByTimeAsync(1000);

    const issue = service.getIssues(githubRunConfig.sessionId).find((item) => item.category === 'world_boundary');
    const result = await service.postGitHubIssues({
      sessionId: githubRunConfig.sessionId,
      issueIds: [issue?.id ?? issue?.issueId ?? 'missing'],
      minimumSeverity: 'warning',
      minimumConfidence: 0.8,
      owner: 'example',
      repo: 'game',
      token: 'not-used-without-confirmation',
      useConfiguredToken: false,
      confirmed: false,
      labels: []
    });

    expect(result.posted).toBe(false);
    expect(result.created).toHaveLength(0);
    expect(result.message).toContain('not confirmed');
  });

  it('gracefully shuts down active sessions and preserves partial reports', async () => {
    vi.useFakeTimers();
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-shutdown-'));
    const service = new SimulationService({
      reportRoot,
      now: () => new Date('2026-07-04T09:00:00.000Z').toISOString(),
      systemSnapshot
    });
    const interruptedRunConfig: SimulationRunConfig = {
      ...runConfig,
      sessionId: 'session-interrupted'
    };

    service.createSession({ runConfig: interruptedRunConfig, gameProfile, botProfiles });
    await service.startSession(interruptedRunConfig.sessionId);
    await vi.advanceTimersByTimeAsync(350);
    await vi.advanceTimersByTimeAsync(500);

    const snapshots = await service.shutdownAllSessions('test_shutdown');
    const report = await service.openReport(interruptedRunConfig.sessionId);
    const logs = await service.openLogs(interruptedRunConfig.sessionId);
    const sessionEvents = parseJsonl(await readFile(logs.logsPath, 'utf8'));
    const summary = await readFile(report.reportPath, 'utf8');

    expect(snapshots.find((snapshot) => snapshot.sessionId === interruptedRunConfig.sessionId)?.status).toBe('stopped');
    expect(service.getBotStatuses(interruptedRunConfig.sessionId).every((bot) => bot.status === 'stopped')).toBe(true);
    expect((await service.getInstanceStatuses(interruptedRunConfig.sessionId)).every((instance) => instance.status === 'stopped')).toBe(true);
    expect(sessionEvents.some((event) => event.eventType === 'manual_stop')).toBe(true);
    expect(sessionEvents.some((event) => event.eventType === 'session_stop')).toBe(true);
    expect(summary).toContain('GameplaySimulator Session');
    expect(summary).toContain('session-interrupted');
  });
});
