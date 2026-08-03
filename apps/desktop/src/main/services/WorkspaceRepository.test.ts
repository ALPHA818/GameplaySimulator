import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultRuntimeObservationConfig } from '@core/config/runtimeObservationConfig';
import {
  createDefaultWorkspaceData,
  WorkspaceDataSchema
} from '@core/config/workspaceData';
import { GameProfileSchema, SimulationRunConfigSchema } from '@core/types';
import { WorkspaceRepository } from './WorkspaceRepository';

const gameProfile = GameProfileSchema.parse({
  gameId: 'workspace-game',
  gameName: 'Workspace Game',
  version: '1.0.0',
  engine: { type: 'browser' },
  launch: {
    platform: 'browser',
    url: 'http://localhost:5173',
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

const runConfig = SimulationRunConfigSchema.parse({
  sessionId: 'workspace-session',
  gameProfilePath: 'memory://game-profiles/workspace-game',
  adapterType: 'browser',
  runMode: 'sequential',
  runUntilStopped: false,
  maxRuntimeMinutes: 5,
  stopOnCriticalIssue: true,
  saveScreenshots: true,
  saveVideo: false,
  saveActionTimeline: true,
  saveStateSnapshots: false,
  botPools: [{
    profileId: 'ui-tester-bot',
    enabled: true,
    minCount: 1,
    desiredCount: 1,
    maxCount: 1,
    scalingMode: 'fixed',
    priority: 10,
    resourceWeight: 'light'
  }],
  globalBotLimit: 1,
  perGameInstanceBotLimit: 1,
  actionDelayMs: 650,
  maxActionsPerBot: 20,
  resourceLimits: {
    maxCpuPercent: 70,
    maxRamPercent: 70,
    reserveRamMb: 2048,
    maxGameInstances: 1,
    allowAutoScaling: false
  }
});

describe('WorkspaceRepository', () => {
  it('persists profiles, run configurations, settings, and review state across repository restarts', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'gameplay-simulator-workspace-'));
    const repository = new WorkspaceRepository(userData);
    const workspace = WorkspaceDataSchema.parse({
      ...createDefaultWorkspaceData(),
      gameProfiles: [gameProfile],
      runConfigs: [runConfig],
      lastValidatedRunConfig: runConfig,
      runtimeObservation: {
        ...defaultRuntimeObservationConfig,
        showBotGameplay: true,
        observationMode: 'follow-first-bot'
      },
      reviewedIssueIds: ['issue-001'],
      falsePositiveIssueIds: ['issue-002'],
      migrations: {
        runtimeObservationLocalStorageImported: true
      }
    });

    repository.save(workspace);
    const restarted = new WorkspaceRepository(userData).load();

    expect(restarted.warning).toBeUndefined();
    expect(restarted.data.gameProfiles).toEqual([gameProfile]);
    expect(restarted.data.runConfigs).toEqual([runConfig]);
    expect(restarted.data.lastValidatedRunConfig).toEqual(runConfig);
    expect(restarted.data.runtimeObservation.showBotGameplay).toBe(true);
    expect(restarted.data.reviewedIssueIds).toEqual(['issue-001']);
    expect(restarted.data.falsePositiveIssueIds).toEqual(['issue-002']);
  });

  it('updates validated data while retaining a valid backup', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'gameplay-simulator-workspace-update-'));
    const repository = new WorkspaceRepository(userData);
    repository.save(createDefaultWorkspaceData());

    const updated = repository.update({
      gameProfiles: [gameProfile],
      reviewedIssueIds: ['issue-updated']
    });
    const backupFiles = await readdir(repository.backupsDirectory);

    expect(updated.gameProfiles).toEqual([gameProfile]);
    expect(updated.reviewedIssueIds).toEqual(['issue-updated']);
    expect(backupFiles.some((name) => name.startsWith('workspace-v1-backup-'))).toBe(true);
  });

  it('retains only the newest approved workspace backups', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'gameplay-simulator-workspace-retention-'));
    const repository = new WorkspaceRepository(userData, { maxBackups: 2 });

    repository.save(createDefaultWorkspaceData());
    for (let index = 0; index < 6; index += 1) {
      repository.save(WorkspaceDataSchema.parse({
        ...createDefaultWorkspaceData(),
        reviewedIssueIds: [`issue-${index}`]
      }));
    }

    const backups = (await readdir(repository.backupsDirectory))
      .filter((name) => name.startsWith('workspace-v1-backup-'));
    expect(backups).toHaveLength(2);
  });

  it('preserves corrupt data and restores the newest valid backup', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'gameplay-simulator-workspace-recovery-'));
    const repository = new WorkspaceRepository(userData);
    repository.save(createDefaultWorkspaceData());
    repository.save(WorkspaceDataSchema.parse({
      ...createDefaultWorkspaceData(),
      gameProfiles: [gameProfile]
    }));
    repository.createBackup();
    await writeFile(repository.workspacePath, '{not-valid-json', 'utf8');

    const recovered = new WorkspaceRepository(userData).load();
    const files = await readdir(repository.backupsDirectory);
    const savedWorkspace = JSON.parse(await readFile(repository.workspacePath, 'utf8')) as unknown;

    expect(recovered.recoveredFromBackup).toBe(true);
    expect(recovered.warning).toContain('damaged file was preserved');
    expect(recovered.data.gameProfiles).toEqual([gameProfile]);
    expect(files.some((name) => name.startsWith('workspace-v1-corrupt-'))).toBe(true);
    expect(WorkspaceDataSchema.safeParse(savedWorkspace).success).toBe(true);
  });

  it('loads safe defaults when both the workspace and all backups are invalid', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'gameplay-simulator-workspace-defaults-'));
    const repository = new WorkspaceRepository(userData);
    repository.save(createDefaultWorkspaceData());
    await writeFile(repository.workspacePath, '{broken', 'utf8');
    const backupPath = join(repository.backupsDirectory, 'workspace-v1-backup-broken.json');
    await writeFile(backupPath, '{"schemaVersion":999}', 'utf8');

    const recovered = repository.load();

    expect(recovered.recoveredFromBackup).toBe(false);
    expect(recovered.warning).toContain('safe defaults');
    expect(recovered.data).toEqual(createDefaultWorkspaceData());
  });

  it('rejects duplicate game, bot-profile, and saved run configuration IDs', () => {
    expect(() =>
      WorkspaceDataSchema.parse({
        ...createDefaultWorkspaceData(),
        gameProfiles: [gameProfile, { ...gameProfile }]
      })
    ).toThrow(/Game profile IDs must be unique/);

    const customBot = {
      profileId: 'custom-workspace-bot',
      displayName: 'Custom Workspace Bot',
      botType: 'custom',
      profileGroup: 'custom' as const,
      goals: [],
      recommendedMinCount: 1,
      recommendedMaxCount: 1,
      defaultResourceWeight: 'light' as const,
      tags: [],
      config: {}
    };
    expect(() =>
      WorkspaceDataSchema.parse({
        ...createDefaultWorkspaceData(),
        customBotProfiles: [customBot, { ...customBot }]
      })
    ).toThrow(/bot profile.*IDs must be unique/i);

    expect(() =>
      WorkspaceDataSchema.parse({
        ...createDefaultWorkspaceData(),
        runConfigs: [runConfig, { ...runConfig }]
      })
    ).toThrow(/run configuration IDs must be unique/i);
  });
});
