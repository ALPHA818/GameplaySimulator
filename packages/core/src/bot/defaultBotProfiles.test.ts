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
  'boundary-breaker-bot'
];

describe('defaultBotProfiles', () => {
  it('defines the expected reusable bot profiles', () => {
    expect(DEFAULT_BOT_PROFILE_IDS).toEqual(expectedIds);
    expect(defaultBotProfiles).toHaveLength(18);
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
    }
  });
});
