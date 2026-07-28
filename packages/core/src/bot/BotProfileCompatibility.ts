import type { BotProfile, GameProfile, SimulationRunConfig } from '../types';

export type BotProfileCompatibilityLevel = 'supported' | 'limited' | 'unavailable';

export interface BotProfileCompatibilityReport {
  profileId: string;
  level: BotProfileCompatibilityLevel;
  supported: boolean;
  warnings: string[];
  blockers: string[];
}

function hasInput(gameProfile: GameProfile, inputType: GameProfile['controls'][number]['inputType']): boolean {
  return gameProfile.controls.some((control) => control.inputType === inputType);
}

function hasAction(gameProfile: GameProfile, keywords: string[]): boolean {
  return gameProfile.controls.some((control) => {
    const text = `${control.controlId} ${control.label} ${control.action ?? ''}`.toLowerCase();
    return keywords.some((keyword) => text.includes(keyword));
  });
}

function hasSignal(gameProfile: GameProfile, source: GameProfile['progressSignals'][number]['source']): boolean {
  return [...gameProfile.progressSignals, ...gameProfile.failureSignals]
    .some((signal) => signal.source === source);
}

export function evaluateBotProfileCompatibility(
  profile: BotProfile,
  gameProfile: GameProfile,
  runConfig?: SimulationRunConfig
): BotProfileCompatibilityReport {
  const warnings: string[] = [];
  const blockers: string[] = [];

  switch (profile.profileId) {
    case 'keyboard-input-mapping-tester-bot':
      if (!hasInput(gameProfile, 'keyboard') && !gameProfile.adapter.supportsDirectActions) {
        blockers.push('Keyboard input is unavailable. Add keyboard control mappings or use an instrumented adapter that exposes keyboard test actions.');
      }
      break;
    case 'controller-gamepad-tester-bot':
      if (!hasInput(gameProfile, 'gamepad')) {
        blockers.push('Gamepad input is unavailable because this game profile has no gamepad control mappings.');
      }
      if (!gameProfile.adapter.supportsDirectActions) {
        blockers.push('Gamepad input is unavailable through this adapter. Use an instrumented or custom adapter that reports real gamepad actions.');
      }
      break;
    case 'touch-mobile-controls-tester-bot':
      if (!hasInput(gameProfile, 'touch')) {
        blockers.push('Touch simulation is unavailable because this game profile has no touch control mappings.');
      }
      if (!gameProfile.adapter.supportsDirectActions) {
        blockers.push('Touch simulation is unavailable through this adapter. Use an instrumented or custom adapter that reports real touch actions.');
      }
      break;
    case 'display-resolution-tester-bot':
      if (!gameProfile.adapter.supportsScreenshots) {
        warnings.push('Screenshot capture is unavailable, so display and layout findings will have weaker visual evidence.');
      }
      if (!gameProfile.adapter.supportsDirectActions && !hasAction(gameProfile, ['resolution', 'fullscreen', 'window', 'display', 'ui scale'])) {
        warnings.push('No display-setting actions are mapped. The bot can inspect the current display but cannot automatically change every mode.');
      }
      break;
    case 'localization-text-overflow-tester-bot':
      if (!gameProfile.adapter.supportsStateRead && !gameProfile.adapter.supportsScreenshots) {
        blockers.push('Text layout cannot be inspected because this adapter provides neither readable state nor screenshots.');
      }
      if (!gameProfile.adapter.supportsDirectActions && !hasAction(gameProfile, ['language', 'localization', 'text', 'rtl'])) {
        warnings.push('No language or text-stress actions are mapped, so automatic language switching may be unavailable.');
      }
      break;
    case 'audio-subtitle-tester-bot':
      if (!hasSignal(gameProfile, 'audio')) {
        warnings.push('Audio cannot be automatically verified because this profile exposes no audio signal. The bot can exercise audio and subtitle controls, but a person or instrumented audio signal must confirm what was heard.');
      }
      if (!gameProfile.adapter.supportsDirectActions && !hasAction(gameProfile, ['audio', 'volume', 'mute', 'subtitle'])) {
        warnings.push('No audio or subtitle controls are mapped, so the bot may be unable to change these settings.');
      }
      break;
    case 'accessibility-tester-bot':
      warnings.push('Accessibility findings are automated indications for human review. They are not accessibility certification and do not guarantee compliance.');
      if (!gameProfile.adapter.supportsStateRead && !gameProfile.adapter.supportsScreenshots) {
        warnings.push('This adapter has weak accessibility awareness because it provides neither readable state nor screenshots.');
      }
      break;
    case 'settings-configuration-tester-bot':
      if (!gameProfile.adapter.supportsDirectActions && !hasAction(gameProfile, ['setting', 'configuration', 'option', 'preferences'])) {
        blockers.push('Settings testing is unavailable because no settings controls are mapped and the adapter exposes no direct settings actions.');
      }
      if (!gameProfile.adapter.supportsStateRead) {
        warnings.push('Settings persistence cannot be fully verified automatically without readable game state.');
      }
      break;
    case 'loading-transition-tester-bot':
      if (!gameProfile.adapter.supportsStateRead && !gameProfile.adapter.supportsScreenshots) {
        blockers.push('Loading and transition testing is unavailable because the adapter provides neither readable state nor screenshots.');
      }
      if (!gameProfile.adapter.supportsDirectActions && !hasAction(gameProfile, ['load', 'scene', 'transition', 'travel'])) {
        warnings.push('No transition actions are mapped, so the bot may only observe transitions started by other gameplay actions.');
      }
      break;
    case 'network-resilience-tester-bot':
    case 'multiplayer-session-tester-bot': {
      const multiplayer = profile.profileId === 'multiplayer-session-tester-bot';
      if (runConfig?.technicalTesting?.controlledNetworkTestConfirmed !== true) {
        const message = 'Controlled network test confirmation is required. Use only a private or developer-controlled environment that you own or have permission to test.';
        if (runConfig) blockers.push(message);
        else warnings.push(message);
      }
      if (!gameProfile.adapter.supportsDirectActions || !gameProfile.adapter.supportsStateRead) {
        blockers.push(`${multiplayer ? 'Private multiplayer session' : 'Network resilience'} testing requires an instrumented or custom adapter with direct actions and readable state.`);
      }
      if (multiplayer && !gameProfile.adapter.supportsMultipleInstances) {
        warnings.push('This profile does not support multiple game instances, so multi-client session coverage may be incomplete.');
      }
      break;
    }
    case 'memory-leak-endurance-tester-bot':
      warnings.push('Endurance testing can substantially increase CPU, RAM, disk use, and total runtime. Start with one bot, a short runtime, and conservative resource limits.');
      if (!hasSignal(gameProfile, 'telemetry') && !gameProfile.adapter.supportsStateRead) {
        warnings.push('Detailed memory and degradation checks are incomplete because the game exposes no telemetry or readable state.');
      }
      if (runConfig?.runUntilStopped || (runConfig && runConfig.maxRuntimeMinutes === undefined)) {
        warnings.push('This endurance session has no fixed runtime limit and will continue until manually stopped or another stop rule is reached.');
      }
      break;
    case 'save-migration-tester-bot':
      if ((runConfig?.technicalTesting?.saveMigrationTestPaths.length ?? 0) === 0) {
        const message = 'Save migration requires at least one user-provided permitted test save. The simulator will not discover personal saves automatically.';
        if (runConfig) blockers.push(message);
        else warnings.push(message);
      }
      if (!gameProfile.adapter.supportsDirectActions || !gameProfile.adapter.supportsStateRead) {
        blockers.push('Save migration testing requires direct load or migration actions and readable migrated game state.');
      }
      break;
    case 'world-persistence-tester-bot':
      if (!gameProfile.adapter.supportsDirectActions || !gameProfile.adapter.supportsStateRead) {
        blockers.push('World persistence testing requires direct world/save actions and readable state before and after reload.');
      }
      break;
    case 'achievement-unlock-tester-bot':
      if (!gameProfile.adapter.supportsDirectActions || !gameProfile.adapter.supportsStateRead) {
        blockers.push('Achievement testing requires direct sandbox unlock actions and readable achievement state.');
      }
      break;
    case 'file-permission-tester-bot':
      if ((runConfig?.technicalTesting?.approvedFileTestDirectories.length ?? 0) === 0) {
        const message = 'File and permission testing requires at least one explicitly approved disposable test or session directory.';
        if (runConfig) blockers.push(message);
        else warnings.push(message);
      }
      if (!gameProfile.adapter.supportsDirectActions) {
        blockers.push('File and permission testing requires an instrumented or custom adapter that restricts file actions to approved directories.');
      }
      break;
    default:
      break;
  }

  return {
    profileId: profile.profileId,
    level: blockers.length > 0 ? 'unavailable' : warnings.length > 0 ? 'limited' : 'supported',
    supported: blockers.length === 0,
    warnings,
    blockers
  };
}
