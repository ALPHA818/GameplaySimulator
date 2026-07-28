import type {
  AdapterType,
  BrowserDomScanMode,
  ControlBinding,
  GameProfile,
  InstrumentationTransportType,
  SimulationRunConfig
} from '@core/types';
import {
  defaultRuntimeObservationConfig,
  type RuntimeObservationConfig
} from '@core/config/runtimeObservationConfig';
import { join } from 'node:path';
import type { AdapterFactoryOptions } from './AdapterFactory';
import type { AdapterCapabilities, ObservationCapability } from './base/GameAdapter';
import { createExternalDesktopWindowFocusHandler } from './desktop/DesktopWindowAdapter';

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
  browserDomScanMode: BrowserDomScanMode;
  screenshotDirectory: string;
  observationCapability: ObservationCapability;
  observationMessage: string;
}

export interface AdapterRuntimePathOptions {
  runsRoot?: string;
}

const engineAdapterTypes = new Set<AdapterType>(['unity', 'godot', 'unreal']);
const desktopAdapterTypes = new Set<AdapterType>(['desktop', 'rpg_maker', 'gamemaker']);

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text && text.length > 0 ? text : undefined;
}

function isHttpUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function isAbsoluteExecutablePath(value: string | undefined): boolean {
  if (!value || value.includes('\0')) {
    return false;
  }

  return value.startsWith('/') ||
    value.startsWith('\\\\') ||
    /^[a-zA-Z]:[\\/]/.test(value);
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
  usesDesktopFallback: boolean,
  observationCapability: ObservationCapability
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
    supportsCheckpointReload: gameProfile.adapter.supportsDirectActions,
    supportsLiveObservation: observationCapability !== 'unavailable',
    supportsWindowFocus: observationCapability === 'external-window' || usesDesktopFallback || adapterType === 'browser',
    supportsMultipleVisibleWindows:
      adapterType === 'browser' || (usesDesktopFallback && gameProfile.adapter.supportsMultipleInstances),
    observationCapability
  };
}

function observationCapabilityFor(
  gameProfile: GameProfile,
  runtimeMode: AdapterRuntimeMode
): ObservationCapability {
  if (runtimeMode === 'browser' || runtimeMode === 'desktop-window' || runtimeMode === 'engine-desktop-fallback') {
    return 'visible-window';
  }

  if (runtimeMode === 'instrumented' || runtimeMode === 'engine-instrumented') {
    return trimmed(gameProfile.launch.executablePath) ? 'external-window' : 'unavailable';
  }

  return 'unavailable';
}

