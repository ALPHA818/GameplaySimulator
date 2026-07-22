import { z } from 'zod';
import { AdapterTypeSchema, LaunchConfigSchema } from './adapter';
import { BotStatusSchema } from './bot';
import { SaveIsolationModeSchema } from './gameProfile';

export const BrowserVisibleButtonSchema = z.object({
  label: z.string().min(1),
  selector: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  disabled: z.boolean().default(false),
  x: z.number().optional(),
  y: z.number().optional()
});

export const BrowserDomSnapshotSchema = z.object({
  headings: z.array(z.string().min(1)).default([]),
  dialogs: z.array(z.string().min(1)).default([]),
  visibleText: z.array(z.string().min(1)).default([]),
  hasCanvas: z.boolean().default(false),
  canvasCount: z.number().int().min(0).default(0),
  scannedAt: z.string().min(1)
});

export const BrowserUIStateSchema = z.object({
  currentScreen: z.string().min(1).optional(),
  openMenus: z.array(z.string().min(1)).default([]),
  focusedElement: z.string().min(1).optional(),
  visibleButtons: z.array(BrowserVisibleButtonSchema).default([]),
  modalStack: z.array(z.string().min(1)).default([]),
  canStartGame: z.boolean().default(false),
  isInGameplay: z.boolean().default(false),
  isPaused: z.boolean().default(false),
  isLoading: z.boolean().default(false),
  source: z.enum(['hook', 'dom', 'merged']).default('hook'),
  dom: BrowserDomSnapshotSchema.optional()
});

export const GameStateSnapshotSchema = z.object({
  snapshotId: z.string().min(1),
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  gameInstanceId: z.string().min(1),
  botId: z.string().min(1).optional(),
  capturedAt: z.string().min(1),
  tick: z.number().int().min(0).optional(),
  scene: z.string().optional(),
  uiState: BrowserUIStateSchema.optional(),
  state: z.record(z.string(), z.unknown()).default({}),
  metrics: z.record(z.string(), z.number()).default({}),
  screenshotPath: z.string().optional()
});

export const GameActionSchema = z.object({
  actionId: z.string().min(1),
  sessionId: z.string().min(1),
  gameInstanceId: z.string().min(1),
  botId: z.string().min(1),
  type: z.string().min(1),
  target: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  requestedAt: z.string().min(1),
  timeoutMs: z.number().int().positive().optional()
});

export const ActionResultSchema = z.object({
  actionId: z.string().min(1),
  botId: z.string().min(1),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'skipped', 'timed_out']),
  startedAt: z.string().min(1).optional(),
  completedAt: z.string().min(1).optional(),
  durationMs: z.number().min(0).optional(),
  message: z.string().optional(),
  stateSnapshotId: z.string().min(1).optional(),
  issueIds: z.array(z.string().min(1)).default([])
});

export const ActionQualitySchema = z.enum([
  'planned',
  'exploratory',
  'recovery',
  'repeated',
  'risky',
  'random',
  'startup-flow'
]);

export const SaveIsolationRuntimeInfoSchema = z.object({
  mode: SaveIsolationModeSchema,
  profileId: z.string().min(1).optional(),
  sourceSavePath: z.string().min(1).optional(),
  workingSaveRoot: z.string().min(1).optional(),
  isolatedSaveDirectory: z.string().min(1).optional(),
  profileArgumentTemplate: z.string().min(1).optional(),
  resolvedProfileArgument: z.string().min(1).optional(),
  environmentVariableName: z.string().min(1).optional(),
  environmentVariableValue: z.string().min(1).optional(),
  cleanupTempSaves: z.boolean().default(false),
  preserveBotSaves: z.boolean().default(true),
  createdAt: z.string().min(1).optional(),
  copiedFromSource: z.boolean().optional(),
  cleanedUpAt: z.string().min(1).optional(),
  warnings: z.array(z.string()).default([])
});

export const GameInstanceConfigSchema = z.object({
  instanceId: z.string().min(1),
  gameProfileId: z.string().min(1),
  launch: LaunchConfigSchema,
  saveProfileId: z.string().min(1).optional(),
  isolatedSaveDirectory: z.string().min(1).optional(),
  saveIsolation: SaveIsolationRuntimeInfoSchema.optional(),
  maxBots: z.number().int().min(1),
  environment: z.record(z.string(), z.string()).default({})
});

export const ResourceEstimateSchema = z.object({
  cpuPercent: z.number().min(0).max(100),
  ramMb: z.number().min(0),
  gpuPercent: z.number().min(0).max(100).optional(),
  vramMb: z.number().min(0).optional(),
  gameInstanceCount: z.number().int().min(0),
  botCount: z.number().int().min(0),
  confidence: z.enum(['low', 'medium', 'high']),
  notes: z.array(z.string()).default([])
});

export const GameInstanceRuntimeStatusSchema = z.enum([
  'starting',
  'running',
  'stopping',
  'stopped',
  'crashed',
  'unresponsive',
  'failed'
]);

export const GameInstanceResourceUsageSchema = z.object({
  cpuPercent: z.number().min(0).optional(),
  ramMb: z.number().min(0).optional(),
  gpuPercent: z.number().min(0).max(100).optional()
});

