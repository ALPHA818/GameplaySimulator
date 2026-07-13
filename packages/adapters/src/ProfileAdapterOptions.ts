import type {
  AdapterType,
  ControlBinding,
  GameProfile,
  InstrumentationTransportType,
  SimulationRunConfig
} from '@core/types';
import type { AdapterFactoryOptions } from './AdapterFactory';
import type { AdapterCapabilities } from './base/GameAdapter';

export interface AdapterProfileValidationIssue {
  path: string;
  message: string;
}

export type AdapterRuntimeMode =
  | 'browser'
  | 'custom'
  | 'desktop-window'
  | 'instrumented'
  | 'engine-instrumented'
  | 'engine-desktop-fallback';

export interface AdapterProfileOptionsResult {
  adapterType: AdapterType;
  runtimeMode: AdapterRuntimeMode;
  options: AdapterFactoryOptions;
  errors: AdapterProfileValidationIssue[];
  warnings: AdapterProfileValidationIssue[];
  instrumentationEndpoint?: string;
  instrumentationTransport: InstrumentationTransportType;
  browserUrl?: string;
  browserName?: string;
  screenshotDirectory: string;
}

const engineAdapterTypes = new Set<AdapterType>(['unity', 'godot', 'unreal']);
const desktopAdapterTypes = new Set<AdapterType>(['desktop', 'rpg_maker', 'gamemaker']);

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text && text.length > 0 ? text : undefined;
}

function cloneControlBindings(bindings: ControlBinding[]): ControlBinding[] {
  return bindings.map((binding) => ({
    ...binding,
    metadata: { ...binding.metadata }
  }));
}

function adapterCapabilitiesFromProfile(
  gameProfile: GameProfile,
  adapterType: AdapterType,
  usesDesktopFallback: boolean
): Partial<AdapterCapabilities> {
  const supportsMultipleBotsPerInstance =
    !usesDesktopFallback &&
    (adapterType === 'instrumented' ||
      adapterType === 'browser' ||
      gameProfile.adapter.supportsDirectActions);

  return {
    supportsMultipleInstances: usesDesktopFallback
      ? gameProfile.adapter.supportsMultipleInstances
      : gameProfile.adapter.supportsMultipleInstances,
    supportsMultipleBotsPerInstance,
    supportsStateRead: usesDesktopFallback ? false : gameProfile.adapter.supportsStateRead,
    supportsDirectActions: usesDesktopFallback ? false : gameProfile.adapter.supportsDirectActions,
    supportsInputSimulation: usesDesktopFallback || adapterType === 'desktop' || gameProfile.controls.length > 0,
    supportsScreenshots: gameProfile.adapter.supportsScreenshots,
    supportsVideo: gameProfile.adapter.supportsVideo,
    supportsGameLogs: gameProfile.adapter.supportsStateRead,
    supportsSaveIsolation: gameProfile.adapter.supportsSaveIsolation,
    supportsReset: gameProfile.adapter.supportsDirectActions,
    supportsCheckpointReload: gameProfile.adapter.supportsDirectActions
  };
}

function instrumentationEndpointFor(gameProfile: GameProfile, adapterType: AdapterType): string | undefined {
  const configuredEndpoint = trimmed(gameProfile.adapter.instrumentationEndpoint);

  if (configuredEndpoint) {
    return configuredEndpoint;
  }

  if (adapterType !== 'browser' && gameProfile.launch.platform !== 'browser') {
    return trimmed(gameProfile.launch.url);
  }

  return undefined;
}

function runtimeModeFor(adapterType: AdapterType, instrumentationEndpoint: string | undefined): AdapterRuntimeMode {
  if (adapterType === 'browser') {
    return 'browser';
  }

  if (adapterType === 'instrumented') {
    return 'instrumented';
  }

  if (engineAdapterTypes.has(adapterType)) {
    return instrumentationEndpoint ? 'engine-instrumented' : 'engine-desktop-fallback';
  }

  if (desktopAdapterTypes.has(adapterType)) {
    return 'desktop-window';
  }

  return 'custom';
}