function observationMessageFor(
  runtimeMode: AdapterRuntimeMode,
  observationCapability: ObservationCapability
): string {
  if (runtimeMode === 'desktop-window' || runtimeMode === 'engine-desktop-fallback') {
    return 'This game is already running in a visible desktop window.';
  }

  if (runtimeMode === 'browser') {
    return 'This browser adapter can open a visible game window when Show Bot Gameplay is enabled.';
  }

  if (runtimeMode === 'instrumented' || runtimeMode === 'engine-instrumented') {
    return observationCapability === 'unavailable'
      ? 'This instrumented target has no visible game window.'
      : 'This instrumented target uses an external game window that the simulator can try to focus.';
  }

  return 'The test is running, but only logs and screenshots can be viewed.';
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

  if (
    usesDesktopFallback &&
    trimmed(gameProfile.launch.executablePath) &&
    !isAbsoluteExecutablePath(trimmed(gameProfile.launch.executablePath))
  ) {
    errors.push({
      path: 'launch.executablePath',
      message: 'Desktop executable path must be an absolute file path, not a command name or relative path.'
    });
  }

  if (runtimeMode === 'browser' && !browserUrl) {
    errors.push({
      path: 'launch.url',
      message: 'Browser adapter profiles need a game URL so the simulator can open the game.'
    });
  }

  if (runtimeMode === 'browser' && browserUrl && !isHttpUrl(browserUrl)) {
    errors.push({
      path: 'launch.url',
      message: 'Browser game URL must use http or https.'
    });
  }

  if (runtimeMode === 'instrumented' && !instrumentationEndpoint) {
    errors.push({
      path: 'adapter.instrumentationEndpoint',
      message: 'Instrumented adapter profiles need an instrumentation endpoint, like http://127.0.0.1:4555.'
    });
  }

  if (
    (runtimeMode === 'instrumented' || runtimeMode === 'engine-instrumented') &&
    instrumentationEndpoint &&
    !isHttpUrl(instrumentationEndpoint)
  ) {
    errors.push({
      path: 'adapter.instrumentationEndpoint',
      message: 'Local HTTP instrumentation endpoint must use http or https.'
    });
  }

  if (
    (runtimeMode === 'instrumented' || runtimeMode === 'engine-instrumented') &&
    gameProfile.adapter.instrumentationTransport !== undefined &&
    gameProfile.adapter.instrumentationTransport !== 'local-http'
  ) {
    errors.push({
      path: 'adapter.instrumentationTransport',
      message: 'Only Local HTTP instrumentation is available in this build.'
    });
  }

  if (runtimeMode === 'custom') {
    errors.push({
      path: 'adapter.type',
      message: 'Custom adapter runtime is unavailable in this build. Choose an instrumented or desktop adapter.'
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

  if (runConfig.saveVideo) {
    errors.push({
      path: 'saveVideo',
      message: 'Video recording is unavailable in this build. Turn off Save Video before starting the session.'
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
  runConfig: SimulationRunConfig,
  runtimeObservation: RuntimeObservationConfig = defaultRuntimeObservationConfig,
  runtimePaths: AdapterRuntimePathOptions = {}
): AdapterProfileOptionsResult {
  const adapterType = runConfig.adapterType;
  const instrumentationEndpoint = instrumentationEndpointFor(gameProfile, adapterType);
  const instrumentationTransport = gameProfile.adapter.instrumentationTransport ?? 'local-http';
  const browserUrl = adapterType === 'browser' ? trimmed(gameProfile.launch.url) : undefined;
  const browserName = trimmed(gameProfile.adapter.browserName);
  const browserDomScanMode = gameProfile.adapter.browserDomScanMode ?? 'fallback';
  const runtimeMode = runtimeModeFor(adapterType, instrumentationEndpoint);
  const usesDesktopFallback = runtimeMode === 'desktop-window' || runtimeMode === 'engine-desktop-fallback';
  const observationCapability = observationCapabilityFor(gameProfile, runtimeMode);
  const observationMessage = observationMessageFor(runtimeMode, observationCapability);
  const capabilities = adapterCapabilitiesFromProfile(
    gameProfile,
    adapterType,
    usesDesktopFallback,
    observationCapability
  );
  const controlBindings = cloneControlBindings(gameProfile.controls);
  const launchArguments = [...gameProfile.launch.arguments];
  const screenshotDirectory = runtimePaths.runsRoot
    ? join(runtimePaths.runsRoot, runConfig.sessionId, 'adapter-screenshots')
    : `runs/${runConfig.sessionId}/adapter-screenshots`;
  const desktopOptions = {
    executablePath: gameProfile.launch.executablePath,
    workingDirectory: gameProfile.launch.workingDirectory,
    launchArguments,
    controlBindings,
    screenshotDirectory,
    runtimeObservation,
    capabilities
  };
  const instrumentedOptions = {
    instrumentationEndpoint,
    instrumentationTransport,
    observationCapability,
    windowFocusHandler:
      observationCapability === 'external-window' && gameProfile.launch.executablePath
        ? createExternalDesktopWindowFocusHandler(gameProfile.launch.executablePath)
        : undefined,
    capabilities
  };
  const options: AdapterFactoryOptions = {
    browser: {
      targetUrl: browserUrl,
      browserName,
      domScanMode: browserDomScanMode,
      controlBindings,
      screenshotDirectory,
      headless:
        !runtimeObservation.showBotGameplay || runtimeObservation.observationMode === 'background',
      runtimeObservation,
      capabilities
    },
    custom: {
      protocolName: gameProfile.engine.type,
      observationCapability,
      capabilities
    },
    desktop: desktopOptions,
    instrumented: instrumentedOptions,
    unity: {
      unityVersion: gameProfile.engine.version,
      instrumentationEndpoint,
      desktopOptions,
      instrumentedOptions
    },
    godot: {
      godotVersion: gameProfile.engine.version,
      instrumentationEndpoint,
      desktopOptions,
      instrumentedOptions
    },
    unreal: {
      unrealVersion: gameProfile.engine.version,
      instrumentationEndpoint,
      desktopOptions,
      instrumentedOptions
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
    browserDomScanMode,
    screenshotDirectory,
    observationCapability,
    observationMessage
  };
}
