import { readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BotProfile, GameProfile, SimulationRunConfig } from '@core/types';
import type { SystemResourceSnapshot } from '@core/resources/ResourceManager';
import { DesktopAdapterDependencyChecker } from '../../../../../packages/adapters/src';
import { describe, expect, it } from 'vitest';
import { SimulationService } from './simulationService';

const systemSnapshot: SystemResourceSnapshot = {
  cpuCoreCount: 8,
  totalRamMb: 32_000,
  freeRamMb: 24_000,
  currentCpuLoadPercent: 5,
  currentRamUsagePercent: 20,
  platform: 'linux',
  osRelease: 'test'
};

const botProfile: BotProfile = {
  profileId: 'desktop-ui-tester',
  displayName: 'Desktop UI Tester',
  botType: 'ui_tester',
  playstyle: 'ui_tester',
  goals: [],
  preferredActions: ['open-menu'],
  avoidedActions: [],
  recommendedMinCount: 1,
  recommendedMaxCount: 1,
  defaultResourceWeight: 'light',
  curiosity: 0.5,
  riskTolerance: 0.2,
  repetitionTolerance: 0.5,
  bugHuntingBias: 0.8,
  tags: [],
  config: {}
};

function profile(inputType: 'keyboard' | 'custom'): GameProfile {
  return {
    gameId: 'desktop-preflight-game',
    gameName: 'Desktop Preflight Game',
    version: '1.0.0',
    engine: { type: 'custom' },
    launch: {
      executablePath: process.execPath,
      arguments: ['-e', 'setInterval(() => {}, 1000)'],
      platform: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux'
    },
    adapter: {
      type: 'desktop',
      supportsMultipleInstances: false,
      supportsStateRead: false,
      supportsDirectActions: false,
      supportsScreenshots: true,
      supportsVideo: false,
      supportsSaveIsolation: false
    },
    controls: [
      {
        controlId: 'open-menu',
        label: 'Open Menu',
        inputType,
        binding: inputType === 'keyboard' ? 'Escape' : 'test-control',
        action: 'open-menu',
        metadata: {}
      }
    ],
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
  };
}

function runConfig(overrides: Partial<SimulationRunConfig> = {}): SimulationRunConfig {
  return {
    sessionId: 'desktop-preflight-request',
    gameProfilePath: 'memory://game-profiles/desktop-preflight-game',
    adapterType: 'desktop',
    runMode: 'sequential',
    runUntilStopped: false,
    maxRuntimeMinutes: 1,
    stopOnCriticalIssue: true,
    saveScreenshots: true,
    saveVideo: false,
    saveActionTimeline: true,
    saveStateSnapshots: false,
    botPools: [
      {
        profileId: botProfile.profileId,
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
    actionDelayMs: 10,
    maxActionsPerBot: 1,
    resourceLimits: {
      maxCpuPercent: 90,
      maxRamPercent: 90,
      reserveRamMb: 128,
      maxGameInstances: 1,
      allowAutoScaling: false
    },
    ...overrides
  };
}

async function createService(commands: string[]): Promise<{ service: SimulationService; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'gameplay-simulator-desktop-preflight-'));
  const available = new Set(commands);
  return {
    root,
    service: new SimulationService({
      reportRoot: root,
      systemSnapshot,
      desktopDependencyChecker: new DesktopAdapterDependencyChecker({
        platform: 'linux',
        commandExists: async (command) => available.has(command)
      })
    })
  };
}

describe('desktop session dependency preflight', () => {
  it('blocks bots that require a missing desktop input dependency with installation guidance', async () => {
    const { service } = await createService([]);
    const payload = {
      runConfig: runConfig(),
      gameProfile: profile('keyboard'),
      botProfiles: [botProfile]
    };

    const validation = await service.validateSessionConfigWithDependencies(payload);

    expect(validation.valid).toBe(false);
    expect(validation.errors[0]?.message).toMatch(/Install xdotool to enable Linux desktop input/);
    await expect(service.createSessionWithPreflight(payload)).rejects.toThrow(
      /Install xdotool to enable Linux desktop input/
    );
  });

  it('enforces the same input dependency gate when session creation bypasses renderer preflight', async () => {
    const { service } = await createService([]);
    const created = service.createSession({
      runConfig: runConfig({ saveScreenshots: false }),
      gameProfile: profile('keyboard'),
      botProfiles: [botProfile]
    });

    const started = await service.startSession(created.sessionId);

    expect(started.status).toBe('failed');
    expect(
      service.getLogs(created.sessionId).some((log) =>
        log.message.includes('Install xdotool to enable Linux desktop input')
      )
    ).toBe(true);
  });

  it('disables optional screenshots before launch when only unapproved full-desktop capture exists', async () => {
    const { service, root } = await createService(['scrot']);
    const created = await service.createSessionWithPreflight({
      runConfig: runConfig(),
      gameProfile: profile('custom'),
      botProfiles: [botProfile]
    });
    const artifact = JSON.parse(
      await readFile(join(root, `session-${created.sessionId}`, 'config.json'), 'utf8')
    ) as { runConfig: SimulationRunConfig };

    expect(artifact.runConfig.saveScreenshots).toBe(false);
    expect(created.logs.some((log) => log.message.includes('privacy consent'))).toBe(true);
  });

  it('blocks required screenshots when the only capture scope lacks privacy consent', async () => {
    const { service } = await createService(['scrot']);

    await expect(service.createSessionWithPreflight({
      runConfig: runConfig({ requireScreenshotEvidence: true }),
      gameProfile: profile('custom'),
      botProfiles: [botProfile]
    })).rejects.toThrow(/Required screenshot evidence is unavailable/);
  });

  it('retains screenshot capture only after explicit full-desktop consent', async () => {
    const { service, root } = await createService(['scrot']);
    const created = await service.createSessionWithPreflight({
      runConfig: runConfig({ allowFullDesktopCapture: true }),
      gameProfile: profile('custom'),
      botProfiles: [botProfile]
    });
    const artifact = JSON.parse(
      await readFile(join(root, `session-${created.sessionId}`, 'config.json'), 'utf8')
    ) as { runConfig: SimulationRunConfig };

    expect(artifact.runConfig.saveScreenshots).toBe(true);
    expect(artifact.runConfig.allowFullDesktopCapture).toBe(true);
    expect(created.logs.some((log) => log.message.includes('Privacy warning'))).toBe(true);
  });
});
