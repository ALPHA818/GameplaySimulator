import { existsSync } from 'node:fs';
import { appendFile, mkdir, mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type {
  ActionResult,
  BotTestDirective,
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
  GameAdapterInstance,
  ObservationTargetUpdate
} from '../../../../../packages/adapters/src';
import { SimulationService } from './simulationService';

class TestSimulationService extends SimulationService {
  override createSession(payload: unknown) {
    const created = super.createSession(payload);
    const request = payload as {
      runConfig?: {
        sessionId?: string;
        directives?: Array<{ sessionId: string }>;
      };
    };

    if (request.runConfig) {
      request.runConfig.sessionId = created.sessionId;
      request.runConfig.directives?.forEach((directive) => {
        directive.sessionId = created.sessionId;
      });
    }

    return created;
  }
}

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
  supportsCheckpointReload: false,
  supportsLiveObservation: true,
  supportsWindowFocus: true,
  supportsMultipleVisibleWindows: true,
  observationCapability: 'visible-window'
};

class RecordingGameAdapter implements GameAdapter {
  readonly id = 'recording-browser';
  readonly name = 'Recording Browser Adapter';
  readonly adapterType = 'browser';
  readonly capabilities = adapterCapabilities;
  readonly launchConfigs: GameInstanceConfig[] = [];
  readonly stoppedInstances: string[] = [];
  readonly focusedInstances: string[] = [];
  readonly observationTargets: ObservationTargetUpdate[] = [];
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

  async openOrFocusGameWindow(instanceId: string) {
    this.focusedInstances.push(instanceId);
    return {
      instanceId,
      supported: true,
      visible: true,
      focused: true,
      message: `Focused ${instanceId}.`
    };
  }

  updateObservationTarget(target: ObservationTargetUpdate): void {
    this.observationTargets.push(target);
  }
}

class FailingLaunchAdapter extends RecordingGameAdapter {
  override async launchInstance(_config: GameInstanceConfig): Promise<GameAdapterInstance> {
    throw new Error('configured game could not launch');
  }
}

class FailingStopAdapter extends RecordingGameAdapter {
  override async stopInstance(_instanceId: string): Promise<void> {
    throw new Error('adapter refused to stop owned instance');
  }

  override async stopAll(): Promise<void> {
    throw new Error('adapter cleanup failed');
  }
}

class HangingBrowserCloseAdapter extends RecordingGameAdapter {
  forcedCleanup = false;

  override async stopInstance(_instanceId: string): Promise<void> {
    await new Promise<void>(() => undefined);
  }

  override async stopAll(): Promise<void> {
    await new Promise<void>(() => undefined);
  }

  async forceStopAll(): Promise<void> {
    this.forcedCleanup = true;
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
      data: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
      )
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

  it('replaces the renderer draft ID with a main-process UUID and keeps the readable name separate', async () => {
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-internal-id-'));
    const generatedId = '123e4567-e89b-42d3-a456-426614174000';
    const draftConfig: SimulationRunConfig = {
      ...runConfig,
      sessionId: '../../renderer-proposed-id',
      sessionName: '  First release smoke test  '
    };
    const service = new SimulationService({
      reportRoot,
      systemSnapshot,
      generateSessionId: () => generatedId
    });

    const created = service.createSession({ runConfig: draftConfig, gameProfile, botProfiles });
    const metadata = service.listSessions().find((session) => session.sessionId === generatedId);

    expect(created.sessionId).toBe(generatedId);
    expect(draftConfig.sessionId).toBe('../../renderer-proposed-id');
    expect(metadata?.sessionName).toBe('First release smoke test');
    expect(basename(metadata!.reportPaths.sessionDirectory)).toBe(`session-${generatedId}`);
    expect(dirname(metadata!.reportPaths.sessionDirectory)).toBe(reportRoot);
  });

  it('rejects a duplicate generated session ID and never reuses an existing folder', async () => {
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-session-collision-'));
    const generatedId = '123e4567-e89b-42d3-a456-426614174001';
    const service = new SimulationService({
      reportRoot,
      systemSnapshot,
      generateSessionId: () => generatedId
    });
    const first = service.createSession({ runConfig: { ...runConfig }, gameProfile, botProfiles });
    await service.stopSession(first.sessionId);

    expect(() =>
      service.createSession({
        runConfig: { ...runConfig, sessionId: 'another-renderer-draft' },
        gameProfile,
        botProfiles
      })
    ).toThrow(/already exists.*No existing run was changed/i);

    const secondRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-existing-folder-'));
    await mkdir(join(secondRoot, `session-${generatedId}`));
    const secondService = new SimulationService({
      reportRoot: secondRoot,
      systemSnapshot,
      generateSessionId: () => generatedId
    });

    expect(() =>
      secondService.createSession({ runConfig: { ...runConfig }, gameProfile, botProfiles })
    ).toThrow(/already exists.*No existing run was changed/i);
  });

