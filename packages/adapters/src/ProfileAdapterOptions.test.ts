import type { GameProfile, SimulationRunConfig } from '@core/types';
import { join, resolve } from 'node:path';
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
      instrumentationEndpoint: 'http://127.0.0.1:4555',
      instrumentedOptions: {
        observationCapability: 'external-window',
        capabilities: {
          supportsLiveObservation: true,
          supportsWindowFocus: true
        }
      }
    });
    expect(result.options.unity?.instrumentedOptions?.windowFocusHandler).toBeTypeOf('function');
    expect(result.observationMessage).toContain('external game window');
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
    expect(result.options.unity?.desktopOptions?.runtimeObservation).toBeDefined();
    expect(result.observationCapability).toBe('visible-window');
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'controls',
          message: expect.stringContaining('Desktop fallback needs control mappings')
        })
      ])
    );
  });

  it('passes desktop screenshot consent and evidence requirements to the adapter', () => {
    const profile: GameProfile = {
      ...unityProfile,
      adapter: {
        ...unityProfile.adapter,
        instrumentationEndpoint: undefined,
        supportsStateRead: false,
        supportsDirectActions: false
      }
    };
    const result = createAdapterOptionsFromGameProfile(profile, {
      ...runConfig,
      requireScreenshotEvidence: true,
      allowFullDesktopCapture: true
    });

    expect(result.options.desktop).toMatchObject({
      requireScreenshotEvidence: true,
      allowFullDesktopCapture: true
    });
    expect(result.options.unity?.desktopOptions).toMatchObject({
      requireScreenshotEvidence: true,
      allowFullDesktopCapture: true
    });
  });

  it('warns for unavailable screenshots and rejects unavailable video capture', () => {
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
        expect.objectContaining({ path: 'adapter.supportsScreenshots' })
      ])
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'saveVideo',
          message: expect.stringContaining('Video recording is unavailable')
        })
      ])
    );
  });

  it('rejects the unavailable generic custom adapter runtime', () => {
    const profile: GameProfile = {
      ...unityProfile,
      engine: { type: 'custom' },
      launch: { platform: 'linux', arguments: [] },
      adapter: {
        ...unityProfile.adapter,
        type: 'custom',
        instrumentationEndpoint: undefined,
        supportsMultipleInstances: false,
        supportsStateRead: false,
        supportsDirectActions: false
      }
    };
    const result = createAdapterOptionsFromGameProfile(profile, {
      ...runConfig,
      adapterType: 'custom'
    });

    expect(result.observationCapability).toBe('unavailable');
    expect(result.options.custom).toMatchObject({ observationCapability: 'unavailable' });
    expect(result.observationMessage).toBe(
      'The test is running, but only logs and screenshots can be viewed.'
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'adapter.type',
          message: expect.stringContaining('Custom adapter runtime is unavailable')
        })
      ])
    );
  });

  it('rejects instrumented transports without a runtime implementation', () => {
    const result = createAdapterOptionsFromGameProfile(
      {
        ...unityProfile,
        adapter: {
          ...unityProfile.adapter,
          instrumentationTransport: 'local-websocket'
        }
      },
      runConfig
    );

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'adapter.instrumentationTransport',
          message: expect.stringContaining('Only Local HTTP')
        })
      ])
    );
  });

  it('rejects unsafe browser URLs, instrumentation endpoints, and relative executables', () => {
    const browserResult = createAdapterOptionsFromGameProfile(
      {
        ...unityProfile,
        engine: { type: 'browser' },
        launch: {
          platform: 'browser',
          url: 'file:///tmp/private-game.html',
          arguments: []
        },
        adapter: {
          ...unityProfile.adapter,
          type: 'browser',
          instrumentationEndpoint: undefined
        }
      },
      {
        ...runConfig,
        adapterType: 'browser'
      }
    );
    const instrumentedResult = createAdapterOptionsFromGameProfile(
      {
        ...unityProfile,
        adapter: {
          ...unityProfile.adapter,
          type: 'instrumented',
          instrumentationEndpoint: 'javascript:alert(1)'
        }
      },
      {
        ...runConfig,
        adapterType: 'instrumented'
      }
    );
    const desktopResult = createAdapterOptionsFromGameProfile(
      {
        ...unityProfile,
        engine: { type: 'unknown' },
        launch: {
          ...unityProfile.launch,
          executablePath: './TestGame.exe'
        },
        adapter: {
          ...unityProfile.adapter,
          type: 'desktop',
          instrumentationEndpoint: undefined
        }
      },
      {
        ...runConfig,
        adapterType: 'desktop'
      }
    );

    expect(browserResult.errors).toContainEqual(
      expect.objectContaining({ path: 'launch.url', message: expect.stringContaining('http') })
    );
    expect(instrumentedResult.errors).toContainEqual(
      expect.objectContaining({
        path: 'adapter.instrumentationEndpoint',
        message: expect.stringContaining('http')
      })
    );
    expect(desktopResult.errors).toContainEqual(
      expect.objectContaining({
        path: 'launch.executablePath',
        message: expect.stringContaining('absolute')
      })
    );
  });

  it('rejects remote instrumentation endpoints for this release', () => {
    const result = createAdapterOptionsFromGameProfile(
      {
        ...unityProfile,
        adapter: {
          ...unityProfile.adapter,
          type: 'instrumented',
          instrumentationEndpoint: 'https://qa-game.example.com/gsi'
        }
      },
      {
        ...runConfig,
        adapterType: 'instrumented'
      }
    );

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: 'adapter.instrumentationEndpoint',
        message: expect.stringMatching(/127\.0\.0\.1.*localhost.*::1/i)
      })
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

  it('passes live observation preferences to the browser adapter boundary', () => {
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
        type: 'browser'
      }
    };
    const runtimeObservation = {
      showBotGameplay: true,
      observationMode: 'show-all-instances' as const,
      bringGameToFrontOnAction: false,
      visibleActionDelayMs: 400,
      showActionInformation: true,
      maxVisibleGameWindows: 2
    };

    const result = createAdapterOptionsFromGameProfile(
      profile,
      { ...runConfig, adapterType: 'browser' },
      runtimeObservation
    );

    expect(result.options.browser?.runtimeObservation).toEqual(runtimeObservation);
    expect(result.options.browser?.headless).toBe(false);
  });

  it('keeps browser profile options headless when gameplay observation is disabled', () => {
    const profile: GameProfile = {
      ...unityProfile,
      engine: { type: 'browser' },
      launch: { platform: 'browser', url: 'http://localhost:5173', arguments: [] },
      adapter: { ...unityProfile.adapter, type: 'browser' }
    };

    const result = createAdapterOptionsFromGameProfile(profile, {
      ...runConfig,
      adapterType: 'browser'
    });

    expect(result.options.browser?.headless).toBe(true);
  });

  it('places adapter screenshots under an explicit runtime runs root', () => {
    const profile: GameProfile = {
      ...unityProfile,
      engine: { type: 'browser' },
      launch: { platform: 'browser', url: 'http://localhost:5173', arguments: [] },
      adapter: { ...unityProfile.adapter, type: 'browser' }
    };
    const runsRoot = resolve('tmp', 'gameplay-simulator-user-data', 'runs');

    const result = createAdapterOptionsFromGameProfile(
      profile,
      { ...runConfig, adapterType: 'browser' },
      undefined,
      { runsRoot }
    );

    expect(result.screenshotDirectory).toBe(
      join(runsRoot, 'session-session-options', 'adapter-screenshots')
    );
    expect(result.options.browser?.screenshotDirectory).toBe(result.screenshotDirectory);
  });
});
