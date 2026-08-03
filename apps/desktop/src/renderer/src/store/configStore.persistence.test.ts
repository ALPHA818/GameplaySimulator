// @vitest-environment jsdom

import { defaultRuntimeObservationConfig } from '@core/config/runtimeObservationConfig';
import { createDefaultWorkspaceData, type WorkspaceData } from '@core/config/workspaceData';
import { defaultBotProfiles } from '@core/bot/defaultBotProfiles';
import { SimulationRunConfigSchema } from '@core/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  builtInGameProfiles,
  loadRuntimeObservationPreference,
  RUNTIME_OBSERVATION_STORAGE_KEY,
  useConfigStore
} from './configStore';
import { useSessionStore } from './sessionStore';
import {
  configureWorkspacePersistence,
  createWorkspaceSnapshot,
  flushWorkspacePersistence,
  mergeBotProfiles,
  migrateLegacyRuntimeObservation
} from './workspacePersistence';

const savedRunConfig = SimulationRunConfigSchema.parse({
  sessionId: 'persisted-session-config',
  gameProfilePath: 'memory://game-profiles/sample-browser-game',
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

let persistedWorkspace: WorkspaceData | undefined;

async function flushPersistence(): Promise<void> {
  await flushWorkspacePersistence();
}

function resetStores(): void {
  useConfigStore.setState({
    currentPage: 'dashboard',
    editingGameId: null,
    editingBotProfileId: null,
    cloningBotProfileId: null,
    gameProfiles: builtInGameProfiles,
    botProfiles: defaultBotProfiles,
    runConfigs: [],
    lastValidatedRunConfig: null,
    runtimeObservation: defaultRuntimeObservationConfig,
    workspaceHydrated: true,
    workspaceWarning: null
  });
  useSessionStore.setState({
    reviewedIssueIds: [],
    falsePositiveIssueIds: []
  });
}

function restartFrom(workspace: WorkspaceData): void {
  resetStores();
  useSessionStore.getState().hydrateIssueReviewState(
    workspace.reviewedIssueIds,
    workspace.falsePositiveIssueIds
  );
  useConfigStore.getState().hydrateWorkspace(workspace);
}

describe('runtime observation preference persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
    persistedWorkspace = undefined;
    resetStores();
    configureWorkspacePersistence(() => {
      persistedWorkspace = createWorkspaceSnapshot(
        useConfigStore.getState(),
        useSessionStore.getState()
      );
    });
  });

  afterEach(() => {
    configureWorkspacePersistence(null);
    window.localStorage.clear();
    resetStores();
  });

  it('writes updates and restores them through the validated restart loader', () => {
    useConfigStore.getState().updateRuntimeObservation({
      showBotGameplay: true,
      observationMode: 'follow-selected-bot',
      selectedBotId: 'ui-tester-bot-001',
      visibleActionDelayMs: 600,
      maxVisibleGameWindows: 2
    });

    expect(window.localStorage.getItem(RUNTIME_OBSERVATION_STORAGE_KEY)).not.toBeNull();
    const reloaded = loadRuntimeObservationPreference(window.localStorage);

    expect(reloaded).toMatchObject({
      showBotGameplay: true,
      observationMode: 'follow-selected-bot',
      selectedBotId: 'ui-tester-bot-001',
      visibleActionDelayMs: 600,
      maxVisibleGameWindows: 2
    });

    useConfigStore.setState({ runtimeObservation: defaultRuntimeObservationConfig });
    useConfigStore.setState({ runtimeObservation: reloaded });
    expect(useConfigStore.getState().runtimeObservation).toMatchObject({
      showBotGameplay: true,
      observationMode: 'follow-selected-bot',
      selectedBotId: 'ui-tester-bot-001'
    });
  });

  it('returns safe defaults when saved settings are damaged', () => {
    window.localStorage.setItem(RUNTIME_OBSERVATION_STORAGE_KEY, '{bad-json');

    expect(loadRuntimeObservationPreference(window.localStorage)).toEqual(
      defaultRuntimeObservationConfig
    );
  });

  it('imports the legacy observation value once and then trusts the workspace', () => {
    window.localStorage.setItem(
      RUNTIME_OBSERVATION_STORAGE_KEY,
      JSON.stringify({
        ...defaultRuntimeObservationConfig,
        showBotGameplay: true,
        observationMode: 'follow-first-bot'
      })
    );

    const firstMigration = migrateLegacyRuntimeObservation(
      createDefaultWorkspaceData(),
      window.localStorage
    );
    window.localStorage.setItem(
      RUNTIME_OBSERVATION_STORAGE_KEY,
      JSON.stringify(defaultRuntimeObservationConfig)
    );
    const secondMigration = migrateLegacyRuntimeObservation(
      firstMigration.data,
      window.localStorage
    );

    expect(firstMigration.imported).toBe(true);
    expect(firstMigration.data.runtimeObservation.showBotGameplay).toBe(true);
    expect(secondMigration.imported).toBe(false);
    expect(secondMigration.data.runtimeObservation.showBotGameplay).toBe(true);
  });
});