export const GameInstanceStatusSchema = z.object({
  instanceId: z.string().min(1),
  gameProfileId: z.string().min(1),
  processId: z.number().int().positive().optional(),
  adapterType: AdapterTypeSchema,
  status: GameInstanceRuntimeStatusSchema,
  assignedBots: z.array(z.string().min(1)).default([]),
  startTime: z.string().min(1),
  lastHeartbeat: z.string().min(1),
  saveProfileId: z.string().min(1).optional(),
  isolatedSaveDirectory: z.string().min(1).optional(),
  saveIsolationMode: SaveIsolationModeSchema.optional(),
  saveIsolationCleanedUp: z.boolean().optional(),
  resourceUsage: GameInstanceResourceUsageSchema.optional()
});

export const BotAllocationSchema = z.object({
  profileId: z.string().min(1),
  requestedCount: z.number().int().min(0),
  recommendedCount: z.number().int().min(0),
  reason: z.string().min(1)
});

const ObservationResourceCostSchema = z.object({
  cpuPercent: z.number().min(0),
  ramMb: z.number().min(0),
  gpuPercent: z.number().min(0).max(100).optional()
});

export const RuntimeObservationEstimateSchema = z.object({
  enabled: z.boolean(),
  totalBotCount: z.number().int().min(0),
  totalRunningGameInstances: z.number().int().min(0),
  requestedVisibleGameInstances: z.number().int().min(0),
  recommendedVisibleGameInstances: z.number().int().min(0),
  backgroundGameInstances: z.number().int().min(0),
  recommendedVisibleWindowLimit: z.number().int().min(0),
  estimatedCpuPercent: z.number().min(0),
  estimatedRamMb: z.number().min(0),
  estimatedGpuPercent: z.number().min(0).max(100).optional(),
  breakdown: z.object({
    headedBrowserWindow: ObservationResourceCostSchema,
    additionalVisibleWindows: ObservationResourceCostSchema,
    actionOverlays: ObservationResourceCostSchema,
    focusTracking: ObservationResourceCostSchema
  })
});

const emptyRuntimeObservationEstimate = {
  enabled: false,
  totalBotCount: 0,
  totalRunningGameInstances: 0,
  requestedVisibleGameInstances: 0,
  recommendedVisibleGameInstances: 0,
  backgroundGameInstances: 0,
  recommendedVisibleWindowLimit: 0,
  estimatedCpuPercent: 0,
  estimatedRamMb: 0,
  breakdown: {
    headedBrowserWindow: { cpuPercent: 0, ramMb: 0 },
    additionalVisibleWindows: { cpuPercent: 0, ramMb: 0 },
    actionOverlays: { cpuPercent: 0, ramMb: 0 },
    focusTracking: { cpuPercent: 0, ramMb: 0 }
  }
};

export const RuntimeViabilityReportSchema = z.object({
  canRun: z.boolean(),
  recommendedTotalBots: z.number().int().min(0),
  recommendedGameInstances: z.number().int().min(0),
  warnings: z.array(z.string()).default([]),
  blockers: z.array(z.string()).default([]),
  estimatedCpuPercent: z.number().min(0),
  estimatedRamMb: z.number().min(0),
  estimatedGpuPercent: z.number().min(0).max(100).optional(),
  botAllocation: z.array(BotAllocationSchema).default([]),
  observation: RuntimeObservationEstimateSchema.default(emptyRuntimeObservationEstimate)
});

export const SessionStatusSchema = z.enum([
  'idle',
  'created',
  'starting',
  'running',
  'paused',
  'stopping',
  'stopped',
  'completed',
  'failed',
  'cancelled'
]);

export const RuntimeBotSnapshotSchema = z.object({
  botId: z.string().min(1),
  profileId: z.string().min(1),
  status: BotStatusSchema,
  gameInstanceId: z.string().min(1).optional(),
  currentGoalId: z.string().min(1).optional(),
  currentGoal: z.string().min(1).optional(),
  lastActionId: z.string().min(1).optional(),
  currentAction: z.string().min(1).optional(),
  actionReason: z.string().min(1).optional(),
  actionQuality: ActionQualitySchema.optional(),
  lastResult: z.string().min(1).optional(),
  nextLikelyAction: z.string().min(1).optional(),
  message: z.string().optional()
});

export type GameStateSnapshot = z.infer<typeof GameStateSnapshotSchema>;
export type BrowserVisibleButton = z.infer<typeof BrowserVisibleButtonSchema>;
export type BrowserDomSnapshot = z.infer<typeof BrowserDomSnapshotSchema>;
export type BrowserUIState = z.infer<typeof BrowserUIStateSchema>;
export type GameAction = z.infer<typeof GameActionSchema>;
export type ActionResult = z.infer<typeof ActionResultSchema>;
export type ActionQuality = z.infer<typeof ActionQualitySchema>;
export type SaveIsolationRuntimeInfo = z.infer<typeof SaveIsolationRuntimeInfoSchema>;
export type GameInstanceConfig = z.infer<typeof GameInstanceConfigSchema>;
export type ResourceEstimate = z.infer<typeof ResourceEstimateSchema>;
export type GameInstanceRuntimeStatus = z.infer<typeof GameInstanceRuntimeStatusSchema>;
export type GameInstanceResourceUsage = z.infer<typeof GameInstanceResourceUsageSchema>;
export type GameInstanceStatus = z.infer<typeof GameInstanceStatusSchema>;
export type BotAllocation = z.infer<typeof BotAllocationSchema>;
export type RuntimeObservationEstimate = z.infer<typeof RuntimeObservationEstimateSchema>;
export type RuntimeViabilityReport = z.infer<typeof RuntimeViabilityReportSchema>;
export type SessionStatus = z.infer<typeof SessionStatusSchema>;
export type RuntimeBotSnapshot = z.infer<typeof RuntimeBotSnapshotSchema>;
