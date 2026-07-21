import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { BotProfile, GameProfile, SimulationRunConfig } from '@core/types';
import type { SystemResourceSnapshot } from '@core/resources/ResourceManager';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startInstrumentedTestServer } from '../../../../../examples/instrumented-test-server/src/server';
import { AdapterFactory } from '../../../../../packages/adapters/src';
import { SimulationService } from './simulationService';

const systemSnapshot: SystemResourceSnapshot = {
  cpuCoreCount: 8,
  totalRamMb: 32000,
  freeRamMb: 24000,
  currentCpuLoadPercent: 8,
  currentRamUsagePercent: 20,
  platform: 'linux',
  osRelease: 'integration-test'
};

const botProfiles: BotProfile[] = [
  {
    profileId: 'explorer',
    displayName: 'Explorer Bot',
    botType: 'explorer',
    playstyle: 'explorer',
    goals: [],
    preferredActions: ['move-forward', 'enter-hidden-area', 'open-menu', 'close-menu'],
    avoidedActions: ['trigger-crash', 'trigger-stuck'],
    recommendedMinCount: 1,
    recommendedMaxCount: 1,
    defaultResourceWeight: 'light',
    curiosity: 0.9,
    riskTolerance: 0.2,
    repetitionTolerance: 0.3,
    bugHuntingBias: 0.4,
    tags: [],
    config: {}
  }
];

function knownContent(): GameProfile['knownContent'] {
  return {
    scenes: ['Start Area', 'Hidden Grotto'],
    levels: ['Integration Level'],
    locations: [],
    characters: [],
    npcs: [],
    items: ['health-potion'],
    quests: ['qa-intro'],
    mainQuests: [],
    sideQuests: [],
    optionalStories: [],
    shops: [],
    bosses: [],
    menus: ['pause-menu'],
    dialogueBranches: [],
    minigames: [],
    endings: [],
    hiddenAreas: ['Hidden Grotto'],
    postGameContent: [],
    collectibles: [],
    achievements: [],
    mechanics: [],
    notes: []
  };
}

function instrumentedProfile(endpoint: string): GameProfile {
  return {
    gameId: 'fake-instrumented-game',
    gameName: 'Fake Instrumented Game',
    version: '1.0.0',
    buildId: 'integration-build',
    engine: {
      type: 'custom',
      version: 'example-server'
    },
    launch: {
      platform: 'linux',
      arguments: []
    },
    adapter: {
      type: 'instrumented',
      supportsMultipleInstances: true,
      supportsStateRead: true,
      supportsDirectActions: true,
      supportsScreenshots: true,
      supportsVideo: false,
      supportsSaveIsolation: true,
      instrumentationEndpoint: endpoint,
      instrumentationTransport: 'local-http'
    },
    controls: [],
    testingTargets: [],
    progressSignals: [],
    failureSignals: [],
    uiFlows: [],
    knownContent: knownContent()
  };
}

function runConfig(sessionId: string): SimulationRunConfig {
  return {
    sessionId,
    gameProfilePath: 'memory://game-profiles/fake-instrumented-game',
    adapterType: 'instrumented',
    runMode: 'parallel',
    runUntilStopped: false,
    maxRuntimeMinutes: 1,
    stopOnCriticalIssue: false,
    saveScreenshots: false,
    saveVideo: false,
    saveActionTimeline: true,
    saveStateSnapshots: true,
    useMockRuntime: false,
    botPools: [
      {
        profileId: 'explorer',
        enabled: true,
        minCount: 1,
        desiredCount: 1,
        maxCount: 1,
        scalingMode: 'fixed',
        priority: 10,
        resourceWeight: 'light'
      }
    ],
    globalBotLimit: 1,
    perGameInstanceBotLimit: 1,
    actionDelayMs: 1,
    maxActionsPerBot: 2,
    resourceLimits: {
      maxCpuPercent: 90,
      maxRamPercent: 90,
      reserveRamMb: 256,
      maxGameInstances: 1,
      allowAutoScaling: true
    }
  };
}

function parseJsonl(contents: string): Array<Record<string, unknown>> {
  return contents
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }

  throw new Error('Timed out waiting for integration condition.');
}

describe('SimulationService real adapter integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs bots through a real InstrumentedAdapter, mutates server state, and writes logs', async () => {
    const reportRoot = await mkdtemp(join(tmpdir(), 'gameplay-simulator-real-adapter-'));
    const server = await startInstrumentedTestServer({ port: 0, sessionId: 'session-real-instrumented' });
    const createAdapterSpy = vi.spyOn(AdapterFactory.prototype, 'createAdapter');
    const service = new SimulationService({
      reportRoot,
      systemSnapshot,
      now: () => new Date().toISOString()
    });
    const config = runConfig('session-real-instrumented');
    const profile = instrumentedProfile(server.endpoint);

    try {
      const validation = service.validateSessionConfig({ runConfig: config, gameProfile: profile, botProfiles });
      const created = service.createSession({ runConfig: config, gameProfile: profile, botProfiles });
      const started = await service.startSession(config.sessionId);

      expect(validation.valid).toBe(true);
      expect(created.status.status).toBe('created');
      expect(started.status).toBe('running');
      expect(createAdapterSpy).toHaveBeenCalledWith(
        'instrumented',
        expect.objectContaining({
          instrumented: expect.objectContaining({
            instrumentationEndpoint: server.endpoint,
            instrumentationTransport: 'local-http'
          })
        })
      );

      await waitFor(() => service.getSessionStatus(config.sessionId).status === 'stopped');

      const fakeState = server.getState('game-instance-001');
      const logsResult = await service.openLogs(config.sessionId);
      const sessionEvents = parseJsonl(await readFile(logsResult.logsPath, 'utf8'));
      const botDirectory = join(dirname(logsResult.logsPath), 'bots', 'explorer-001');
      const actions = parseJsonl(await readFile(join(botDirectory, 'actions.jsonl'), 'utf8'));
      const states = parseJsonl(await readFile(join(botDirectory, 'states.jsonl'), 'utf8'));
      const eventTypes = sessionEvents.map((event) => event.eventType);
      const instanceStartIndex = eventTypes.indexOf('instance_start');
      const botStartIndex = eventTypes.indexOf('bot_start');

      expect(fakeState.tick).toBeGreaterThan(0);
      expect(fakeState.logs.some((line) => line.includes('Action'))).toBe(true);
      expect(service.getLogs(config.sessionId).some((log) => log.message.includes('Mock'))).toBe(false);
      expect(service.getBotStatuses(config.sessionId)[0]).toEqual(
        expect.objectContaining({
          botId: 'explorer-001',
          status: 'completed'
        })
      );
      expect(actions.length).toBeGreaterThan(0);
      expect(states.length).toBeGreaterThan(0);
      expect(instanceStartIndex).toBeGreaterThanOrEqual(0);
      expect(botStartIndex).toBeGreaterThan(instanceStartIndex);
      expect(existsSync(join(dirname(logsResult.logsPath), 'config.json'))).toBe(true);
    } finally {
      await service.shutdownAllSessions('integration_test_cleanup').catch(() => []);
      await server.stop();
    }
  });
});
