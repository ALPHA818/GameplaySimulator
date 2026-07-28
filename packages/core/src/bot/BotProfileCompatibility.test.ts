import { describe, expect, it } from 'vitest';
import {
  GameProfileSchema,
  SimulationRunConfigSchema,
  type BotProfile,
  type GameProfile,
  type SimulationRunConfig
} from '../types';
import { defaultBotProfiles } from './defaultBotProfiles';
import { evaluateBotProfileCompatibility } from './BotProfileCompatibility';

function profile(profileId: string): BotProfile {
  const found = defaultBotProfiles.find((candidate) => candidate.profileId === profileId);
  if (!found) throw new Error(`Missing profile ${profileId}`);
  return found;
}

function gameProfile(overrides: Partial<GameProfile> = {}): GameProfile {
  const base = GameProfileSchema.parse({
    gameId: 'compatibility-game',
    gameName: 'Compatibility Game',
    version: '1.0.0',
    engine: { type: 'custom' },
    launch: { platform: 'linux', executablePath: '/games/compatibility-game' },
    adapter: {
      type: 'desktop',
      supportsMultipleInstances: false,
      supportsStateRead: true,
      supportsDirectActions: false,
      supportsScreenshots: true,
      supportsVideo: false,
      supportsSaveIsolation: false
    },
    controls: []
  });

  return {
    ...base,
    ...overrides,
    adapter: { ...base.adapter, ...overrides.adapter },
    controls: overrides.controls ?? base.controls,
    progressSignals: overrides.progressSignals ?? base.progressSignals,
    failureSignals: overrides.failureSignals ?? base.failureSignals
  };
}

function runConfig(
  profileId: string,
  technicalTesting?: SimulationRunConfig['technicalTesting']
): SimulationRunConfig {
  return SimulationRunConfigSchema.parse({
    sessionId: 'technical-session',
    gameProfilePath: 'memory://compatibility-game',
    adapterType: 'instrumented',
    runMode: 'sequential',
    runUntilStopped: false,
    maxRuntimeMinutes: 15,
    stopOnCriticalIssue: true,
    saveScreenshots: true,
    saveActionTimeline: true,
    saveStateSnapshots: true,
    botPools: [{
      profileId,
      enabled: true,
      minCount: 1,
      desiredCount: 1,
      maxCount: 1,
      scalingMode: 'fixed',
      priority: 10,
      resourceWeight: 'heavy'
    }],
    globalBotLimit: 1,
    perGameInstanceBotLimit: 1,
    actionDelayMs: 500,
    maxActionsPerBot: 20,
    technicalTesting,
    resourceLimits: {
      maxCpuPercent: 70,
      maxRamPercent: 70,
      reserveRamMb: 2048,
      maxGameInstances: 1,
      allowAutoScaling: false
    }
  });
}

const instrumentedProfile = () => gameProfile({
  adapter: {
    ...gameProfile().adapter,
    type: 'instrumented',
    supportsStateRead: true,
    supportsDirectActions: true
  }
});

describe('evaluateBotProfileCompatibility', () => {
  it('blocks gamepad testing when mappings or a capable direct adapter are unavailable', () => {
    const report = evaluateBotProfileCompatibility(profile('controller-gamepad-tester-bot'), gameProfile());

    expect(report.level).toBe('unavailable');
    expect(report.supported).toBe(false);
    expect(report.blockers.join(' ')).toContain('Gamepad input is unavailable');
  });

  it('supports gamepad testing only when mappings and direct actions are available', () => {
    const report = evaluateBotProfileCompatibility(
      profile('controller-gamepad-tester-bot'),
      gameProfile({
        adapter: {
          ...gameProfile().adapter,
          type: 'instrumented',
          supportsDirectActions: true
        },
        controls: [{
          controlId: 'gamepad-confirm',
          label: 'Gamepad Confirm',
          inputType: 'gamepad',
          action: 'press-gamepad-button',
          metadata: {}
        }]
      })
    );

    expect(report).toMatchObject({ level: 'supported', supported: true, blockers: [] });
  });

  it('blocks touch testing when touch simulation is unavailable', () => {
    const report = evaluateBotProfileCompatibility(profile('touch-mobile-controls-tester-bot'), gameProfile());

    expect(report.level).toBe('unavailable');
    expect(report.blockers.join(' ')).toContain('Touch simulation is unavailable');
  });

  it('explains when audio cannot be automatically verified', () => {
    const report = evaluateBotProfileCompatibility(profile('audio-subtitle-tester-bot'), gameProfile());

    expect(report.level).toBe('limited');
    expect(report.warnings.join(' ')).toContain('Audio cannot be automatically verified');
  });

  it('always labels accessibility results as automated indications rather than certification', () => {
    const report = evaluateBotProfileCompatibility(profile('accessibility-tester-bot'), gameProfile());

    expect(report.level).toBe('limited');
    expect(report.warnings.join(' ')).toContain('automated indications');
    expect(report.warnings.join(' ')).toContain('not accessibility certification');
  });

  it('requires explicit controlled-test confirmation for network specialists', () => {
    const profileValue = profile('network-resilience-tester-bot');
    const unconfirmed = evaluateBotProfileCompatibility(
      profileValue,
      instrumentedProfile(),
      runConfig(profileValue.profileId)
    );
    const confirmed = evaluateBotProfileCompatibility(
      profileValue,
      instrumentedProfile(),
      runConfig(profileValue.profileId, {
        controlledNetworkTestConfirmed: true,
        saveMigrationTestPaths: [],
        approvedFileTestDirectories: []
      })
    );

    expect(unconfirmed.level).toBe('unavailable');
    expect(unconfirmed.blockers.join(' ')).toContain('Controlled network test confirmation is required');
    expect(confirmed.level).toBe('supported');
  });

  it('requires user-provided saves and approved directories for technical file tests', () => {
    const migration = profile('save-migration-tester-bot');
    const file = profile('file-permission-tester-bot');
    const missingMigration = evaluateBotProfileCompatibility(
      migration,
      instrumentedProfile(),
      runConfig(migration.profileId)
    );
    const missingDirectory = evaluateBotProfileCompatibility(
      file,
      instrumentedProfile(),
      runConfig(file.profileId)
    );

    expect(missingMigration.blockers.join(' ')).toContain('user-provided permitted test save');
    expect(missingDirectory.blockers.join(' ')).toContain('explicitly approved disposable test or session directory');
  });

  it('always warns about endurance resource and runtime cost', () => {
    const endurance = profile('memory-leak-endurance-tester-bot');
    const report = evaluateBotProfileCompatibility(
      endurance,
      instrumentedProfile(),
      runConfig(endurance.profileId)
    );

    expect(report.level).toBe('limited');
    expect(report.warnings.join(' ')).toContain('CPU, RAM, disk use, and total runtime');
  });
});
