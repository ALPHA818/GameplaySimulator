import { describe, expect, it } from 'vitest';
import { BotProfileSchema } from '../types';
import { DEFAULT_BOT_PROFILE_IDS, defaultBotProfiles } from './defaultBotProfiles';

const expectedIds = [
  'main-story-bot',
  'completionist-bot',
  'explorer-bot',
  'speedrunner-bot',
  'chaos-monkey-bot',
  'ui-tester-bot',
  'ui-journey-bot',
  'economy-tester-bot',
  'combat-tester-bot',
  'quest-tester-bot',
  'side-content-tester-bot',
  'idle-player-bot',
  'inventory-stress-tester-bot',
  'dialogue-tester-bot',
  'sequence-breaker-bot',
  'new-player-bot',
  'performance-stress-bot',
  'save-load-tester-bot',
  'boundary-breaker-bot',
  'crafting-recipe-tester-bot',
  'building-destruction-tester-bot',
  'physics-interaction-tester-bot',
  'camera-view-tester-bot',
  'loot-random-drop-tester-bot',
  'death-respawn-tester-bot',
  'npc-behaviour-tester-bot',
  'boss-encounter-tester-bot',
  'procedural-generation-tester-bot',
  'environment-cycle-tester-bot',
  'keyboard-input-mapping-tester-bot',
  'controller-gamepad-tester-bot',
  'touch-mobile-controls-tester-bot',
  'display-resolution-tester-bot',
  'localization-text-overflow-tester-bot',
  'audio-subtitle-tester-bot',
  'accessibility-tester-bot',
  'settings-configuration-tester-bot',
  'loading-transition-tester-bot',
  'network-resilience-tester-bot',
  'multiplayer-session-tester-bot',
  'memory-leak-endurance-tester-bot',
  'save-migration-tester-bot',
  'world-persistence-tester-bot',
  'achievement-unlock-tester-bot',
  'file-permission-tester-bot'
];

const generalIds = [
  'main-story-bot',
  'completionist-bot',
  'explorer-bot',
  'speedrunner-bot',
  'chaos-monkey-bot',
  'new-player-bot'
];

const expectedCategories = {
  'main-story-bot': 'content-progression',
  'completionist-bot': 'content-progression',
  'explorer-bot': 'world-simulation',
  'speedrunner-bot': 'content-progression',
  'chaos-monkey-bot': 'performance-stability',
  'ui-tester-bot': 'ui-input',
  'ui-journey-bot': 'ui-input',
  'economy-tester-bot': 'gameplay-systems',
  'combat-tester-bot': 'gameplay-systems',
  'quest-tester-bot': 'content-progression',
  'side-content-tester-bot': 'content-progression',
  'idle-player-bot': 'performance-stability',
  'inventory-stress-tester-bot': 'gameplay-systems',
  'dialogue-tester-bot': 'accessibility',
  'sequence-breaker-bot': 'content-progression',
  'new-player-bot': 'accessibility',
  'performance-stress-bot': 'performance-stability',
  'save-load-tester-bot': 'persistence',
  'boundary-breaker-bot': 'world-simulation',
  'crafting-recipe-tester-bot': 'gameplay-systems',
  'building-destruction-tester-bot': 'gameplay-systems',
  'physics-interaction-tester-bot': 'world-simulation',
  'camera-view-tester-bot': 'ui-input',
  'loot-random-drop-tester-bot': 'gameplay-systems',
  'death-respawn-tester-bot': 'gameplay-systems',
  'npc-behaviour-tester-bot': 'world-simulation',
  'boss-encounter-tester-bot': 'gameplay-systems',
  'procedural-generation-tester-bot': 'world-simulation',
  'environment-cycle-tester-bot': 'world-simulation',
  'keyboard-input-mapping-tester-bot': 'ui-input',
  'controller-gamepad-tester-bot': 'platform',
  'touch-mobile-controls-tester-bot': 'platform',
  'display-resolution-tester-bot': 'platform',
  'localization-text-overflow-tester-bot': 'accessibility',
  'audio-subtitle-tester-bot': 'accessibility',
  'accessibility-tester-bot': 'accessibility',
  'settings-configuration-tester-bot': 'ui-input',
  'loading-transition-tester-bot': 'performance-stability',
  'network-resilience-tester-bot': 'network-multiplayer',
  'multiplayer-session-tester-bot': 'network-multiplayer',
  'memory-leak-endurance-tester-bot': 'performance-stability',
  'save-migration-tester-bot': 'persistence',
  'world-persistence-tester-bot': 'persistence',
  'achievement-unlock-tester-bot': 'content-progression',
  'file-permission-tester-bot': 'platform'
} as const;

const phase70Ids = expectedIds.slice(19, 29);
const phase71Ids = expectedIds.slice(29, 37);
const phase72Ids = expectedIds.slice(37);

