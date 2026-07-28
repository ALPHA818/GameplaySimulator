import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CustomBotProfileSchema,
  GameProfileSchema
} from '@core/types';
import {
  createDefaultWorkspaceData,
  WorkspaceDataSchema
} from '@core/config/workspaceData';
import { WorkspaceRepository } from '../../apps/desktop/src/main/services/WorkspaceRepository';

describe('release E2E: workspace persistence', () => {
  it('reloads custom game and bot profiles after recreating the repository', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'gameplay-simulator-e2e-workspace-'));
    const gameProfile = GameProfileSchema.parse({
      gameId: 'release-workspace-game',
      gameName: 'Release Workspace Game',
      version: '1.0.0',
      engine: { type: 'browser' },
      launch: {
        platform: 'browser',
        url: 'http://127.0.0.1:4173',
        arguments: []
      },
      adapter: {
        type: 'browser',
        supportsMultipleInstances: true,
        supportsStateRead: true,
        supportsDirectActions: true,
        supportsScreenshots: true,
        supportsVideo: false,
        supportsSaveIsolation: false
      }
    });
    const botProfile = CustomBotProfileSchema.parse({
      profileId: 'release-workspace-bot',
      displayName: 'Release Workspace Bot',
      botType: 'custom',
      profileGroup: 'custom',
      specializationCategory: 'gameplay-systems',
      description: 'Tests the release workspace persistence path.',
      requiredCapabilities: ['state-read'],
      recommendedGameTypes: ['browser'],
      preferredActions: ['move-forward'],
      avoidedActions: [],
      targetScenes: [],
      targetFeatures: ['workspace persistence'],
      targetIssueCategories: [],
      successCriteria: ['The profile reloads after repository recreation.'],
      limitations: [],
      goals: [],
      recommendedMinCount: 1,
      recommendedMaxCount: 1,
      defaultResourceWeight: 'light',
      defaultEnabled: false,
      tags: ['release-e2e'],
      config: {}
    });

    try {
      const repository = new WorkspaceRepository(userDataDirectory);
      repository.save(WorkspaceDataSchema.parse({
        ...createDefaultWorkspaceData(),
        gameProfiles: [gameProfile],
        customBotProfiles: [botProfile]
      }));

      const reloaded = new WorkspaceRepository(userDataDirectory).load();

      expect(reloaded.warning).toBeUndefined();
      expect(reloaded.data.gameProfiles).toEqual([gameProfile]);
      expect(reloaded.data.customBotProfiles).toEqual([botProfile]);
    } finally {
      await rm(userDataDirectory, { recursive: true, force: true });
    }
  });
});