describe('workspace-backed Zustand actions', () => {
  beforeEach(() => {
    window.localStorage.clear();
    persistedWorkspace = undefined;
    resetStores();
    configureWorkspacePersistence(() => {
      persistedWorkspace = createWorkspaceSnapshot(
        useConfigStore.getState(),
        useSessionStore.getState()
      );
    });
  });

  afterEach(() => {
    configureWorkspacePersistence(null);
    resetStores();
  });

  it('creates and edits a game profile that survives hydration after restart', async () => {
    const createdProfile = {
      ...builtInGameProfiles[0],
      gameId: 'persisted-game-profile',
      gameName: 'Persisted Game',
      version: '1.0.0'
    };

    useConfigStore.getState().saveGameProfile(createdProfile);
    await flushPersistence();
    expect(persistedWorkspace?.gameProfiles).toContainEqual(createdProfile);

    useConfigStore.setState({ editingGameId: createdProfile.gameId });
    useConfigStore.getState().saveGameProfile({
      ...createdProfile,
      gameId: 'renamed-persisted-game',
      version: '1.1.0'
    });
    await flushPersistence();

    restartFrom(persistedWorkspace!);
    expect(useConfigStore.getState().gameProfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gameId: 'renamed-persisted-game',
          version: '1.1.0'
        })
      ])
    );
    expect(
      useConfigStore.getState().gameProfiles.some(
        (profile) => profile.gameId === createdProfile.gameId
      )
    ).toBe(false);
  });

  it('persists custom bot profiles and built-in overrides without duplicating built-ins', async () => {
    const builtIn = defaultBotProfiles[0];
    const custom = {
      ...builtIn,
      profileId: 'persisted-custom-bot',
      displayName: 'Persisted Custom Bot',
      botType: 'persisted-custom-bot',
      profileGroup: 'custom' as const,
      defaultEnabled: false
    };
    const override = {
      ...builtIn,
      displayName: `${builtIn.displayName} Edited`
    };

    useConfigStore.getState().saveBotProfile(custom);
    useConfigStore.setState({ editingBotProfileId: builtIn.profileId });
    useConfigStore.getState().saveBotProfile(override);
    await flushPersistence();

    expect(persistedWorkspace?.customBotProfiles).toContainEqual(custom);
    expect(persistedWorkspace?.botProfileOverrides).toContainEqual(override);
    restartFrom(persistedWorkspace!);

    const profiles = useConfigStore.getState().botProfiles;
    expect(profiles.filter((profile) => profile.profileId === builtIn.profileId)).toHaveLength(1);
    expect(profiles.find((profile) => profile.profileId === builtIn.profileId)?.displayName)
      .toBe(override.displayName);
    expect(profiles.some((profile) => profile.profileId === custom.profileId)).toBe(true);
  });

  it('persists saved run configuration and issue review state', async () => {
    useConfigStore.getState().saveRunConfig(savedRunConfig);
    useSessionStore.getState().markIssueReviewed('issue-reviewed');
    useSessionStore.getState().markIssueFalsePositive('issue-false-positive');
    await flushPersistence();

    restartFrom(persistedWorkspace!);

    expect(useConfigStore.getState().runConfigs).toEqual([savedRunConfig]);
    expect(useConfigStore.getState().lastValidatedRunConfig).toEqual(savedRunConfig);
    expect(useSessionStore.getState().reviewedIssueIds).toEqual([
      'issue-reviewed',
      'issue-false-positive'
    ]);
    expect(useSessionStore.getState().falsePositiveIssueIds).toEqual([
      'issue-false-positive'
    ]);
  });

  it('deduplicates a persisted profile that reuses a built-in ID', () => {
    const builtIn = defaultBotProfiles[0];
    const workspace = {
      ...createDefaultWorkspaceData(),
      customBotProfiles: [{
        ...builtIn,
        displayName: `${builtIn.displayName} Override`
      }]
    };
    const merged = mergeBotProfiles(workspace);

    expect(merged.filter((profile) => profile.profileId === builtIn.profileId)).toHaveLength(1);
    expect(merged.find((profile) => profile.profileId === builtIn.profileId)?.displayName)
      .toBe(`${builtIn.displayName} Override`);
  });
});