describe('defaultBotProfiles', () => {
  it('defines the expected reusable bot profiles', () => {
    expect(DEFAULT_BOT_PROFILE_IDS).toEqual(expectedIds);
    expect(defaultBotProfiles).toHaveLength(45);
    expect(new Set(DEFAULT_BOT_PROFILE_IDS).size).toBe(DEFAULT_BOT_PROFILE_IDS.length);
    expect(new Set(defaultBotProfiles.map((profile) => profile.profileId)).size)
      .toBe(defaultBotProfiles.length);
  });

  it('defines behavior traits, action preferences, goals, and count ranges for every profile', () => {
    for (const profile of defaultBotProfiles) {
      const parsed = BotProfileSchema.parse(profile);

      expect(parsed.playstyle).toBeTruthy();
      expect(parsed.aggression).toBeGreaterThanOrEqual(0);
      expect(parsed.curiosity).toBeGreaterThanOrEqual(0);
      expect(parsed.riskTolerance).toBeGreaterThanOrEqual(0);
      expect(parsed.repetitionTolerance).toBeGreaterThanOrEqual(0);
      expect(parsed.bugHuntingBias).toBeGreaterThanOrEqual(0);
      expect(parsed.preferredActions?.length).toBeGreaterThan(0);
      expect(parsed.avoidedActions?.length).toBeGreaterThan(0);
      expect(parsed.goals.length).toBeGreaterThan(0);
      expect(parsed.recommendedMaxCount).toBeGreaterThanOrEqual(parsed.recommendedMinCount);
      expect(parsed.profileGroup).toBe(generalIds.includes(parsed.profileId) ? 'general' : 'specialized');
      expect(parsed.specializationCategory).toBe(
        expectedCategories[parsed.profileId as keyof typeof expectedCategories]
      );
      expect(parsed.requiredCapabilities?.length).toBeGreaterThan(0);
      expect(parsed.recommendedGameTypes?.length).toBeGreaterThan(0);
      expect(parsed.bestUsedFor?.length).toBeGreaterThan(0);
      expect(parsed.limitations?.length).toBeGreaterThan(0);
      expect(parsed.estimatedComplexity).toBeTruthy();
    }
  });

  it('does not enable specialized profiles in a default session', () => {
    expect(defaultBotProfiles.filter((profile) => profile.defaultEnabled).map((profile) => profile.profileId)).toEqual([
      'main-story-bot',
      'explorer-bot'
    ]);
    expect(defaultBotProfiles.filter((profile) => profile.profileGroup === 'specialized'))
      .toEqual(expect.arrayContaining(defaultBotProfiles.filter((profile) => !generalIds.includes(profile.profileId))));
    expect(defaultBotProfiles.some(
      (profile) => profile.profileGroup === 'specialized' && profile.defaultEnabled
    )).toBe(false);
  });

  it('gives every focused gameplay-system profile complete specialist guidance', () => {
    for (const profileId of phase70Ids) {
      const specialist = defaultBotProfiles.find((profile) => profile.profileId === profileId);

      expect(specialist).toMatchObject({
        profileGroup: 'specialized',
        defaultEnabled: false,
        beginnerRecommended: expect.any(Boolean)
      });
      expect(specialist?.beginnerExplanation).toEqual(expect.any(String));
      expect(specialist?.requiredCapabilities?.length).toBeGreaterThan(0);
      expect(specialist?.preferredActions?.length).toBeGreaterThan(0);
      expect(specialist?.avoidedActions?.length).toBeGreaterThan(0);
      expect(specialist?.goals.flatMap((goal) => goal.targetIssueCategories).length).toBeGreaterThan(0);
      expect(specialist?.defaultResourceWeight).toMatch(/light|medium|heavy|very_heavy/);
    }
  });

  it('defines controls, display, accessibility, and UX specialists as opt-in profiles', () => {
    for (const profileId of phase71Ids) {
      const specialist = defaultBotProfiles.find((profile) => profile.profileId === profileId);

      expect(specialist).toMatchObject({
        profileGroup: 'specialized',
        defaultEnabled: false
      });
      expect(specialist?.beginnerExplanation).toEqual(expect.any(String));
      expect(specialist?.requiredCapabilities?.length).toBeGreaterThan(0);
      expect(specialist?.preferredActions?.length).toBeGreaterThan(0);
      expect(specialist?.avoidedActions?.length).toBeGreaterThan(0);
    }
  });

  it('states the verification limits for audio and accessibility profiles', () => {
    const audio = defaultBotProfiles.find((profile) => profile.profileId === 'audio-subtitle-tester-bot');
    const accessibility = defaultBotProfiles.find((profile) => profile.profileId === 'accessibility-tester-bot');

    expect(audio?.limitations?.join(' ')).toContain('cannot be verified automatically');
    expect(accessibility?.limitations?.join(' ')).toContain('not accessibility certification');
  });

  it('defines technical specialists with explicit safety and capability guidance', () => {
    for (const profileId of phase72Ids) {
      const specialist = defaultBotProfiles.find((profile) => profile.profileId === profileId);

      expect(specialist).toMatchObject({ profileGroup: 'specialized', defaultEnabled: false });
      expect(specialist?.requiredCapabilities?.length).toBeGreaterThan(0);
      expect(specialist?.limitations?.length).toBeGreaterThan(0);
      expect(specialist?.beginnerExplanation).toEqual(expect.any(String));
    }

    const networkText = phase72Ids
      .map((profileId) => defaultBotProfiles.find((profile) => profile.profileId === profileId))
      .filter((profile) => profile?.specializationCategory === 'network-multiplayer')
      .flatMap((profile) => [...(profile?.incompatibleGameTypes ?? []), ...(profile?.limitations ?? [])])
      .join(' ');
    expect(networkText).toContain('public matchmaking');
    expect(networkText).toContain('anti-cheat');
  });
});
