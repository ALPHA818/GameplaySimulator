import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BotPoolConfigSchema,
  BotProfileSchema,
  BotTestDirectiveSchema,
  GameProfileSchema,
  SimulationRunConfigSchema
} from './index';

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
    expect(profile.adapter.browserDomScanMode).toBe('fallback');
    expect(profile.saveIsolation?.mode).toBe('temp-directory');
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

  it('keeps old run configs valid when session observation fields are absent', () => {
    const config = SimulationRunConfigSchema.parse(
      readExampleJson('examples/run-configs/sample-run-config.json')
    );

    expect(config.showBotGameplay).toBeUndefined();
    expect(config.observationMode).toBeUndefined();
    expect(config.directives).toBeUndefined();
    expect(config.technicalTesting).toBeUndefined();
  });

  it('validates explicit technical test safeguards', () => {
    const sample = readExampleJson<Record<string, unknown>>(
      'examples/run-configs/sample-run-config.json'
    );
    const config = SimulationRunConfigSchema.parse({
      ...sample,
      technicalTesting: {
        controlledNetworkTestConfirmed: true,
        saveMigrationTestPaths: ['/tests/saves/version-1'],
        approvedFileTestDirectories: ['/project/runs/file-tests']
      }
    });

    expect(config.technicalTesting).toEqual({
      controlledNetworkTestConfirmed: true,
      saveMigrationTestPaths: ['/tests/saves/version-1'],
      approvedFileTestDirectories: ['/project/runs/file-tests']
    });
  });

  it('validates directives inside a run config', () => {
    const sample = readExampleJson<Record<string, unknown>>(
      'examples/run-configs/sample-run-config.json'
    );
    const directive = BotTestDirectiveSchema.parse({
      directiveId: 'directive-001',
      sessionId: sample.sessionId,
      name: 'Explore the forest',
      description: 'Spend this test looking for paths in the forest.',
      directiveType: 'area',
      directiveMode: 'focus',
      priority: 'high',
      status: 'queued',
      target: {
        allBots: false,
        botIds: [],
        profileIds: ['explorer'],
        gameInstanceIds: []
      },
      actionKeywords: ['move', 'explore'],
      avoidedActionKeywords: ['idle'],
      targetArea: 'Forest',
      successConditions: ['A new forest location is visited.'],
      failureConditions: [],
      steps: [],
      maxActions: 20,
      maxAttempts: 3,
      timeoutMs: 60_000,
      repeatUntilSuccess: false,
      createdAt: '2026-07-22T10:00:00.000Z',
      createdBy: 'user'
    });
    const config = SimulationRunConfigSchema.parse({ ...sample, directives: [directive] });

    expect(config.directives?.[0].target.profileIds).toEqual(['explorer']);
  });

  it('rejects directives assigned to another session', () => {
    const sample = readExampleJson<Record<string, unknown>>(
      'examples/run-configs/sample-run-config.json'
    );

    expect(() =>
      SimulationRunConfigSchema.parse({
        ...sample,
        directives: [
          {
            directiveId: 'directive-001',
            sessionId: 'different-session',
            name: 'Test jump',
            description: 'Try the jump action once.',
            directiveType: 'action',
            directiveMode: 'force-next-valid-action',
            priority: 'normal',
            status: 'queued',
            target: {
              allBots: true,
              botIds: [],
              profileIds: [],
              gameInstanceIds: []
            },
            actionKeywords: ['jump'],
            avoidedActionKeywords: [],
            successConditions: [],
            failureConditions: [],
            steps: [],
            repeatUntilSuccess: false,
            createdAt: '2026-07-22T10:00:00.000Z',
            createdBy: 'user'
          }
        ]
      })
    ).toThrow(/must match the run config/);
  });

  it('validates a bot profile', () => {
    const profile = BotProfileSchema.parse(readExampleJson('examples/bot-profiles/explorer.json'));

    expect(profile.profileId).toBe('explorer');
    expect(profile.profileGroup).toBe('general');
    expect(profile.specializationCategory).toBe('world-simulation');
    expect(profile.beginnerRecommended).toBe(true);
    expect(profile.requiredCapabilities).toContain('movement actions');
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
