import { z } from 'zod';
import { BotProfileSchema } from '../types/bot';
import { GameProfileSchema } from '../types/gameProfile';
import { SimulationRunConfigSchema } from '../types/simulationRunConfig';
import {
  defaultRuntimeObservationConfig,
  RuntimeObservationConfigSchema
} from './runtimeObservationConfig';

export const WORKSPACE_SCHEMA_VERSION = 1 as const;

export const WorkspaceMigrationStateSchema = z.object({
  runtimeObservationLocalStorageImported: z.boolean().default(false)
});

function addDuplicateIssues(
  values: readonly string[],
  path: string,
  message: string,
  context: z.RefinementCtx
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: 'custom',
        path: [path, index],
        message
      });
    }
    seen.add(value);
  });
}

const WorkspaceDataBaseSchema = z.object({
    schemaVersion: z.literal(WORKSPACE_SCHEMA_VERSION),
    gameProfiles: z.array(GameProfileSchema).default([]),
    customBotProfiles: z.array(BotProfileSchema).default([]),
    botProfileOverrides: z.array(BotProfileSchema).default([]),
    runConfigs: z.array(SimulationRunConfigSchema).default([]),
    lastValidatedRunConfig: SimulationRunConfigSchema.nullable().default(null),
    runtimeObservation: RuntimeObservationConfigSchema.default(defaultRuntimeObservationConfig),
    reviewedIssueIds: z.array(z.string().min(1)).default([]),
    falsePositiveIssueIds: z.array(z.string().min(1)).default([]),
    migrations: WorkspaceMigrationStateSchema.default({
      runtimeObservationLocalStorageImported: false
    })
  });

export const WorkspaceDataSchema = WorkspaceDataBaseSchema.superRefine((workspace, context) => {
    addDuplicateIssues(
      workspace.gameProfiles.map((profile) => profile.gameId),
      'gameProfiles',
      'Game profile IDs must be unique.',
      context
    );
    addDuplicateIssues(
      [
        ...workspace.customBotProfiles.map((profile) => profile.profileId),
        ...workspace.botProfileOverrides.map((profile) => profile.profileId)
      ],
      'customBotProfiles',
      'Custom bot profile and override IDs must be unique.',
      context
    );
    addDuplicateIssues(
      workspace.runConfigs.map((config) => config.sessionId),
      'runConfigs',
      'Saved run configuration IDs must be unique.',
      context
    );
  });

export const WorkspaceDataPatchSchema = WorkspaceDataBaseSchema
  .omit({ schemaVersion: true })
  .partial();

export const WorkspaceLoadResultSchema = z.object({
  data: WorkspaceDataSchema,
  warning: z.string().min(1).optional(),
  recoveredFromBackup: z.boolean().default(false)
});

export type WorkspaceData = z.infer<typeof WorkspaceDataSchema>;
export type WorkspaceDataPatch = z.infer<typeof WorkspaceDataPatchSchema>;
export type WorkspaceLoadResult = z.infer<typeof WorkspaceLoadResultSchema>;

export function createDefaultWorkspaceData(): WorkspaceData {
  return WorkspaceDataSchema.parse({
    schemaVersion: WORKSPACE_SCHEMA_VERSION
  });
}
