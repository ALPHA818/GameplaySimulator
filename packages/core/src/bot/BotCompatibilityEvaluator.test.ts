import { describe, expect, it } from 'vitest';
import { GameProfileSchema, type BotProfile, type GameProfile } from '../types';
import { BotCompatibilityEvaluator } from './BotCompatibilityEvaluator';
import { defaultBotProfiles } from './defaultBotProfiles';

function profile(profileId: string): BotProfile {
  const found = defaultBotProfiles.find((candidate) => candidate.profileId === profileId);
  if (!found) throw new Error(`Missing profile ${profileId}`);
  return found;
}

function hexcraftProfile(overrides: Partial<GameProfile> = {}): GameProfile {
  const base = GameProfileSchema.parse({
    gameId: 'hexcraft-like',
    gameName: 'Hexcraft Test Build',
    version: '0.4.0',
    engine: { type: 'browser' },
    launch: { platform: 'browser', url: 'http://localhost:5173' },
    adapter: {
      type: 'browser',
      supportsMultipleInstances: true,
      supportsStateRead: true,
      supportsDirectActions: true,
      supportsScreenshots: true,
      supportsVideo: false,
      supportsSaveIsolation: true,
      browserDomScanMode: 'fallback'
    },
    controls: [
      {
        controlId: 'open-crafting',
        label: 'Open Crafting',
        inputType: 'keyboard',
        binding: 'C',
        action: 'open-crafting'
      },
      {
        controlId: 'place-block',
        label: 'Place Block',
        inputType: 'mouse',
        binding: 'MouseLeft',
        action: 'place-block'
      }
    ],
    testingTargets: [
      {
        targetId: 'world-generation',
        name: 'Procedural world generation',
        tags: ['generated-world', 'world-seed']
      }
    ],
    progressSignals: [
      {
        signalId: 'environment-time',
        name: 'Day night environment cycle',
        source: 'state'
      }
    ],
    failureSignals: [],
    uiFlows: [{
      flowId: 'create-world',
      name: 'Create World',
      startState: 'main-menu',
      endState: 'world-loaded',
      steps: [{ actionType: 'start-world' }]
    }],
    saveIsolation: { mode: 'temp-directory' },
    knownContent: {
      items: ['Wood', 'Stone', 'Crafting recipe'],
      mechanics: ['crafting recipes', 'building and destruction', 'procedural generation', 'day night weather']
    }
  });

  return {
    ...base,
    ...overrides,
    adapter: { ...base.adapter, ...overrides.adapter },
    controls: overrides.controls ?? base.controls,
    testingTargets: overrides.testingTargets ?? base.testingTargets,
    progressSignals: overrides.progressSignals ?? base.progressSignals,
    failureSignals: overrides.failureSignals ?? base.failureSignals,
    uiFlows: overrides.uiFlows ?? base.uiFlows,
    knownContent: overrides.knownContent ?? base.knownContent
  };
}

describe('BotCompatibilityEvaluator', () => {
  const evaluator = new BotCompatibilityEvaluator();

  it('recommends specialists that match a Hexcraft-like browser profile', () => {
    for (const profileId of [
      'crafting-recipe-tester-bot',
      'building-destruction-tester-bot',
      'procedural-generation-tester-bot',
      'environment-cycle-tester-bot'
    ]) {
      const result = evaluator.evaluate(profile(profileId), hexcraftProfile());

      expect(result.status, profileId).toBe('recommended');
      expect(result.compatibleWithSelectedGame, profileId).toBe(true);
      expect(result.whyRecommended.length, profileId).toBeGreaterThan(0);
      expect(result.matchedFeatures.length, profileId).toBeGreaterThan(0);
    }
  });

  it('limits touch testing without touch controls and rejects multiplayer without multiplayer instrumentation', () => {
    const touch = evaluator.evaluate(
      profile('touch-mobile-controls-tester-bot'),
      hexcraftProfile()
    );
    const multiplayer = evaluator.evaluate(
      profile('multiplayer-session-tester-bot'),
      hexcraftProfile()
    );

    expect(touch.status).toBe('limited');
    expect(touch.missingRequirements.join(' ')).toContain('mapped touch controls');
    expect(multiplayer.status).toBe('unsupported');
    expect(multiplayer.missingRequirements.join(' ')).toContain('controlled network instrumentation');
    expect(multiplayer.missingRequirements.join(' ')).toContain('private multiplayer or lobby features');
  });

  it('uses mapped gamepad controls and performance telemetry as capability evidence', () => {
    const capableProfile = hexcraftProfile({
      adapter: {
        ...hexcraftProfile().adapter,
        type: 'instrumented'
      },
      controls: [
        ...hexcraftProfile().controls,
        {
          controlId: 'gamepad-confirm',
          label: 'Gamepad Confirm',
          inputType: 'gamepad',
          action: 'press-gamepad-button',
          metadata: {}
        }
      ],
      progressSignals: [
        ...hexcraftProfile().progressSignals,
        {
          signalId: 'performance',
          name: 'Memory and frame time',
          source: 'telemetry',
          metadata: {}
        }
      ]
    });

    expect(evaluator.evaluate(profile('controller-gamepad-tester-bot'), capableProfile).status)
      .toBe('recommended');
    expect(evaluator.evaluate(profile('performance-stress-bot'), capableProfile).status)
      .toBe('recommended');
  });

  it('does not recommend a feature-specific specialist when the profile contains no matching feature', () => {
    const result = evaluator.evaluate(
      profile('boss-encounter-tester-bot'),
      hexcraftProfile()
    );

    expect(result.status).toBe('limited');
    expect(result.whyRecommended).toEqual([]);
    expect(result.missingRequirements.join(' ')).toContain('No boss encounters');
  });

  it('returns compatible for a broadly supported general bot without a specialist feature rule', () => {
    const result = evaluator.evaluate(profile('main-story-bot'), hexcraftProfile());

    expect(result.status).toBe('compatible');
    expect(result.compatibleWithSelectedGame).toBe(true);
  });

  it('enforces known capability IDs on custom profiles', () => {
    const customProfile: BotProfile = {
      ...profile('main-story-bot'),
      profileId: 'vehicle-upgrade-tester',
      displayName: 'Vehicle Upgrade Tester',
      profileGroup: 'custom',
      requiredCapabilities: ['gamepad-input', 'state-read'],
      defaultEnabled: false
    };
    const result = evaluator.evaluate(customProfile, hexcraftProfile());

    expect(result.status).toBe('unsupported');
    expect(result.missingRequirements).toContain('Missing required capability: gamepad-input.');
  });
});
