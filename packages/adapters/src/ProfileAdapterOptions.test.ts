import type { GameProfile, SimulationRunConfig } from '@core/types';
import { describe, expect, it } from 'vitest';
import { createAdapterOptionsFromGameProfile } from './ProfileAdapterOptions';

const runConfig: SimulationRunConfig = {
  sessionId: 'session-options',
  gameProfilePath: 'memory://game-profiles/test-game',
  adapterType: 'unity',
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
      desiredCount: 1,
      maxCount: 2,
      scalingMode: 'auto',
      priority: 10,
      resourceWeight: 'medium'
    }
  ],
  globalBotLimit: 2,
  perGameInstanceBotLimit: 1,
  actionDelayMs: 100,
  resourceLimits: {
    maxCpuPercent: 80,
    maxRamPercent: 80,
    reserveRamMb: 1024,
    maxGameInstances: 1,
    allowAutoScaling: true
  }
};

const unityProfile: GameProfile = {
  gameId: 'test-game',
  gameName: 'Test Game',
  version: '1.0.0',
  engine: { type: 'unity', version: '2022.3' },
  launch: {
    platform: 'windows',
    executablePath: '/games/TestGame.exe',
    workingDirectory: '/games',
    arguments: ['--qa'],
    url: undefined
  },
  adapter: {
    type: 'unity',
    supportsMultipleInstances: true,
    supportsStateRead: true,
    supportsDirectActions: true,
    supportsScreenshots: true,
    supportsVideo: false,
    supportsSaveIsolation: true,
    instrumentationEndpoint: 'http://127.0.0.1:4555',
    instrumentationTransport: 'local-http'
  },
  controls: [
    {
      controlId: 'jump',
      label: 'Jump',
      inputType: 'keyboard',
      binding: 'Space',
      action: 'jump',
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

describe('createAdapterOptionsFromGameProfile', () => {
  it('uses instrumented mode for engine adapters when an endpoint is configured', () => {
    const result = createAdapterOptionsFromGameProfile(unityProfile, runConfig);

    expect(result.runtimeMode).toBe('engine-instrumented');
    expect(result.options.instrumented).toMatchObject({
      instrumentationEndpoint: 'http://127.0.0.1:4555',
      instrumentationTransport: 'local-http'
    });
    expect(result.options.unity).toMatchObject({
      unityVersion: '2022.3',
      instrumentationEndpoint: 'http://127.0.0.1:4555'
    });
    expect(result.errors).toHaveLength(0);
  });

  it('uses desktop fallback for engine adapters without instrumentation and validates controls', () => {
    const profile: GameProfile = {
      ...unityProfile,
      adapter: {
        ...unityProfile.adapter,
        instrumentationEndpoint: undefined,
        supportsStateRead: false,
        supportsDirectActions: false
      },
      controls: []
    };
    const result = createAdapterOptionsFromGameProfile(profile, runConfig);

    expect(result.runtimeMode).toBe('engine-desktop-fallback');
    expect(result.options.desktop).toMatchObject({
      executablePath: '/games/TestGame.exe',
      workingDirectory: '/games',
      launchArguments: ['--qa']
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'controls',
          message: expect.stringContaining('Desktop fallback needs control mappings')
        })
      ])
    );
  });

  it('warns when evidence is requested but unsupported by the selected profile', () => {
    const profile: GameProfile = {
      ...unityProfile,
      adapter: {
        ...unityProfile.adapter,
        supportsScreenshots: false,
        supportsVideo: false
      }
    };
    const result = createAdapterOptionsFromGameProfile(profile, {
      ...runConfig,
      saveScreenshots: true,
      saveVideo: true
    });

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'adapter.supportsScreenshots' }),
        expect.objectContaining({ path: 'adapter.supportsVideo' })
      ])
    );
  });

  it('validates save isolation adapter settings', () => {
    const missingTemplate = createAdapterOptionsFromGameProfile(
      {
        ...unityProfile,
        saveIsolation: {
          mode: 'launch-argument-profile',
          cleanupTempSaves: false,
          preserveBotSaves: true
        }
      },
      runConfig
    );
    const missingEnvironmentVariable = createAdapterOptionsFromGameProfile(
      {
        ...unityProfile,
        saveIsolation: {
          mode: 'environment-variable',
          cleanupTempSaves: false,
          preserveBotSaves: true
        }
      },
      runConfig
    );
    const copyWithoutSource = createAdapterOptionsFromGameProfile(
      {
        ...unityProfile,
        saveIsolation: {
          mode: 'copy-directory',
          cleanupTempSaves: false,
          preserveBotSaves: true
        }
      },
      runConfig
    );

    expect(missingTemplate.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'saveIsolation.profileArgumentTemplate' })
      ])
    );
    expect(missingEnvironmentVariable.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'saveIsolation.environmentVariableName' })
      ])
    );
    expect(copyWithoutSource.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'saveIsolation.sourceSavePath' })
      ])
    );
  });

  it('passes the browser DOM scan policy from the game profile to BrowserAdapter', () => {
    const profile: GameProfile = {
      ...unityProfile,
      engine: { type: 'browser' },
      launch: {
        platform: 'browser',
        url: 'http://localhost:5173',
        arguments: []
      },
      adapter: {
        ...unityProfile.adapter,
        type: 'browser',
        instrumentationEndpoint: undefined,
        browserName: 'chromium',
        browserDomScanMode: 'always'
      }
    };
    const result = createAdapterOptionsFromGameProfile(profile, {
      ...runConfig,
      adapterType: 'browser'
    });

    expect(result.runtimeMode).toBe('browser');
    expect(result.browserDomScanMode).toBe('always');
    expect(result.options.browser).toMatchObject({
      targetUrl: 'http://localhost:5173',
      browserName: 'chromium',
      domScanMode: 'always'
    });
  });
});
