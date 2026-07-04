import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BotPoolConfigSchema, BotProfileSchema, GameProfileSchema, SimulationRunConfigSchema } from './index';

function readExampleJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as T;
}

describe('core model schemas', () => {
  it('validates the sample game profile', () => {
    const profile = GameProfileSchema.parse(
      readExampleJson('examples/game-profiles/sample-game-profile.json')
    );

    expect(profile.gameId).toBe('sample-browser-game');
    expect(profile.adapter.supportsScreenshots).toBe(true);
    expect(profile.knownContent.sideQuests).toContain('Side quest');
    expect(profile.knownContent.hiddenAreas).toContain('Hidden area');
  });

  it('validates the sample simulation run config with multiple bot pools', () => {
    const config = SimulationRunConfigSchema.parse(
      readExampleJson('examples/run-configs/sample-run-config.json')
    );

    expect(config.botPools).toHaveLength(3);
    expect(config.botPools[0].maxCount).toBe(20);
  });

  it('validates a bot profile', () => {
    const profile = BotProfileSchema.parse(readExampleJson('examples/bot-profiles/explorer.json'));

    expect(profile.profileId).toBe('explorer');
    expect(profile.goals[0].targetIssueCategories).toContain('navigation');
  });

  it('rejects bot pools whose desired count is outside the configured range', () => {
    expect(() =>
      BotPoolConfigSchema.parse({
        profileId: 'explorer',
        enabled: true,
        minCount: 2,
        desiredCount: 1,
        maxCount: 20,
        scalingMode: 'auto',
        priority: 10,
        resourceWeight: 'medium'
      })
    ).toThrow();
  });
});