  it('rejects duplicate bot profile IDs in a session request', () => {
    const service = new SimulationService({ systemSnapshot });
    const validation = service.validateSessionConfig({
      runConfig: { ...runConfig },
      gameProfile,
      botProfiles: [botProfiles[0], { ...botProfiles[0] }]
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContainEqual(expect.objectContaining({
      path: 'botProfiles.1.profileId',
      message: expect.stringMatching(/must be unique/i)
    }));
  });

  it('creates, starts, ticks, and stops a mock session', async () => {
    vi.useFakeTimers();
    const service = new TestSimulationService({
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
  }, 10_000);

  it('stops at the maximum active runtime and excludes paused time', async () => {
    vi.useFakeTimers();
    const deadlineRunConfig: SimulationRunConfig = {
      ...runConfig,
      sessionId: 'session-active-runtime-deadline',
      runUntilStopped: true,
      maxRuntimeMinutes: 0.001,
      actionDelayMs: 1_000,
      maxActionsPerBot: undefined,
      botPools: [{
        ...runConfig.botPools[0],
        minCount: 1,
        desiredCount: 1,
        maxCount: 1
      }]
    };
    const service = new TestSimulationService({ systemSnapshot });

    service.createSession({ runConfig: deadlineRunConfig, gameProfile, botProfiles });
    await service.startSession(deadlineRunConfig.sessionId);
    await vi.advanceTimersByTimeAsync(310);
    expect(service.getSessionStatus(deadlineRunConfig.sessionId).status).toBe('running');

    service.pauseSession(deadlineRunConfig.sessionId);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(service.getSessionStatus(deadlineRunConfig.sessionId).status).toBe('paused');

    service.resumeSession(deadlineRunConfig.sessionId);
    await vi.advanceTimersByTimeAsync(49);
    expect(service.getSessionStatus(deadlineRunConfig.sessionId).status).toBe('running');

    await vi.advanceTimersByTimeAsync(2);
    expect(service.getSessionStatus(deadlineRunConfig.sessionId).status).toBe('stopped');
    expect(
      service.getLogs(deadlineRunConfig.sessionId).some((entry) =>
        entry.message.includes('Maximum active runtime')
      )
    ).toBe(true);

    const structuredLogs = await service.getStructuredLogs(deadlineRunConfig.sessionId);
    expect(structuredLogs.logs.some((entry) => entry.eventType === 'max_runtime_reached')).toBe(true);
  });

  it('does not write disabled action timelines or state snapshots', async () => {
    vi.useFakeTimers();
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-artifact-settings-'));
    const artifactRunConfig: SimulationRunConfig = {
      ...runConfig,
      sessionId: 'session-disabled-runtime-artifacts',
      saveActionTimeline: false,
      saveStateSnapshots: false,
      actionDelayMs: 0,
      maxActionsPerBot: 1,
      botPools: [{
        ...runConfig.botPools[0],
        minCount: 1,
        desiredCount: 1,
        maxCount: 1
      }]
    };
    const service = new TestSimulationService({ reportRoot, systemSnapshot });

    service.createSession({ runConfig: artifactRunConfig, gameProfile, botProfiles });
    await service.startSession(artifactRunConfig.sessionId);
    await vi.advanceTimersByTimeAsync(350);
    await vi.advanceTimersByTimeAsync(10);

    const report = await service.openReport(artifactRunConfig.sessionId);
    const sessionDirectory = dirname(report.reportPath);
    const botDirectory = join(sessionDirectory, 'bots', 'explorer-001');
    const summary = await readFile(report.reportPath, 'utf8');
    const structuredLogs = await service.getStructuredLogs(artifactRunConfig.sessionId);

    expect(existsSync(join(botDirectory, 'actions.jsonl'))).toBe(false);
    expect(existsSync(join(botDirectory, 'states.jsonl'))).toBe(false);
    expect(existsSync(join(sessionDirectory, 'replay'))).toBe(false);
    expect(structuredLogs.logs.some((entry) => entry.eventType === 'action_performed')).toBe(false);
    expect(structuredLogs.logs.some((entry) => entry.eventType === 'state_snapshot')).toBe(false);
    expect(summary).toContain('Action timeline artifacts: disabled');
    expect(summary).toContain('State snapshot artifacts: disabled');
  });

  it('rejects creating another session while the active session is running', async () => {
    vi.useFakeTimers();
    const service = new TestSimulationService({ systemSnapshot });
    const activeRunConfig = { ...runConfig, sessionId: 'session-active-running' };
    const secondRunConfig = { ...runConfig, sessionId: 'session-blocked-by-running' };

    service.createSession({ runConfig: activeRunConfig, gameProfile, botProfiles });
    await service.startSession(activeRunConfig.sessionId);
    await vi.advanceTimersByTimeAsync(350);

    expect(() =>
      service.createSession({ runConfig: secondRunConfig, gameProfile, botProfiles })
    ).toThrow(/currently running.*stop it/i);
    expect(service.getStatus().activeSessionId).toBe(activeRunConfig.sessionId);

    await service.stopSession(activeRunConfig.sessionId);
  });

  it('rejects creating another session while the active session is created or starting', async () => {
    vi.useFakeTimers();
    const createdService = new TestSimulationService({ systemSnapshot });
    const createdRunConfig = { ...runConfig, sessionId: 'session-active-created' };

    createdService.createSession({ runConfig: createdRunConfig, gameProfile, botProfiles });
    expect(() =>
      createdService.createSession({
        runConfig: { ...runConfig, sessionId: 'session-blocked-by-created' },
        gameProfile,
        botProfiles
      })
    ).toThrow(/currently created.*start or stop/i);
    await createdService.stopSession(createdRunConfig.sessionId);

    const startingService = new TestSimulationService({ systemSnapshot });
    const startingRunConfig = { ...runConfig, sessionId: 'session-active-starting' };
    startingService.createSession({ runConfig: startingRunConfig, gameProfile, botProfiles });
    await startingService.startSession(startingRunConfig.sessionId);

    await expect(startingService.startSession(startingRunConfig.sessionId)).rejects.toThrow(
      /currently starting.*cannot start/i
    );
    expect(() =>
      startingService.createSession({
        runConfig: { ...runConfig, sessionId: 'session-blocked-by-starting' },
        gameProfile,
        botProfiles
      })
    ).toThrow(/currently starting.*stop it/i);
    await startingService.stopSession(startingRunConfig.sessionId);
  });

  it('rejects creating another session while the active session is paused', async () => {
    vi.useFakeTimers();
    const service = new TestSimulationService({ systemSnapshot });
    const activeRunConfig = { ...runConfig, sessionId: 'session-active-paused' };
    const secondRunConfig = { ...runConfig, sessionId: 'session-blocked-by-paused' };

    service.createSession({ runConfig: activeRunConfig, gameProfile, botProfiles });
    await service.startSession(activeRunConfig.sessionId);
    await vi.advanceTimersByTimeAsync(350);
    service.pauseSession(activeRunConfig.sessionId);

    expect(() =>
      service.createSession({ runConfig: secondRunConfig, gameProfile, botProfiles })
    ).toThrow(/currently paused.*resume or stop/i);
    expect(service.getStatus().activeSessionId).toBe(activeRunConfig.sessionId);

    await service.stopSession(activeRunConfig.sessionId);
  });

  it('rejects starting a stopped session while another session is stopping', async () => {
    vi.useFakeTimers();
    const service = new TestSimulationService({ systemSnapshot });
    const restartableRunConfig = { ...runConfig, sessionId: 'session-restartable' };
    const activeRunConfig = { ...runConfig, sessionId: 'session-active-stopping' };

    service.createSession({ runConfig: restartableRunConfig, gameProfile, botProfiles });
    await service.stopSession(restartableRunConfig.sessionId);
    service.createSession({ runConfig: activeRunConfig, gameProfile, botProfiles });
    await service.startSession(activeRunConfig.sessionId);
    await vi.advanceTimersByTimeAsync(350);

    const stopping = service.stopSession(activeRunConfig.sessionId);
    await expect(service.startSession(restartableRunConfig.sessionId)).rejects.toThrow(
      /currently stopping.*wait for it to finish/i
    );
    expect(service.getStatus().activeSessionId).toBe(activeRunConfig.sessionId);
    await stopping;
  });

  it('allows a new session after the previous session has stopped', async () => {
    const service = new TestSimulationService({ systemSnapshot });
    const firstRunConfig = { ...runConfig, sessionId: 'session-first-stopped' };
    const secondRunConfig = { ...runConfig, sessionId: 'session-after-stop' };

    service.createSession({ runConfig: firstRunConfig, gameProfile, botProfiles });
    await service.stopSession(firstRunConfig.sessionId);
    const created = service.createSession({
      runConfig: secondRunConfig,
      gameProfile,
      botProfiles
    });

    expect(created.sessionId).toBe(secondRunConfig.sessionId);
    expect(service.getStatus().activeSessionId).toBe(secondRunConfig.sessionId);
    expect(service.getStatus().status).toBe('created');
  });

  it('recovers a persisted live status as failed without blocking a new session', async () => {
    vi.useFakeTimers();
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-active-recovery-'));
    const interruptedRunConfig = { ...runConfig, sessionId: 'session-recovered-interrupted' };
    const newRunConfig = { ...runConfig, sessionId: 'session-after-recovery' };
    const originalService = new TestSimulationService({ reportRoot, systemSnapshot });

    originalService.createSession({ runConfig: interruptedRunConfig, gameProfile, botProfiles });
    await originalService.startSession(interruptedRunConfig.sessionId);
    await vi.advanceTimersByTimeAsync(350);
    expect(originalService.getSessionStatus(interruptedRunConfig.sessionId).status).toBe('running');

    const restartedService = new TestSimulationService({ reportRoot, systemSnapshot });
    expect(restartedService.getSessionStatus(interruptedRunConfig.sessionId).status).toBe('failed');

    const created = restartedService.createSession({
      runConfig: newRunConfig,
      gameProfile,
      botProfiles
    });
    expect(created.sessionId).toBe(newRunConfig.sessionId);
    expect(restartedService.getStatus().activeSessionId).toBe(newRunConfig.sessionId);

    await originalService.forceCleanupOwnedProcesses();
    await vi.runAllTimersAsync();
  });

  it('rejects guiding a non-active session while another mutable session owns the runtime', async () => {
    const service = new TestSimulationService({ systemSnapshot });
    let oldSessionId = 'session-old-guidance-target';
    let activeSessionId = 'session-current-owner';

    oldSessionId = service.createSession({
      runConfig: { ...runConfig, sessionId: oldSessionId },
      gameProfile,
      botProfiles
    }).sessionId;
    await service.stopSession(oldSessionId);
    activeSessionId = service.createSession({
      runConfig: { ...runConfig, sessionId: activeSessionId },
      gameProfile,
      botProfiles
    }).sessionId;

    await expect(service.guideBot({
      sessionId: oldSessionId,
      botId: 'explorer-001',
      behavior: 'apply',
      directive: {
        directiveId: 'blocked-cross-session-guidance',
        sessionId: oldSessionId,
        name: 'Test movement',
        description: 'Try a supported movement action.',
        directiveType: 'action',
        directiveMode: 'focus',
        priority: 'normal',
        status: 'queued',
        target: {
          allBots: false,
          botIds: ['explorer-001'],
          profileIds: [],
          gameInstanceIds: []
        },
        actionKeywords: ['move'],
        avoidedActionKeywords: [],
        successConditions: ['A movement action succeeds.'],
        failureConditions: [],
        steps: [],
        repeatUntilSuccess: false,
        createdAt: '2026-07-04T09:00:00.000Z',
        createdBy: 'user'
      }
    })).rejects.toThrow(/currently created.*cannot guide bots/i);
  });

  it('rejects a real specialist pool when its required input capability is unavailable', () => {
    const service = new TestSimulationService({ systemSnapshot });
    const controllerProfile: BotProfile = {
      ...botProfiles[0],
      profileId: 'controller-gamepad-tester-bot',
      displayName: 'Controller And Gamepad Tester Bot',
      botType: 'controller-gamepad'
    };
    const controllerRunConfig: SimulationRunConfig = {
      ...runConfig,
      sessionId: 'session-controller-unavailable',
      useMockRuntime: false,
      botPools: [{
        ...runConfig.botPools[0],
        profileId: controllerProfile.profileId,
        minCount: 1,
        desiredCount: 1,
        maxCount: 1
      }]
    };

    const validation = service.validateSessionConfig({
      runConfig: controllerRunConfig,
      gameProfile,
      botProfiles: [controllerProfile]
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors.map((error) => error.message).join(' ')).toContain('Gamepad input is unavailable');
  });

  it('rejects network specialists without explicit controlled-test confirmation', () => {
    const service = new TestSimulationService({ systemSnapshot });
    const networkProfile: BotProfile = {
      ...botProfiles[0],
      profileId: 'network-resilience-tester-bot',
      displayName: 'Network Resilience Tester Bot',
      botType: 'network-resilience'
    };
    const networkRunConfig: SimulationRunConfig = {
      ...runConfig,
      sessionId: 'session-network-unconfirmed',
      useMockRuntime: false,
      botPools: [{
        ...runConfig.botPools[0],
        profileId: networkProfile.profileId,
        minCount: 1,
        desiredCount: 1,
        maxCount: 1
      }],
      technicalTesting: {
        controlledNetworkTestConfirmed: false,
        saveMigrationTestPaths: [],
        approvedFileTestDirectories: []
      }
    };

    const validation = service.validateSessionConfig({
      runConfig: networkRunConfig,
      gameProfile,
      botProfiles: [networkProfile]
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors.map((error) => error.message).join(' ')).toContain(
      'Controlled network test confirmation is required'
    );
    expect(() => service.createSession({
      runConfig: networkRunConfig,
      gameProfile,
      botProfiles: [networkProfile]
    })).toThrow(/Controlled network test confirmation is required/);
  });

  it('exposes assigned directive state to the renderer bridge', () => {
    const directiveRunConfig: SimulationRunConfig = {
      ...runConfig,
      sessionId: 'session-with-directives',
      directives: [
        {
          directiveId: 'explore-forest',
          sessionId: 'session-with-directives',
          name: 'Explore the forest',
          description: 'Focus the explorer bots on paths through the forest.',
          directiveType: 'area',
          directiveMode: 'focus',
          priority: 'high',
          status: 'queued',
          target: {
            allBots: false,
            botIds: [],
            profileIds: ['explorer'],
            gameInstanceIds: []
          },
          actionKeywords: ['move', 'explore'],
          avoidedActionKeywords: ['idle'],
          targetArea: 'Forest',
          successConditions: ['A new forest path is visited.'],
          failureConditions: [],
          steps: [],
          repeatUntilSuccess: false,
          createdAt: '2026-07-04T08:59:00.000Z',
          createdBy: 'user'
        }
      ]
    };
    const service = new TestSimulationService({
      now: () => new Date('2026-07-04T09:00:00.000Z').toISOString(),
      systemSnapshot
    });

    service.createSession({ runConfig: directiveRunConfig, gameProfile, botProfiles });
    const state = service.getDirectiveState(directiveRunConfig.sessionId);

    expect(state.directives).toHaveLength(1);
    expect(state.progress.map((progress) => progress.botId)).toEqual([
      'explorer-001',
      'explorer-002'
    ]);
    expect(state.events.map((event) => event.eventType)).toEqual([
      'directive_created',
      'directive_queued',
      'directive_assigned',
      'directive_assigned'
    ]);
    expect(
      service
        .getLogs(directiveRunConfig.sessionId)
        .some((entry) => entry.message.includes('directive_assigned'))
    ).toBe(true);
  });

  it('runs a valid forced directive and returns the bot to profile planning after success', async () => {
    vi.useFakeTimers();
    let sessionId = 'session-forced-directive';
    const directiveRunConfig: SimulationRunConfig = {
      ...runConfig,
      sessionId,
      maxActionsPerBot: 2,
      botPools: [
        {
          ...runConfig.botPools[0],
          minCount: 1,
          desiredCount: 1,
          maxCount: 1
        }
      ],
      directives: [
        {
          directiveId: 'open-menu-now',
          sessionId,
          name: 'Open the menu once',
          description: 'Use the reported open-menu action before normal exploration.',
          directiveType: 'action',
          directiveMode: 'force-next-valid-action',
          priority: 'urgent',
          status: 'queued',
          target: {
            allBots: false,
            botIds: [],
            profileIds: ['explorer'],
            gameInstanceIds: []
          },
          actionKeywords: ['open-menu'],
          avoidedActionKeywords: [],
          successConditions: ['The open-menu action succeeds.'],
          failureConditions: [],
          steps: [],
          repeatUntilSuccess: false,
          createdAt: '2026-07-04T08:59:00.000Z',
          createdBy: 'user'
        }
      ]
    };
    const service = new TestSimulationService({
      now: () => new Date('2026-07-04T09:00:00.000Z').toISOString(),
      systemSnapshot
    });

    sessionId = service.createSession({ runConfig: directiveRunConfig, gameProfile, botProfiles }).sessionId;
    await service.startSession(sessionId);
    await vi.advanceTimersByTimeAsync(900);

    const directiveState = service.getDirectiveState(sessionId);
    const botLogs = service.getLogs(sessionId).map((entry) => entry.message);

    expect(directiveState.directives[0].status).toBe('succeeded');
    expect(directiveState.progress[0]).toMatchObject({
      status: 'succeeded',
      actionsAttempted: 1,
      lastAction: 'open-menu',
      successfulActions: 1,
      conditionsMet: ['The open-menu action succeeds.']
    });
    expect(directiveState.progress[0].screenshotPaths?.length).toBeGreaterThanOrEqual(2);
    expect(directiveState.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        'directive_activated',
        'directive_condition_checked',
        'directive_succeeded',
        'directive_evidence_captured'
      ])
    );
    expect(botLogs.some((message) => message.includes('user asked it to open the menu once'))).toBe(true);
    expect(botLogs.some((message) => message.includes('directive_succeeded'))).toBe(true);

    await service.stopSession(sessionId);
  });

  it('advances every guided directive step and records the completed result', async () => {
    vi.useFakeTimers();
    let sessionId = 'session-guided-directive';
    const guidedRunConfig: SimulationRunConfig = {
      ...runConfig,
      sessionId,
      actionDelayMs: 0,
      maxActionsPerBot: 3,
      botPools: [{
        ...runConfig.botPools[0],
        minCount: 1,
        desiredCount: 1,
        maxCount: 1
      }],
      directives: [{
        directiveId: 'menu-round-trip',
        sessionId,
        name: 'Open and close the menu',
        description: 'Follow both reported menu actions in order.',
        directiveType: 'sequence',
        directiveMode: 'guided-sequence',
        priority: 'high',
        status: 'queued',
        target: {
          allBots: false,
          botIds: [],
          profileIds: ['explorer'],
          gameInstanceIds: []
        },
        actionKeywords: [],
        avoidedActionKeywords: [],
        successConditions: ['Both menu actions succeed.'],
        failureConditions: [],
        steps: [
          {
            stepId: 'open',
            name: 'Open menu',
            actionType: 'open-menu',
            actionKeywords: ['open-menu'],
            successCondition: 'The menu action succeeds.',
            maxAttempts: 2,
            waitAfterMs: 0
          },
          {
            stepId: 'close',
            name: 'Close menu',
            actionType: 'close-menu',
            actionKeywords: ['close-menu'],
            successCondition: 'The close action succeeds.',
            maxAttempts: 2,
            waitAfterMs: 0
          }
        ],
        repeatUntilSuccess: false,
        createdAt: '2026-07-04T08:59:00.000Z',
        createdBy: 'user'
      }]
    };
    const service = new TestSimulationService({
      now: () => new Date('2026-07-04T09:00:00.000Z').toISOString(),
      systemSnapshot
    });

    sessionId = service.createSession({ runConfig: guidedRunConfig, gameProfile, botProfiles }).sessionId;
    await service.startSession(sessionId);
    await vi.advanceTimersByTimeAsync(900);

    const directiveState = service.getDirectiveState(sessionId);
    expect(directiveState.directives[0].status).toBe('succeeded');
    expect(directiveState.progress[0]).toMatchObject({
      status: 'succeeded',
      actionsAttempted: 2,
      successfulActions: 2,
      lastAction: 'close-menu'
    });
    expect(directiveState.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        'directive_step_started',
        'directive_step_completed',
        'directive_succeeded'
      ])
    );

    const report = await readFile(join(
      service.listSessions().find((session) => session.sessionId === sessionId)!.reportPaths.sessionDirectory,
      'session-summary.md'
    ), 'utf8');
    expect(report).toContain('Open and close the menu');
    expect(report).toContain('succeeded');

    await service.stopSession(sessionId);
  });

  it('guides a running bot without restarting its loop and validates exact available actions', async () => {
    vi.useFakeTimers();
    let sessionId = 'session-live-guidance';
    const liveRunConfig: SimulationRunConfig = {
      ...runConfig,
      sessionId,
      actionDelayMs: 1_000,
      maxActionsPerBot: 20,
      botPools: [
        {
          ...runConfig.botPools[0],
          minCount: 1,
          desiredCount: 1,
          maxCount: 1
        }
      ]
    };
    const service = new TestSimulationService({
      now: () => new Date('2026-07-04T09:00:00.000Z').toISOString(),
      systemSnapshot
    });
    const liveDirective = (
      directiveId: string,
      name: string,
      overrides: Partial<BotTestDirective> = {}
    ): BotTestDirective => ({
      directiveId,
      sessionId,
      name,
      description: `Guide the running bot to ${name.toLowerCase()}.`,
      directiveType: 'feature',
      directiveMode: 'focus',
      priority: 'normal',
      status: 'queued',
      target: {
        allBots: false,
        botIds: ['explorer-001'],
        profileIds: [],
        gameInstanceIds: []
      },
      actionKeywords: ['move-forward'],
      avoidedActionKeywords: [],
      targetFeature: 'movement',
      successConditions: ['Movement succeeds.'],
      failureConditions: [],
      steps: [],
      maxActions: 5,
      maxAttempts: 2,
      repeatUntilSuccess: false,
      createdAt: '2026-07-04T09:00:00.000Z',
      createdBy: 'user-live-session',
      ...overrides
    });

    sessionId = service.createSession({ runConfig: liveRunConfig, gameProfile, botProfiles }).sessionId;
    await service.startSession(sessionId);
    await vi.advanceTimersByTimeAsync(350);

    const actions = await service.getBotAvailableActions(sessionId, 'explorer-001');
    expect(actions.map((action) => action.actionType)).toContain('move-forward');

    const applied = await service.guideBot({
      sessionId,
      botId: 'explorer-001',
      behavior: 'apply',
      directive: liveDirective('movement-now', 'Test movement')
    });
    expect(applied.activeDirectiveId).toBe('movement-now');
    expect(service.getBotStatuses(sessionId)[0].status).toBe('running');

    const queued = await service.guideBot({
      sessionId,
      botId: 'explorer-001',
      behavior: 'queue',
      directive: liveDirective('inventory-later', 'Test inventory', {
        actionKeywords: ['equip-inventory-item'],
        targetFeature: 'inventory'
      })
    });
    expect(queued.snapshot.progress.find((progress) => progress.directiveId === 'inventory-later')).toMatchObject({
      botId: 'explorer-001',
      status: 'queued'
    });

    await service.guideBot({
      sessionId,
      botId: 'explorer-001',
      behavior: 'queue',
      directive: liveDirective('combat-later', 'Test combat', {
        actionKeywords: ['attack-enemy'],
        targetFeature: 'combat'
      })
    });
    const reordered = service.reorderBotDirectives({
      sessionId,
      botId: 'explorer-001',
      directiveIds: ['combat-later', 'inventory-later']
    });
    expect(
      reordered.snapshot.directives
        .filter((directive) => ['combat-later', 'inventory-later'].includes(directive.directiveId))
        .map((directive) => directive.directiveId)
    ).toEqual(['combat-later', 'inventory-later']);

    const replaced = await service.guideBot({
      sessionId,
      botId: 'explorer-001',
      behavior: 'replace',
      directive: liveDirective('menu-now', 'Test menu', {
        priority: 'urgent',
        actionKeywords: ['open-menu'],
        targetFeature: 'menu',
        manualSuccessConfirmation: true
      })
    });
    expect(replaced.activeDirectiveId).toBe('menu-now');
    expect(
      replaced.snapshot.progress.find((progress) => progress.directiveId === 'movement-now')?.status
    ).toBe('cancelled');

    const confirmed = service.confirmBotDirectiveSuccess(
      sessionId,
      'explorer-001',
      'menu-now'
    );
    expect(confirmed.activeDirectiveId).toBe('combat-later');
    expect(
      confirmed.snapshot.progress.find((progress) => progress.directiveId === 'menu-now')
    ).toMatchObject({
      status: 'succeeded',
      conditionsMet: ['Movement succeeds.']
    });
    expect(service.getBotStatuses(sessionId)[0].status).toBe('running');

    const unavailable = await service.guideBot({
      sessionId,
      botId: 'explorer-001',
      behavior: 'replace',
      directive: liveDirective('imaginary-action', 'Use imaginary action', {
        directiveType: 'action',
        directiveMode: 'force-next-valid-action',
        actionKeywords: ['not-reported-by-adapter'],
        targetFeature: undefined
      })
    });
    expect(unavailable.message).toMatch(/does not currently report/);
    expect(
      unavailable.snapshot.progress.find((progress) => progress.directiveId === 'imaginary-action')
    ).toMatchObject({ status: 'unavailable', actionsAttempted: 0 });
    expect(unavailable.activeDirectiveId).toBe('combat-later');

    await service.stopSession(sessionId);
  });

  it('launches and stops adapter-backed sessions through AdapterFactory by default', async () => {
    const adapter = new RecordingGameAdapter();
    const createAdapter = vi.fn((_adapterType: SimulationRunConfig['adapterType'], _options?: unknown) => adapter);
    const service = new TestSimulationService({
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

  it('completes shutdown and records an abnormal stop when adapter cleanup throws', async () => {
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-abnormal-shutdown-'));
    const adapter = new FailingStopAdapter();
    const service = new TestSimulationService({
      reportRoot,
      now: () => new Date('2026-07-29T10:00:00.000Z').toISOString(),
      systemSnapshot,
      adapterFactory: { createAdapter: () => adapter }
    });
    const sessionConfig: SimulationRunConfig = {
      ...runConfig,
      sessionId: 'session-abnormal-shutdown',
      useMockRuntime: false,
      actionDelayMs: 10,
      maxActionsPerBot: undefined
    };
    service.createSession({ runConfig: sessionConfig, gameProfile, botProfiles });
    await service.startSession(sessionConfig.sessionId);

    const snapshots = await service.shutdownAllSessions('test_app_shutdown');
    const metadata = service.listSessions().find((item) => item.sessionId === sessionConfig.sessionId);
    const saved = JSON.parse(await readFile(join(
      metadata!.reportPaths.sessionDirectory,
      'session.json'
    ), 'utf8')) as { status: string };

    expect(snapshots[0].status).toBe('failed');
    expect(metadata?.status).toBe('failed');
    expect(saved.status).toBe('failed');
    expect(service.getLogs(sessionConfig.sessionId).some((log) =>
      log.message.includes('Adapter shutdown failed')
    )).toBe(true);
  });

  it('shares simultaneous application shutdown calls', async () => {
    const service = new TestSimulationService({ systemSnapshot });
    const sessionConfig = {
      ...runConfig,
      sessionId: 'session-shared-application-shutdown'
    };
    service.createSession({ runConfig: sessionConfig, gameProfile, botProfiles });

    const first = service.shutdownAllSessions('simultaneous_quit');
    const second = service.shutdownAllSessions('ignored_second_reason');

    expect(second).toBe(first);
    const snapshots = await first;
    expect(snapshots[0]?.status).toBe('failed');
  });

  it('shares repeated Stop requests and reaches a terminal status', async () => {
    const adapter = new RecordingGameAdapter();
    const service = new TestSimulationService({
      systemSnapshot,
      adapterFactory: { createAdapter: () => adapter }
    });
    const sessionConfig = {
      ...runConfig,
      sessionId: 'session-repeated-stop',
      useMockRuntime: false,
      actionDelayMs: 10_000,
      maxActionsPerBot: undefined
    };
    service.createSession({ runConfig: sessionConfig, gameProfile, botProfiles });
    await service.startSession(sessionConfig.sessionId);

    const first = service.stopSession(sessionConfig.sessionId);
    const second = service.stopSession(sessionConfig.sessionId);

    expect(second).toBe(first);
    const stopped = await first;
    expect(stopped.status).toBe('stopped');
    expect(adapter.stoppedAll).toBe(true);

    const logCountAfterStop = service.getLogs(sessionConfig.sessionId).length;
    const repeatedAfterCompletion = await service.stopSession(sessionConfig.sessionId);

    expect(repeatedAfterCompletion.status).toBe('stopped');
    expect(service.getLogs(sessionConfig.sessionId)).toHaveLength(logCountAfterStop);
  });

  it('continues owned-resource cleanup when report finalization throws', async () => {
    const adapter = new RecordingGameAdapter();
    const service = new TestSimulationService({
      systemSnapshot,
      adapterFactory: { createAdapter: () => adapter }
    });
    const sessionConfig = {
      ...runConfig,
      sessionId: 'session-report-finalization-failure',
      useMockRuntime: false,
      actionDelayMs: 10_000,
      maxActionsPerBot: undefined
    };
    service.createSession({ runConfig: sessionConfig, gameProfile, botProfiles });
    await service.startSession(sessionConfig.sessionId);
    const reportSubject = service as unknown as {
      performStructuredReportWrite: (record: { status: string }) => void;
    };
    const originalReportWrite = reportSubject.performStructuredReportWrite.bind(service);
    reportSubject.performStructuredReportWrite = vi.fn((record) => {
      if (['stopped', 'failed'].includes(record.status)) {
        throw new Error('report disk write failed');
      }
      originalReportWrite(record);
    });

    const stopped = await service.stopSession(sessionConfig.sessionId);

    expect(adapter.stoppedAll).toBe(true);
    expect(stopped.status).toBe('failed');
    expect(service.getLogs(sessionConfig.sessionId).some((log) =>
      log.message.includes('finalize reports') && log.message.includes('report disk write failed')
    )).toBe(true);
  });

  it('bounds a hanging browser close and performs final cleanup only through the owned-resource hook', async () => {
    const adapter = new HangingBrowserCloseAdapter();
    const service = new TestSimulationService({
      systemSnapshot,
      shutdownStageTimeoutMs: 10,
      shutdownHardTimeoutMs: 200,
      adapterFactory: { createAdapter: () => adapter }
    });
    const sessionConfig = {
      ...runConfig,
      sessionId: 'session-hanging-browser-close',
      useMockRuntime: false,
      actionDelayMs: 10_000,
      maxActionsPerBot: undefined
    };
    service.createSession({ runConfig: sessionConfig, gameProfile, botProfiles });
    await service.startSession(sessionConfig.sessionId);

    const stopped = await service.stopSession(sessionConfig.sessionId);

    expect(stopped.status).toBe('failed');
    expect(adapter.forcedCleanup).toBe(true);
    expect(stopped.status).not.toBe('stopping');
  });

  it('switches the watched bot, focuses its assigned instance, and falls back when it stops', async () => {
    const adapter = new RecordingGameAdapter();
    const service = new TestSimulationService({
      now: () => new Date('2026-07-04T09:00:00.000Z').toISOString(),
      systemSnapshot,
      adapterFactory: { createAdapter: () => adapter }
    });
    const observationRunConfig: SimulationRunConfig = {
      ...runConfig,
      sessionId: 'session-live-observation',
      useMockRuntime: false,
      perGameInstanceBotLimit: 1,
      actionDelayMs: 10_000,
      maxActionsPerBot: undefined
    };

    service.createSession({
      runConfig: observationRunConfig,
      gameProfile,
      botProfiles,
      runtimeObservation: {
        showBotGameplay: true,
        observationMode: 'follow-first-bot',
        bringGameToFrontOnAction: false,
        visibleActionDelayMs: 250,
        showActionInformation: true,
        maxVisibleGameWindows: 1
      }
    });
    await service.startSession(observationRunConfig.sessionId);

    const bots = service.getBotStatuses(observationRunConfig.sessionId);
    const firstObservation = await service.getLiveObservationState(observationRunConfig.sessionId);
    const secondBot = bots[1];
    const followed = await service.followBot(observationRunConfig.sessionId, secondBot.botId);
    const focused = await service.focusObservedGameWindow(observationRunConfig.sessionId);

    expect(firstObservation.watchedBotId).toBe(bots[0].botId);
    expect(followed).toMatchObject({
      badge: 'Watching',
      watchedBotId: secondBot.botId,
      watchedGameInstanceId: secondBot.gameInstanceId
    });
    expect(adapter.observationTargets.at(-1)).toMatchObject({
      botId: secondBot.botId,
      instanceId: secondBot.gameInstanceId,
      observationMode: 'follow-selected-bot'
    });
    expect(focused.windowStatus).toBe(`Focused ${secondBot.gameInstanceId}.`);
    expect(adapter.focusedInstances).toEqual([secondBot.gameInstanceId]);

    service.stopBot(observationRunConfig.sessionId, secondBot.botId);
    const switched = await service.getLiveObservationState(observationRunConfig.sessionId);

    expect(switched.watchedBotId).toBe(bots[0].botId);
    expect(switched.message).toContain(`Watched bot ${secondBot.botId} stopped`);
    expect(service.getLogs(observationRunConfig.sessionId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('observation_bot_changed:') })
      ])
    );

    await service.stopSession(observationRunConfig.sessionId);
  });

  it('completes a startup flow before running the normal bot pool', async () => {
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-startup-success-'));
    const adapter = new StartupFlowGameAdapter();
    const sessionConfig = startupFlowRunConfig('session-startup-success');
    const service = new TestSimulationService({
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
    const service = new TestSimulationService({
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
    const service = new TestSimulationService({
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
    const service = new TestSimulationService({
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
    expect(result.observationCapability).toBe('visible-window');
    expect(result.observationMessage).toContain('browser adapter can open a visible game window');
    expect(result.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'State read', supported: true }),
        expect.objectContaining({ label: 'Keyboard/mouse input', supported: true }),
        expect.objectContaining({ label: 'Live observation', supported: true }),
        expect.objectContaining({ label: 'Window focus', supported: true })
      ])
    );
    expect(adapter.launchConfigs).toHaveLength(1);
    expect(adapter.launchConfigs[0].environment.GAMEPLAY_SIMULATOR_PROFILE_TEST).toBe('1');
    expect(adapter.stoppedAll).toBe(true);
  });

  it('passes a headed observation config to a visible browser profile test', async () => {
    vi.useFakeTimers();
    const adapter = new RecordingGameAdapter();
    const createAdapter = vi.fn(
      (_adapterType: SimulationRunConfig['adapterType'], _options?: unknown) => adapter
    );
    const service = new TestSimulationService({
      now: () => new Date('2026-07-04T09:00:00.000Z').toISOString(),
      systemSnapshot,
      adapterFactory: { createAdapter }
    });

    const resultPromise = service.testGameProfile({ gameProfile, showTestWindow: true });
    await vi.advanceTimersByTimeAsync(1_500);
    const result = await resultPromise;
    const adapterOptions = createAdapter.mock.calls[0]?.[1] as {
      browser?: { headless?: boolean; runtimeObservation?: { showBotGameplay?: boolean } };
    };

    expect(result.ok).toBe(true);
    expect(result.stopped).toBe(true);
    expect(adapterOptions.browser).toMatchObject({
      headless: false,
      runtimeObservation: { showBotGameplay: true }
    });
  });

  it('rejects invalid desktop adapter profiles before session startup', () => {
    const createAdapter = vi.fn((_adapterType: SimulationRunConfig['adapterType'], _options?: unknown) => new RecordingGameAdapter());
    const service = new TestSimulationService({
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
    const service = new TestSimulationService({
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
    const service = new TestSimulationService({
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

  it('resolves global observation defaults into config, metadata, and the readable report', async () => {
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-observation-'));
    const observationRunConfig: SimulationRunConfig = {
      ...runConfig,
      sessionId: 'session-observation-persisted'
    };
    const service = new TestSimulationService({ reportRoot, systemSnapshot });

    service.createSession({
      runConfig: observationRunConfig,
      gameProfile,
      botProfiles,
      runtimeObservation: {
        showBotGameplay: true,
        observationMode: 'show-all-instances',
        bringGameToFrontOnAction: false,
        visibleActionDelayMs: 700,
        showActionInformation: true,
        maxVisibleGameWindows: 2
      }
    });

    const report = await service.openReport(observationRunConfig.sessionId);
    const sessionDirectory = dirname(report.reportPath);
    const configArtifact = JSON.parse(await readFile(join(sessionDirectory, 'config.json'), 'utf8')) as {
      runConfig: SimulationRunConfig;
    };
    const metadata = service.listSessions().find(
      (session) => session.sessionId === observationRunConfig.sessionId
    );
    const reportContents = await readFile(report.reportPath, 'utf8');

    expect(configArtifact.runConfig).toMatchObject({
      showBotGameplay: true,
      observationMode: 'show-all-instances',
      visibleActionDelayMs: 700,
      maxVisibleGameWindows: 2
    });
    expect(metadata?.runtimeObservation).toMatchObject({
      showBotGameplay: true,
      observationMode: 'show-all-instances',
      maxVisibleGameWindows: 2
    });
    expect(reportContents).toContain('## Live Observation');
    expect(reportContents).toContain('Observation mode: show-all-instances');
  });

  it('writes and opens structured JSONL logs', async () => {
    vi.useFakeTimers();
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-logs-'));
    const openedPaths: string[] = [];
    const service = new TestSimulationService({
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
    const service = new TestSimulationService({
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

  it('rejects video capture because no production adapter implements it', async () => {
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-video-'));
    const service = new TestSimulationService({
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
      saveVideo: true,
      useMockRuntime: false
    };

    const validation = service.validateSessionConfig({
        runConfig: videoRunConfig,
        gameProfile: videoProfile,
        botProfiles: boundaryBotProfiles
      });

    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'saveVideo',
          message: expect.stringContaining('Video recording is unavailable')
        })
      ])
    );
  });

  it('generates a build comparison report between sessions', async () => {
    vi.useFakeTimers();
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-comparison-'));
    const openedPaths: string[] = [];
    let nowOffsetSeconds = 0;
    const service = new TestSimulationService({
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
    const service = new TestSimulationService({
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

    const restartedService = new TestSimulationService({
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

  it('keeps persisted sessions read-only when listed or addressed by runtime controls', async () => {
    vi.useFakeTimers();
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-read-only-session-'));
    let sessionId = 'session-persisted-read-only';
    const service = new TestSimulationService({
      reportRoot,
      now: () => new Date('2026-07-04T12:00:00.000Z').toISOString(),
      systemSnapshot
    });

    sessionId = service.createSession({
      runConfig: { ...boundaryRunConfig, sessionId },
      gameProfile,
      botProfiles: boundaryBotProfiles
    }).sessionId;
    await service.startSession(sessionId);
    await vi.advanceTimersByTimeAsync(1500);
    await service.stopSession(sessionId);

    const sessionDirectory = service.listSessions().find(
      (session) => session.sessionId === sessionId
    )!.reportPaths.sessionDirectory;
    const metadataPath = join(sessionDirectory, 'session.json');
    const statusBefore = service.getSessionStatus(sessionId).status;
    const metadataBefore = await readFile(metadataPath, 'utf8');
    const modifiedBefore = (await stat(metadataPath)).mtimeMs;
    const restartedService = new TestSimulationService({
      reportRoot,
      now: () => new Date('2026-07-04T13:00:00.000Z').toISOString(),
      systemSnapshot
    });

    restartedService.listSessions();
    await restartedService.getStructuredLogs(sessionId);
    await restartedService.shutdownAllSessions();
    expect(await readFile(metadataPath, 'utf8')).toBe(metadataBefore);
    expect((await stat(metadataPath)).mtimeMs).toBe(modifiedBefore);
    await expect(restartedService.startSession(sessionId)).rejects.toThrow('read-only');
    await expect(restartedService.stopSession(sessionId)).rejects.toThrow('read-only');
    expect(() => restartedService.pauseSession(sessionId)).toThrow('read-only');
    expect(() => restartedService.resumeSession(sessionId)).toThrow('read-only');
    expect(restartedService.getSessionStatus(sessionId).status).toBe(statusBefore);
  });

  it('stores the exact used custom bot profile in the session config artifact', async () => {
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-custom-profile-artifact-'));
    const customProfile: BotProfile = {
      ...botProfiles[0],
      profileId: 'custom-inventory-reviewer',
      displayName: 'Custom Inventory Reviewer',
      botType: 'custom-inventory-reviewer',
      preferredActions: ['open-inventory'],
      avoidedActions: ['close-inventory']
    };
    let sessionId = 'session-custom-profile-artifact';
    const service = new TestSimulationService({
      reportRoot,
      now: () => new Date('2026-07-04T14:00:00.000Z').toISOString(),
      systemSnapshot
    });

    sessionId = service.createSession({
      runConfig: {
        ...runConfig,
        sessionId,
        botPools: [{
          ...runConfig.botPools[0],
          profileId: customProfile.profileId,
          minCount: 1,
          desiredCount: 1
        }]
      },
      gameProfile,
      botProfiles: [customProfile, ...boundaryBotProfiles]
    }).sessionId;

    const sessionDirectory = service.listSessions().find(
      (session) => session.sessionId === sessionId
    )!.reportPaths.sessionDirectory;
    const artifact = JSON.parse(
      await readFile(join(sessionDirectory, 'config.json'), 'utf8')
    ) as { botProfiles: BotProfile[] };
    expect(artifact.botProfiles).toEqual([
      expect.objectContaining({
        profileId: customProfile.profileId,
        preferredActions: ['open-inventory']
      })
    ]);

    const restartedService = new TestSimulationService({ reportRoot, systemSnapshot });
    expect(restartedService.getBotStatuses(sessionId)[0]).toMatchObject({
      profileId: customProfile.profileId
    });
    expect(restartedService.getBotStatuses(sessionId)[0].displayName).toContain(
      customProfile.displayName
    );
  });

  it('previews and exports GitHub issue markdown without a token', async () => {
    vi.useFakeTimers();
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-github-export-'));
    const openedPaths: string[] = [];
    const service = new TestSimulationService({
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
    const service = new TestSimulationService({
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
    const service = new TestSimulationService({
      reportRoot,
      now: () => new Date('2026-07-04T09:00:00.000Z').toISOString(),
      systemSnapshot
    });
    const interruptedRunConfig: SimulationRunConfig = {
      ...runConfig,
      sessionId: 'session-interrupted',
      runUntilStopped: true,
      stopOnCriticalIssue: false,
      maxActionsPerBot: undefined
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

    expect(snapshots.find((snapshot) => snapshot.sessionId === interruptedRunConfig.sessionId)?.status).toBe('failed');
    expect(service.getBotStatuses(interruptedRunConfig.sessionId).every((bot) => bot.status === 'stopped')).toBe(true);
    expect((await service.getInstanceStatuses(interruptedRunConfig.sessionId)).every((instance) => instance.status === 'stopped')).toBe(true);
    expect(sessionEvents.some((event) => event.eventType === 'manual_stop')).toBe(true);
    expect(sessionEvents.some((event) => event.eventType === 'session_stop')).toBe(true);
    expect(summary).toContain('GameplaySimulator Session');
    expect(summary).toContain('session-interrupted');
    expect(summary).toContain('Shutdown reason: test_shutdown');
  });

  it('does not open evidence outside the selected session directory', async () => {
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-evidence-boundary-'));
    const openedPaths: string[] = [];
    const service = new TestSimulationService({
      reportRoot,
      systemSnapshot,
      openPath: async (path) => {
        openedPaths.push(path);
        return '';
      }
    });
    const sessionRunConfig: SimulationRunConfig = {
      ...runConfig,
      sessionId: 'session-evidence-boundary'
    };
    const created = service.createSession({
      runConfig: sessionRunConfig,
      gameProfile,
      botProfiles
    });
    const sessionDirectory = service.listSessions()
      .find((session) => session.sessionId === created.sessionId)!
      .reportPaths.sessionDirectory;
    const siblingPath = join(dirname(sessionDirectory), `${basename(sessionDirectory)}-copy`, 'issue.png');

    const result = await service.openEvidence(created.sessionId, siblingPath);

    expect(result.opened).toBe(false);
    expect(result.message).toContain('not part of this session');
    expect(openedPaths).toEqual([]);
  });

  it('opens only existing evidence files, not session directories', async () => {
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-evidence-file-'));
    const openedPaths: string[] = [];
    const service = new TestSimulationService({
      reportRoot,
      systemSnapshot,
      openPath: async (path) => {
        openedPaths.push(path);
        return '';
      }
    });
    const created = service.createSession({
      runConfig: {
        ...runConfig,
        sessionId: 'session-evidence-file'
      },
      gameProfile,
      botProfiles
    });
    const sessionDirectory = service.listSessions()
      .find((session) => session.sessionId === created.sessionId)!
      .reportPaths.sessionDirectory;

    const directoryResult = await service.openEvidence(created.sessionId, sessionDirectory);
    const missingResult = await service.openEvidence(
      created.sessionId,
      join(sessionDirectory, 'screenshots', 'missing.png')
    );

    expect(directoryResult.opened).toBe(false);
    expect(missingResult.opened).toBe(false);
    expect(openedPaths).toEqual([]);
  });

  it('loads structured logs in bounded pages and reports corrupt JSONL lines', async () => {
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-log-pages-'));
    const service = new TestSimulationService({ reportRoot, systemSnapshot });
    const created = service.createSession({
      runConfig: {
        ...runConfig,
        sessionId: 'session-log-pages'
      },
      gameProfile,
      botProfiles
    });
    const metadata = service.listSessions().find((session) => session.sessionId === created.sessionId)!;
    const logPath = metadata.reportPaths.fullStructuredLogs!;
    const generated = Array.from({ length: 620 }, (_, index) => JSON.stringify({
      bundleSource: 'session',
      eventId: `generated-${index}`,
      eventType: 'resource_warning',
      sessionId: created.sessionId,
      timestamp: new Date(index).toISOString(),
      payload: { index }
    })).join('\n');
    await appendFile(logPath, `${generated}\n{broken-json\n`, 'utf8');

    const latest = await service.getStructuredLogs(created.sessionId, { limit: 100 });
    const older = await service.getStructuredLogs(created.sessionId, {
      before: latest.nextCursor,
      limit: 100
    });

    expect(latest.logs).toHaveLength(100);
    expect(latest.totalValidRecords).toBeGreaterThanOrEqual(620);
    expect(latest.corruptLineCount).toBe(1);
    expect(latest.incomplete).toBe(true);
    expect(latest.nextCursor).toBeDefined();
    expect(older.logs).toHaveLength(100);
    expect(older.logs.at(-1)?.raw.eventId).not.toBe(latest.logs[0]?.raw.eventId);
  });
});