function validateProfileAdapterSettings(input: {
  gameProfile: GameProfile;
  runConfig: SimulationRunConfig;
  runtimeMode: AdapterRuntimeMode;
  instrumentationEndpoint?: string;
  browserUrl?: string;
}): {
  errors: AdapterProfileValidationIssue[];
  warnings: AdapterProfileValidationIssue[];
} {
  const { gameProfile, runConfig, runtimeMode, instrumentationEndpoint, browserUrl } = input;
  const errors: AdapterProfileValidationIssue[] = [];
  const warnings: AdapterProfileValidationIssue[] = [];
  const usesDesktopFallback = runtimeMode === 'desktop-window' || runtimeMode === 'engine-desktop-fallback';

  if (runConfig.adapterType !== gameProfile.adapter.type) {
    warnings.push({
      path: 'adapter.type',
      message: `Run config uses ${runConfig.adapterType}, but the game profile is set to ${gameProfile.adapter.type}.`
    });
  }

  if (usesDesktopFallback && !trimmed(gameProfile.launch.executablePath)) {
    errors.push({
      path: 'launch.executablePath',
      message: 'Desktop adapter profiles need an executable path so the simulator can start the game.'
    });
  }

  if (runtimeMode === 'browser' && !browserUrl) {
    errors.push({
      path: 'launch.url',
      message: 'Browser adapter profiles need a game URL so the simulator can open the game.'
    });
  }

  if (runtimeMode === 'instrumented' && !instrumentationEndpoint) {
    errors.push({
      path: 'adapter.instrumentationEndpoint',
      message: 'Instrumented adapter profiles need an instrumentation endpoint, like http://127.0.0.1:4555.'
    });
  }

  if (usesDesktopFallback && gameProfile.controls.length === 0) {
    errors.push({
      path: 'controls',
      message: 'Desktop fallback needs control mappings, such as move up = W and interact = E.'
    });
  }

  if (runConfig.saveScreenshots && !gameProfile.adapter.supportsScreenshots) {
    warnings.push({
      path: 'adapter.supportsScreenshots',
      message: 'Screenshots are enabled for the run, but this game profile says the adapter cannot take screenshots.'
    });
  }

  if (runConfig.saveVideo && !gameProfile.adapter.supportsVideo) {
    warnings.push({
      path: 'adapter.supportsVideo',
      message: 'Video is enabled for the run, but this game profile says the adapter cannot record video.'
    });
  }

  const saveIsolation = gameProfile.saveIsolation;

  if (saveIsolation && saveIsolation.mode !== 'none' && !gameProfile.adapter.supportsSaveIsolation) {
    warnings.push({
      path: 'saveIsolation.mode',
      message: 'Save isolation is configured, but this game profile says the adapter does not support save isolation.'
    });
  }

  if (saveIsolation?.mode === 'launch-argument-profile' && !trimmed(saveIsolation.profileArgumentTemplate)) {
    errors.push({
      path: 'saveIsolation.profileArgumentTemplate',
      message: 'Launch-argument save isolation needs a profile argument template, such as --save-dir={savePath}.'
    });
  }

  if (saveIsolation?.mode === 'environment-variable' && !trimmed(saveIsolation.environmentVariableName)) {
    errors.push({
      path: 'saveIsolation.environmentVariableName',
      message: 'Environment-variable save isolation needs an environment variable name, such as MY_GAME_SAVE_DIR.'
    });
  }

  if (saveIsolation?.mode === 'copy-directory' && !trimmed(saveIsolation.sourceSavePath)) {
    warnings.push({
      path: 'saveIsolation.sourceSavePath',
      message: 'Copy-directory save isolation has no source save path, so each instance will start with an empty save folder.'
    });
  }

  return { errors, warnings };
}

export function createAdapterOptionsFromGameProfile(
  gameProfile: GameProfile,
  runConfig: SimulationRunConfig
): AdapterProfileOptionsResult {
  const adapterType = runConfig.adapterType;
  const instrumentationEndpoint = instrumentationEndpointFor(gameProfile, adapterType);
  const instrumentationTransport = gameProfile.adapter.instrumentationTransport ?? 'local-http';
  const browserUrl = adapterType === 'browser' ? trimmed(gameProfile.launch.url) : undefined;
  const browserName = trimmed(gameProfile.adapter.browserName);
  const runtimeMode = runtimeModeFor(adapterType, instrumentationEndpoint);
  const usesDesktopFallback = runtimeMode === 'desktop-window' || runtimeMode === 'engine-desktop-fallback';
  const capabilities = adapterCapabilitiesFromProfile(gameProfile, adapterType, usesDesktopFallback);
  const controlBindings = cloneControlBindings(gameProfile.controls);
  const launchArguments = [...gameProfile.launch.arguments];
  const screenshotDirectory = `runs/${runConfig.sessionId}/adapter-screenshots`;
  const desktopOptions = {
    executablePath: gameProfile.launch.executablePath,
    workingDirectory: gameProfile.launch.workingDirectory,
    launchArguments,
    controlBindings,
    screenshotDirectory,
    capabilities
  };
  const instrumentedOptions = {
    instrumentationEndpoint,
    instrumentationTransport,
    capabilities
  };
  const options: AdapterFactoryOptions = {
    browser: {
      targetUrl: browserUrl,
      browserName,
      controlBindings,
      screenshotDirectory,
      capabilities
    },
    custom: {
      protocolName: gameProfile.engine.type,
      capabilities
    },
    desktop: desktopOptions,
    instrumented: instrumentedOptions,
    unity: {
      unityVersion: gameProfile.engine.version,
      instrumentationEndpoint
    },
    godot: {
      godotVersion: gameProfile.engine.version,
      instrumentationEndpoint
    },
    unreal: {
      unrealVersion: gameProfile.engine.version,
      instrumentationEndpoint
    }
  };
  const validation = validateProfileAdapterSettings({
    gameProfile,
    runConfig,
    runtimeMode,
    instrumentationEndpoint,
    browserUrl
  });

  return {
    adapterType,
    runtimeMode,
    options,
    errors: validation.errors,
    warnings: validation.warnings,
    instrumentationEndpoint,
    instrumentationTransport,
    browserUrl,
    browserName,
    screenshotDirectory
  };
}
