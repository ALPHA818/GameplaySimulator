import { defaultBotProfiles } from '@core/bot/defaultBotProfiles';
import {
  WORKSPACE_SCHEMA_VERSION,
  WorkspaceDataSchema,
  type WorkspaceData
} from '@core/config/workspaceData';
import { RuntimeObservationConfigSchema } from '@core/config/runtimeObservationConfig';
import type { BotProfile, GameProfile, SimulationRunConfig } from '@core/types';

export const RUNTIME_OBSERVATION_STORAGE_KEY = 'gameplay-simulator.runtime-observation.v1';

interface WorkspaceConfigState {
  gameProfiles: GameProfile[];
  botProfiles: BotProfile[];
  runConfigs: SimulationRunConfig[];
  lastValidatedRunConfig: SimulationRunConfig | null;
  runtimeObservation: WorkspaceData['runtimeObservation'];
}

interface WorkspaceIssueState {
  reviewedIssueIds: string[];
  falsePositiveIssueIds: string[];
}

type PersistenceHandler = () => void | Promise<void>;
type LegacyStorage = Pick<Storage, 'getItem'>;

let persistenceHandler: PersistenceHandler | null = null;
let persistenceScheduled = false;

function sameProfile(left: BotProfile, right: BotProfile): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

export function createWorkspaceSnapshot(
  config: WorkspaceConfigState,
  issues: WorkspaceIssueState
): WorkspaceData {
  const builtInsById = new Map(defaultBotProfiles.map((profile) => [profile.profileId, profile]));
  const customBotProfiles: BotProfile[] = [];
  const botProfileOverrides: BotProfile[] = [];

  for (const profile of config.botProfiles) {
    const builtIn = builtInsById.get(profile.profileId);
    if (!builtIn) {
      customBotProfiles.push(profile);
    } else if (!sameProfile(profile, builtIn)) {
      botProfileOverrides.push(profile);
    }
  }

  return WorkspaceDataSchema.parse({
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    gameProfiles: config.gameProfiles,
    customBotProfiles,
    botProfileOverrides,
    runConfigs: config.runConfigs,
    lastValidatedRunConfig: config.lastValidatedRunConfig,
    runtimeObservation: config.runtimeObservation,
    reviewedIssueIds: uniqueStrings(issues.reviewedIssueIds),
    falsePositiveIssueIds: uniqueStrings(issues.falsePositiveIssueIds),
    migrations: {
      runtimeObservationLocalStorageImported: true
    }
  });
}

export function mergeBotProfiles(workspace: WorkspaceData): BotProfile[] {
  const profilesById = new Map(
    defaultBotProfiles.map((profile) => [profile.profileId, profile])
  );

  for (const profile of workspace.botProfileOverrides) {
    if (profilesById.has(profile.profileId)) {
      profilesById.set(profile.profileId, profile);
    }
  }

  for (const profile of workspace.customBotProfiles) {
    profilesById.set(profile.profileId, profile);
  }

  return [...profilesById.values()];
}

export function mergeGameProfiles(
  builtInProfiles: GameProfile[],
  workspace: WorkspaceData
): GameProfile[] {
  const profilesById = new Map(
    builtInProfiles.map((profile) => [profile.gameId, profile])
  );

  for (const profile of workspace.gameProfiles) {
    profilesById.set(profile.gameId, profile);
  }

  return [...profilesById.values()];
}

export function migrateLegacyRuntimeObservation(
  workspace: WorkspaceData,
  storage: LegacyStorage | undefined
): { data: WorkspaceData; imported: boolean } {
  if (workspace.migrations.runtimeObservationLocalStorageImported) {
    return { data: workspace, imported: false };
  }

  let runtimeObservation = workspace.runtimeObservation;
  let imported = false;

  if (storage) {
    try {
      const value = storage.getItem(RUNTIME_OBSERVATION_STORAGE_KEY);
      if (value) {
        const result = RuntimeObservationConfigSchema.safeParse(JSON.parse(value));
        if (result.success) {
          runtimeObservation = result.data;
          imported = true;
        }
      }
    } catch {
      // Damaged legacy preferences are ignored; the validated workspace value remains active.
    }
  }

  return {
    data: WorkspaceDataSchema.parse({
      ...workspace,
      runtimeObservation,
      migrations: {
        ...workspace.migrations,
        runtimeObservationLocalStorageImported: true
      }
    }),
    imported
  };
}

export function configureWorkspacePersistence(handler: PersistenceHandler | null): void {
  persistenceHandler = handler;
  persistenceScheduled = false;
}

export function requestWorkspacePersistence(): void {
  if (!persistenceHandler || persistenceScheduled) {
    return;
  }

  persistenceScheduled = true;
  queueMicrotask(() => {
    persistenceScheduled = false;
    void persistenceHandler?.();
  });
}
