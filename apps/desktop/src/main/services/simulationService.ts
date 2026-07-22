import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { z } from 'zod';
import {
  AdapterFactory,
  createAdapterOptionsFromGameProfile,
  DesktopAdapterDependencyChecker
} from '../../../../../packages/adapters/src';
import type {
  AdapterProfileOptionsResult,
  AdapterHealth,
  DesktopAdapterDependencyReport,
  GameAdapter,
  ObservationCapability
} from '../../../../../packages/adapters/src';
import { type BotAdapter, type BotMemory } from '@core/bot/Bot';
import { BotManager } from '@core/bot/BotManager';
import { resolveBotPools } from '@core/bot/BotPoolResolver';
import { defaultBotProfiles } from '@core/bot/defaultBotProfiles';
import type { AvailableGameActionLike, CoverageData } from '@core/bot/ActionPlanner';
import { actionInsightFromAction, plannerMetadataForLog } from '@core/bot/ActionExplanation';
import {
  applyRuntimeObservationToRunConfig,
  defaultRuntimeObservationConfig,
  resolveRuntimeObservationConfig,
  RuntimeObservationConfigSchema,
  type RuntimeObservationConfig
} from '@core/config/runtimeObservationConfig';
import { CoverageTracker, type ContentCoverageSummary } from '@core/coverage/CoverageTracker';
import { IssueDetectionRunner } from '@core/detection/IssueDetectors';
import type { LogEntry } from '@core/logging/LogEntry';
import {
  StructuredRunLogger,
  type BotReportInput,
  type IssueEventLoggerContext,
  type StructuredLogEventType
} from '@core/logging/StructuredLoggers';
import { resourceManager, type SystemResourceSnapshot } from '@core/resources/ResourceManager';
import {
  GameInstanceManager,
  planGameInstances,
  type GameInstanceManagerEvent,
  type GameInstancePlan
} from '@core/sessions/GameInstanceManager';
import type {
  BotLaunchPlan,
  BotProfile,
  ControlBinding,
  GameAction,
  DetectedIssue,
  ActionResult,
  GameInstanceStatus,
  GameProfile,
  GameStateSnapshot,
  RuntimeBotSnapshot,
  RuntimeViabilityReport,
  Severity,
  SimulationRunConfig,
  UIFlow
} from '@core/types';
import {
  BotProfileSchema,
  GameProfileSchema,
  RuntimeViabilityReportSchema,
  SeveritySchema,
  SimulationRunConfigSchema
} from '@core/types';
import {
  SessionRepository,
  type PersistedSessionArtifacts,
  type PersistedSessionMetadata,
  type SessionReportPaths
} from './SessionRepository';
import { EvidenceCaptureService, type EvidenceCaptureResult } from './EvidenceCaptureService';
import {
  RuntimeObservationManager,
  type ObservationSelectionChange
} from './RuntimeObservationManager';

export type SimulationRuntimeStatus =
  | 'idle'
  | 'created'
  | 'starting'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'failed';

export interface SimulationValidationError {
  path: string;
  message: string;
}

export interface SimulationValidationResult {
  valid: boolean;
  errors: SimulationValidationError[];
  warnings: SimulationValidationError[];
}

export interface SimulationSessionRequest {
  runConfig: SimulationRunConfig;
  gameProfile: GameProfile;
  botProfiles?: BotProfile[];
  runtimeObservation?: RuntimeObservationConfig;
}

export interface DesktopControlTestRequest {
  gameProfile: GameProfile;
  controlId?: string;
}

export interface GameProfileTestRequest {
  gameProfile: GameProfile;
  showTestWindow?: boolean;
}

export interface DesktopControlTestResult {
  dependencyReport: DesktopAdapterDependencyReport;
  actionResult: ActionResult;
  controlId?: string;
  binding?: string;
  launched: boolean;
  stopped: boolean;
}

export interface GameProfileTestCapability {
  label: string;
  supported: boolean;
}

export interface GameProfileTestDetectedGame {
  gameId?: string;
  gameName?: string;
  engineType?: string;
  engineVersion?: string;
  buildId?: string;
}

export interface GameProfileTestResult {
  ok: boolean;
  status: 'succeeded' | 'failed' | 'skipped';
  adapterType: string;
  runtimeMode: string;
  message: string;
  errors: SimulationValidationError[];
  warnings: SimulationValidationError[];
  launched: boolean;
  stopped: boolean;
  running?: boolean;
  capabilities: GameProfileTestCapability[];
  health?: AdapterHealth;
  detectedGame?: GameProfileTestDetectedGame;
  availableActions: string[];
  logs: Array<Pick<LogEntry, 'level' | 'message' | 'source'>>;
  screenshotPath?: string;
  stateSummary?: string;
  desktopDependencies?: DesktopAdapterDependencyReport;
  observationCapability: ObservationCapability;
  observationMessage: string;
}

export interface SimulationBotStatus extends RuntimeBotSnapshot {
  displayName: string;
  playstyle: string;
  currentArea: string;
  progressState: string;
  issueCount: number;
  actionCount?: number;
  actionStartedAt?: string;
  currentScreen?: string;
}

export type LiveObservationBadge =
  | 'Watching'
  | 'Running in background'
  | 'Window unavailable'
  | 'Waiting for game';

export interface LiveObservationState {
  sessionId: string;
  badge: LiveObservationBadge;
  observationMode: RuntimeObservationConfig['observationMode'];
  watchedBotId?: string;
  watchedGameInstanceId?: string;
  currentAction?: string;
  actionReason?: string;
  actionStartedAt?: string;
  lastResult?: string;
  currentScene?: string;
  windowStatus: string;
  message: string;
  canFocusWindow: boolean;
}

export interface SimulationSessionStatusSnapshot {
  status: SimulationRuntimeStatus;
  label: string;
  activeSessionId: string | null;
  sessionId?: string;
  createdAt?: string;
  startedAt?: string;
  stoppedAt?: string;
  botCount: number;
  instanceCount: number;
}

export interface SimulationSessionCreateResult {
  sessionId: string;
  status: SimulationSessionStatusSnapshot;
  viabilityReport: RuntimeViabilityReport;
  botStatuses: SimulationBotStatus[];
  instanceStatuses: GameInstanceStatus[];
  logs: LogEntry[];
}

export type { ContentCoverageSummary, PersistedSessionMetadata };

export interface OpenReportResult {
  sessionId: string;
  reportPath: string;
  opened: boolean;
  message: string;
}

export interface OpenLogsResult {
  sessionId: string;
  logsPath: string;
  opened: boolean;
  message: string;
}

export interface OpenEvidenceResult {
  sessionId: string;
  evidencePath: string;
  opened: boolean;
  message: string;
}

export interface OpenSessionPathResult {
  sessionId: string;
  path: string;
  opened: boolean;
  message: string;
}

export interface SessionCleanupOptions {
  sessionId: string;
  deleteRawStateLogs: boolean;
  keepScreenshots: boolean;
  keepSummaries: boolean;
  archiveSessionBundle: boolean;
}

export interface SessionCleanupResult {
  sessionId: string;
  deletedPaths: string[];
  archivePath?: string;
  message: string;
}

export interface ComparisonReportSummary {
  oldTotalIssues: number;
  newTotalIssues: number;
  newIssues: number;
  fixedIssues: number;
  repeatedIssues: number;
  worsenedIssues: number;
  coverageDeltaPercent: number;
  crashFrequencyDelta: number;
}

export interface ComparisonReportResult {
  oldSessionId: string;
  newSessionId: string;
  reportPath: string;
  opened: boolean;
  message: string;
  summary: ComparisonReportSummary;
}

export interface GitHubIssueExportRequest {
  sessionId: string;
  issueIds: string[];
  minimumSeverity: Severity;
  minimumConfidence: number;
}

export interface GitHubIssuePostRequest extends GitHubIssueExportRequest {
  owner: string;
  repo: string;
  token?: string;
  useConfiguredToken: boolean;
  confirmed: boolean;
  labels: string[];
}

export interface GitHubIssuePreviewItem {
  issueId: string;
  title: string;
  severity: Severity;
  category: string;
  confidence?: number;
  body: string;
}

export interface GitHubIssueExportPreviewResult {
  sessionId: string;
  issueCount: number;
  issues: GitHubIssuePreviewItem[];
  combinedMarkdown: string;
}

export interface GitHubIssueMarkdownExportResult {
  sessionId: string;
  issueCount: number;
  exportDirectory: string;
  indexPath: string;
  markdownPaths: string[];
  opened: boolean;
  message: string;
}

export interface GitHubPostedIssue {
  issueId: string;
  title: string;
  number?: number;
  url?: string;
}

export interface GitHubIssuePostResult {
  sessionId: string;
  posted: boolean;
  created: GitHubPostedIssue[];
  failed: Array<{ issueId: string; title: string; message: string }>;
  message: string;
}

export interface StructuredLogItem {
  source: 'session' | 'bot-actions' | 'bot-states' | 'bot-issues' | 'instance';
  botId?: string;
  instanceId?: string;
  eventType?: string;
  timestamp?: string;
  summary: string;
  raw: Record<string, unknown>;
}

export interface StructuredLogReadResult {
  sessionId: string;
  logs: StructuredLogItem[];
}

export interface SimulationServiceOptions {
  now?: () => string;
  reportRoot?: string;
  openPath?: (path: string) => Promise<string>;
  systemSnapshot?: SystemResourceSnapshot;
  adapterFactory?: Pick<AdapterFactory, 'createAdapter'>;
  useMockRuntime?: boolean;
}

const SimulationSessionRequestSchema = z.object({
  runConfig: SimulationRunConfigSchema,
  gameProfile: GameProfileSchema,
  botProfiles: z.array(BotProfileSchema).default([]),
  runtimeObservation: RuntimeObservationConfigSchema.default(defaultRuntimeObservationConfig)
});

const DesktopControlTestRequestSchema = z.object({
  gameProfile: GameProfileSchema,
  controlId: z.string().min(1).optional()
});

const GameProfileTestRequestSchema = z.object({
  gameProfile: GameProfileSchema,
  showTestWindow: z.boolean().default(false)
});

const GitHubIssueExportRequestSchema = z.object({
  sessionId: z.string().min(1),
  issueIds: z.array(z.string().min(1)).default([]),
  minimumSeverity: SeveritySchema.default('warning'),
  minimumConfidence: z.number().min(0).max(1).default(0.75)
});

const GitHubIssuePostRequestSchema = GitHubIssueExportRequestSchema.extend({
  owner: z.string().min(1),
  repo: z.string().min(1),
  token: z.string().optional(),
  useConfiguredToken: z.boolean().default(false),
  confirmed: z.boolean().default(false),
  labels: z.array(z.string().min(1)).default([])
});

const SessionCleanupOptionsSchema = z.object({
  sessionId: z.string().min(1),
  deleteRawStateLogs: z.boolean().default(false),
  keepScreenshots: z.boolean().default(true),
  keepSummaries: z.boolean().default(true),
  archiveSessionBundle: z.boolean().default(false)
});

interface SimulationSessionRecord {
  request: Required<SimulationSessionRequest>;
  viabilityReport: RuntimeViabilityReport;
  status: SimulationRuntimeStatus;
  label: string;
  createdAt: string;
  startedAt?: string;
  stoppedAt?: string;
  botStatuses: SimulationBotStatus[];
  instanceStatuses: GameInstanceStatus[];
  issues: DetectedIssue[];
  logs: LogEntry[];
  tick: number;
  botManager: BotManager;
  issueDetectionRunner: IssueDetectionRunner;
  coverageTracker: CoverageTracker;
  structuredLogger: StructuredRunLogger;
  loggedStateSnapshotIds: Set<string>;
  loggedActionIds: Set<string>;
  loggedIssueIds: Set<string>;
  loggedStartedBotIds: Set<string>;
  loggedStoppedBotIds: Set<string>;
  loggedStartedInstanceIds: Set<string>;
  loggedStoppedInstanceIds: Set<string>;
  loggedRecoveryAttemptIds: Set<string>;
  loggedRecoverySuccessIds: Set<string>;
  loggedRecoveryFailedIds: Set<string>;
  loggedEvidenceKeys: Set<string>;
  loggedFlowStartIds: Set<string>;
  loggedFlowStepActionIds: Set<string>;
  loggedFlowCompletionIds: Set<string>;
  loggedFlowAbandonedIds: Set<string>;
  loggedAdapterLogIds: Set<string>;
  startupFlow?: StartupFlowRuntimeState;
  lastPeriodicScreenshotActionCountByBot: Map<string, number>;
  videoPathsByBot: Map<string, string>;
  evidenceCaptureService: EvidenceCaptureService;
  sessionStartLogged: boolean;
  sessionStopLogged: boolean;
  botAdapter: BotAdapter;
  gameAdapter?: GameAdapter;
  gameInstanceManager?: GameInstanceManager;
  observationManager: RuntimeObservationManager;
  observationWindowStatus?: string;
  useMockRuntime: boolean;
  persisted: boolean;
  persistedCoverageSummary?: ContentCoverageSummary;
  finalizing?: boolean;
  startupTimer?: NodeJS.Timeout;
  startupFlowTimeoutTimer?: NodeJS.Timeout;
  instanceHealthTimer?: NodeJS.Timeout;
}

type StartupFlowRuntimeStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'continued';

interface StartupFlowRuntimeState {
  flowId: string;
  flowName: string;
  botId: string;
  status: StartupFlowRuntimeStatus;
  continueOnFailure: boolean;
  timeoutMs: number;
  startedAt?: string;
  completedAt?: string;
  message?: string;
  issueId?: string;
  screenshotPath?: string;
  timeline: Array<Record<string, unknown>>;
  failureHandled?: boolean;
}

function startupFlowTimeoutIsTerminal(status: StartupFlowRuntimeStatus): boolean {
  return ['succeeded', 'failed', 'timed_out', 'continued'].includes(status);
}

function fallbackBotProfiles(runConfig: SimulationRunConfig, botProfiles: BotProfile[]): BotProfile[] {
  const profilesById = new Map(botProfiles.map((profile) => [profile.profileId, profile]));

  for (const pool of runConfig.botPools) {
    if (!profilesById.has(pool.profileId)) {
      profilesById.set(pool.profileId, {
        profileId: pool.profileId,
        displayName: pool.profileId,
        botType: pool.profileId,
        goals: [],
        recommendedMinCount: pool.minCount,
        recommendedMaxCount: Math.max(1, pool.maxCount),
        defaultResourceWeight: pool.resourceWeight,
        tags: [],
        config: {}
      });
    }
  }

  return [...profilesById.values()];
}

function validationErrors(error: z.ZodError): SimulationValidationError[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || 'config',
    message: issue.message
  }));
}

function formatSimulationValidationErrors(errors: SimulationValidationError[]): string {
  return errors.map((error) => `${error.path}: ${error.message}`).join(' ');
}

function createTemporaryDesktopControlRunConfig(gameProfile: GameProfile): SimulationRunConfig {
  return createTemporaryGameProfileTestRunConfig(gameProfile, `desktop-control-test-${Date.now()}`);
}

function createTemporaryGameProfileTestRunConfig(
  gameProfile: GameProfile,
  sessionId = `profile-test-${Date.now()}`
): SimulationRunConfig {
  return {
    sessionId,
    gameProfilePath: `memory://game-profiles/${gameProfile.gameId}`,
    adapterType: gameProfile.adapter.type,
    runMode: 'sequential',
    runUntilStopped: false,
    maxRuntimeMinutes: 1,
    stopOnCriticalIssue: false,
    saveScreenshots: false,
    saveVideo: false,
    saveActionTimeline: false,
    saveStateSnapshots: false,
    botPools: [
      {
        profileId: 'desktop-control-test',
        enabled: true,
        minCount: 1,
        desiredCount: 1,
        maxCount: 1,
        scalingMode: 'fixed',
        priority: 1,
        resourceWeight: 'light'
      }
    ],
    globalBotLimit: 1,
    perGameInstanceBotLimit: 1,
    actionDelayMs: 0,
    maxActionsPerBot: 1,
    resourceLimits: {
      maxCpuPercent: 100,
      maxRamPercent: 100,
      reserveRamMb: 0,
      maxGameInstances: 1,
      allowAutoScaling: false
    }
  };
}

function adapterCapabilitiesForTest(adapter: GameAdapter): GameProfileTestCapability[] {
  return [
    ['Multiple instances', adapter.capabilities.supportsMultipleInstances],
    ['Multiple bots per instance', adapter.capabilities.supportsMultipleBotsPerInstance],
    ['State read', adapter.capabilities.supportsStateRead],
    ['Direct actions', adapter.capabilities.supportsDirectActions],
    ['Keyboard/mouse input', adapter.capabilities.supportsInputSimulation],
    ['Screenshots', adapter.capabilities.supportsScreenshots],
    ['Video', adapter.capabilities.supportsVideo],
    ['Game logs', adapter.capabilities.supportsGameLogs],
    ['Save isolation', adapter.capabilities.supportsSaveIsolation],
    ['Reset', adapter.capabilities.supportsReset],
    ['Checkpoint reload', adapter.capabilities.supportsCheckpointReload],
    ['Live observation', adapter.capabilities.supportsLiveObservation],
    ['Window focus', adapter.capabilities.supportsWindowFocus],
    ['Multiple visible windows', adapter.capabilities.supportsMultipleVisibleWindows]
  ].map(([label, supported]) => ({
    label: String(label),
    supported: Boolean(supported)
  }));
}

function profileTestObservationMessage(
  adapterOptions: AdapterProfileOptionsResult,
  health: AdapterHealth | undefined,
  instanceMetadata: Record<string, unknown> | undefined
): string {
  const healthMessage = health?.details.observationMessage;
  const metadataMessage = instanceMetadata?.observationMessage;

  if (typeof healthMessage === 'string') {
    return healthMessage;
  }

  if (typeof metadataMessage === 'string') {
    return metadataMessage;
  }

  return adapterOptions.observationMessage;
}

function summarizeProfileTestState(state: GameStateSnapshot | null): string | undefined {
  if (!state) {
    return undefined;
  }

  const summary: Record<string, unknown> = {
    scene: state.scene,
    tick: state.tick,
    metrics: state.metrics,
    state: state.state
  };

  return JSON.stringify(summary, null, 2).slice(0, 2000);
}

function detectedGameFromProfileTest(
  gameProfile: GameProfile,
  health: AdapterHealth | undefined,
  instanceMetadata: Record<string, unknown> | undefined
): GameProfileTestDetectedGame {
  const metadataHealth = instanceMetadata?.instrumentationHealth;
  const healthDetails = health?.details ?? {};
  const detected = typeof metadataHealth === 'object' && metadataHealth !== null
    ? metadataHealth as Record<string, unknown>
    : healthDetails;
  const engine = typeof detected.engine === 'object' && detected.engine !== null
    ? detected.engine as Record<string, unknown>
    : undefined;

  return {
    gameId: typeof detected.gameId === 'string' ? detected.gameId : gameProfile.gameId,
    gameName: typeof detected.gameName === 'string' ? detected.gameName : gameProfile.gameName,
    engineType:
      typeof engine?.type === 'string'
        ? engine.type
        : typeof healthDetails.browserType === 'string'
          ? 'browser'
          : gameProfile.engine.type,
    engineVersion: typeof engine?.version === 'string' ? engine.version : gameProfile.engine.version,
    buildId: gameProfile.buildId
  };
}

function failedProfileTestResult(input: {
  gameProfile: GameProfile;
  adapterOptions: AdapterProfileOptionsResult;
  message: string;
  errors?: SimulationValidationError[];
  warnings?: SimulationValidationError[];
  desktopDependencies?: DesktopAdapterDependencyReport;
}): GameProfileTestResult {
  return {
    ok: false,
    status: 'failed',
    adapterType: input.gameProfile.adapter.type,
    runtimeMode: input.adapterOptions.runtimeMode,
    message: input.message,
    errors: input.errors ?? input.adapterOptions.errors,
    warnings: input.warnings ?? input.adapterOptions.warnings,
    launched: false,
    stopped: false,
    capabilities: [],
    observationCapability: input.adapterOptions.observationCapability,
    observationMessage: input.adapterOptions.observationMessage,
    availableActions: [],
    logs: [],
    desktopDependencies: input.desktopDependencies
  };
}

function selectControlBinding(gameProfile: GameProfile, controlId: string | undefined): ControlBinding | undefined {
  if (controlId) {
    const normalized = controlId.trim().toLowerCase();
    return gameProfile.controls.find((binding) =>
      [binding.controlId, binding.action, binding.label]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.trim().toLowerCase() === normalized)
    );
  }

  return gameProfile.controls[0];
}

function cloneStatus(status: GameInstanceStatus): GameInstanceStatus {
  return {
    ...status,
    assignedBots: [...status.assignedBots],
    resourceUsage: status.resourceUsage ? { ...status.resourceUsage } : undefined
  };
}

function playstyleFor(profile: BotProfile | undefined): string {
  if (profile?.playstyle && profile.playstyle.trim().length > 0) {
    return profile.playstyle.trim();
  }

  const configured = profile?.config.playstyle;
  return typeof configured === 'string' && configured.trim().length > 0
    ? configured.trim()
    : profile?.botType ?? 'unknown';
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim().length > 0)))].sort();
}

function safePathSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

const STARTUP_FLOW_BOT_ID = 'startup-flow-001';
const STARTUP_FLOW_PROFILE_ID = 'ui-journey-bot';
const DEFAULT_STARTUP_FLOW_TIMEOUT_MS = 60_000;

function startupFlowFor(gameProfile: GameProfile, runConfig: SimulationRunConfig): UIFlow | undefined {
  if (!runConfig.startupFlowId) {
    return undefined;
  }

  return gameProfile.uiFlows.find((flow) => flow.flowId === runConfig.startupFlowId);
}

function ensureStartupFlowProfile(botProfiles: BotProfile[]): BotProfile[] {
  if (botProfiles.some((profile) => profile.profileId === STARTUP_FLOW_PROFILE_ID)) {
    return botProfiles;
  }

  const defaultProfile = defaultBotProfiles.find((profile) => profile.profileId === STARTUP_FLOW_PROFILE_ID);

  if (!defaultProfile) {
    return botProfiles;
  }

  return [defaultProfile, ...botProfiles];
}

function prependStartupLaunchPlan(
  launchPlans: BotLaunchPlan[],
  startupFlow: UIFlow | undefined,
  sessionId: string
): BotLaunchPlan[] {
  if (!startupFlow) {
    return launchPlans;
  }

  const startupPlan: BotLaunchPlan = {
    botId: STARTUP_FLOW_BOT_ID,
    profileId: STARTUP_FLOW_PROFILE_ID,
    displayName: `Startup Flow: ${startupFlow.name}`,
    playstyle: 'pre-run-ui-setup',
    seed: 1_000_001,
    resourceWeight: 'medium',
    launchIndex: 1
  };

  return [
    {
      ...startupPlan,
      seed: Math.abs(
        Array.from(`${sessionId}:${startupFlow.flowId}`).reduce((hash, char) => {
          hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
          return hash >>> 0;
        }, 2166136261)
      )
    },
    ...launchPlans.map((plan) => ({
      ...plan,
      launchIndex: plan.launchIndex + 1
    }))
  ];
}

function recordPayload(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringPayloadValue(payload: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = payload?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function numberPayloadValue(payload: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = payload?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

const severityRanks: Record<Severity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3
};

interface IssueComparisonGroup {
  fingerprint: string;
  exactFingerprints: string[];
  issues: DetectedIssue[];
  exemplar: DetectedIssue;
  maxSeverity: Severity;
  maxSeverityRank: number;
}

interface BotProgressComparison {
  botId: string;
  profileId: string;
  displayName: string;
  status: string;
  actionCount: number;
  currentArea: string;
  progressState: string;
  issueCount: number;
}

interface ResourceComparisonSnapshot {
  estimatedCpuPercent: number;
  estimatedRamMb: number;
  estimatedGpuPercent?: number;
  currentCpuPercent: number;
  currentRamMb: number;
  currentGpuPercent?: number;
}

interface SessionComparisonData {
  oldRecord: SimulationSessionRecord;
  newRecord: SimulationSessionRecord;
  newIssueGroups: IssueComparisonGroup[];
  fixedIssueGroups: IssueComparisonGroup[];
  repeatedIssuePairs: Array<{ oldGroup: IssueComparisonGroup; newGroup: IssueComparisonGroup }>;
  worsenedIssuePairs: Array<{ oldGroup: IssueComparisonGroup; newGroup: IssueComparisonGroup }>;
  improvedSeverityPairs: Array<{ oldGroup: IssueComparisonGroup; newGroup: IssueComparisonGroup }>;
  coverage: {
    oldSummary: ContentCoverageSummary;
    newSummary: ContentCoverageSummary;
    newlyCovered: string[];
    noLongerCovered: string[];
  };
  botProgress: {
    further: Array<{ oldBot: BotProgressComparison; newBot: BotProgressComparison }>;
    stuckEarlier: Array<{ oldBot: BotProgressComparison; newBot: BotProgressComparison }>;
  };
  performance: {
    oldSnapshot: ResourceComparisonSnapshot;
    newSnapshot: ResourceComparisonSnapshot;
  };
  crashFrequency: {
    oldCount: number;
    newCount: number;
  };
  summary: ComparisonReportSummary;
}

function normalizeFingerprintSegment(value: string | undefined, maxWords = 12): string {
  const normalized = (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(' ');

  return normalized || 'unknown';
}

function issueLocation(issue: DetectedIssue): string {
  return issue.scene ?? issue.area ?? 'unknown';
}

function issueActionPattern(issue: DetectedIssue): string {
  return (issue.lastActions ?? [])
    .slice(-6)
    .map((action) => normalizeFingerprintSegment(action, 6))
    .filter((action) => action !== 'unknown')
    .join('>') || 'no-actions';
}

function issueStateSignature(issue: DetectedIssue): string {
  return normalizeFingerprintSegment(issue.stateSummary, 16);
}

function issueComparableFingerprint(issue: DetectedIssue): string {
  return [
    issue.category,
    normalizeFingerprintSegment(issueLocation(issue), 8),
    normalizeFingerprintSegment(issue.title, 10),
    issueStateSignature(issue),
    issueActionPattern(issue)
  ].join('|');
}

function issueExactFingerprint(issue: DetectedIssue): string {
  return [
    issue.category,
    issue.severity,
    normalizeFingerprintSegment(issueLocation(issue), 8),
    normalizeFingerprintSegment(issue.title, 10),
    issueStateSignature(issue),
    issueActionPattern(issue)
  ].join('|');
}

function markdownEscape(value: unknown): string {
  return String(value ?? '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function markdownTable(headers: string[], rows: string[][], emptyMessage = '_None._'): string {
  if (rows.length === 0) {
    return `${emptyMessage}\n`;
  }

  return [
    `| ${headers.map(markdownEscape).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(markdownEscape).join(' | ')} |`)
  ].join('\n') + '\n';
}

function fencedMarkdown(value: string | undefined, language = ''): string {
  const safe = value?.trim() ? value.trim().replace(/```/g, '`\\`\\`') : 'Not captured';
  return `\`\`\`${language}\n${safe}\n\`\`\``;
}

function formatSignedNumber(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function formatPercent(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)}%` : 'n/a';
}

function formatMegabytes(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)} MB` : 'n/a';
}

function average(values: number[]): number | undefined {
  const finiteValues = values.filter((value) => Number.isFinite(value));

  if (finiteValues.length === 0) {
    return undefined;
  }

  return finiteValues.reduce((total, value) => total + value, 0) / finiteValues.length;
}

function sum(values: number[]): number {
  return values.filter((value) => Number.isFinite(value)).reduce((total, value) => total + value, 0);
}

function fingerprintPreview(fingerprint: string): string {
  return fingerprint.length > 84 ? `${fingerprint.slice(0, 81)}...` : fingerprint;
}

function safeFileStem(value: string): string {
  return safePathSegment(value).slice(0, 96) || 'issue';
}

function areaForTick(tick: number, index: number): string {
  const areas = ['Boot', 'Main Menu', 'Start Area', 'Traversal Loop', 'Interaction Check', 'Results Review'];
  return areas[(tick + index) % areas.length];
}

function pickKnownContent(values: string[] | undefined, fallback: string, index: number): string {
  if (!values || values.length === 0) {
    return fallback;
  }

  return values[Math.abs(index) % values.length];
}

function progressForTick(tick: number, index: number): string {
  const progress = ['Queued', 'Loading', 'Exploring', 'Interacting', 'Recovering', 'Reporting'];
  return progress[(tick + index) % progress.length];
}

function maxConcurrentBotsForHybrid(
  runConfig: SimulationRunConfig,
  viabilityReport: RuntimeViabilityReport,
  launchPlanCount: number
): number | undefined {
  if (runConfig.runMode !== 'hybrid' || launchPlanCount === 0) {
    return undefined;
  }

  const recommendedInstances = Math.max(1, viabilityReport.recommendedGameInstances);
  const perInstanceLimit = Math.max(1, runConfig.perGameInstanceBotLimit);
  const recommendedBots = Math.max(1, viabilityReport.recommendedTotalBots);

  return Math.max(1, Math.min(launchPlanCount, recommendedBots, recommendedInstances * perInstanceLimit));
}

function createGameAdapterForProfile(
  adapterFactory: Pick<AdapterFactory, 'createAdapter'>,
  adapterOptions: AdapterProfileOptionsResult
): GameAdapter {
  const { adapterType, options } = adapterOptions;

  if (['unity', 'godot', 'unreal'].includes(adapterType)) {
    const prefersInstrumentation = adapterOptions.runtimeMode === 'engine-instrumented';
    const delegate = prefersInstrumentation
      ? adapterFactory.createAdapter('instrumented', options)
      : adapterFactory.createAdapter('desktop', options);

    if (adapterType === 'unity') {
      return adapterFactory.createAdapter('unity', {
        ...options,
        unity: {
          ...options.unity,
          delegate
        }
      });
    }

    if (adapterType === 'godot') {
      return adapterFactory.createAdapter('godot', {
        ...options,
        godot: {
          ...options.godot,
          delegate
        }
      });
    }

    return adapterFactory.createAdapter('unreal', {
      ...options,
      unreal: {
        ...options.unreal,
        delegate
      }
    });
  }

  return adapterFactory.createAdapter(adapterType, options);
}

function launchPlansForInstancePlan(plan: GameInstancePlan): BotLaunchPlan[] {
  return plan.instances.flatMap((instance) =>
    instance.assignedBots.map((bot) => ({
      ...bot,
      assignedGameInstanceId: instance.instanceId
    }))
  );
}

class RuntimeAdapterBridge implements BotAdapter {
  constructor(
    private readonly gameAdapter: GameAdapter,
    private readonly sessionId: string,
    private readonly gameProfile: GameProfile,
    private readonly now: () => string
  ) {}

  async getState(instanceId: string, botId: string): Promise<GameStateSnapshot | null> {
    const state = await this.gameAdapter.getState(instanceId, botId);

    if (state) {
      return {
        ...state,
        sessionId: state.sessionId || this.sessionId,
        gameId: state.gameId || this.gameProfile.gameId,
        gameInstanceId: state.gameInstanceId || instanceId,
        botId: state.botId ?? botId
      };
    }

    const running = await this.gameAdapter.isRunning(instanceId).catch(() => false);
    const health = await this.gameAdapter.getHealth(instanceId).catch(() => undefined);

    return {
      snapshotId: `${instanceId}-${botId}-adapter-state-${Date.now()}`,
      sessionId: this.sessionId,
      gameId: this.gameProfile.gameId,
      gameInstanceId: instanceId,
      botId,
      capturedAt: health?.checkedAt ?? this.now(),
      scene: health?.status === 'running' ? 'Adapter Runtime' : 'Adapter Unavailable',
      state: {
        adapterId: this.gameAdapter.id,
        adapterType: this.gameAdapter.adapterType,
        structuredStateAvailable: false,
        processAlive: running,
        processResponsive: health ? !['failed', 'degraded'].includes(health.status) : running,
        adapterHealth: health?.status,
        healthMessage: health?.message
      },
      metrics: {}
    };
  }

  getAvailableActions(instanceId: string, botId: string): Promise<AvailableGameActionLike[]> {
    return this.gameAdapter.getAvailableActions(instanceId, botId);
  }

  performAction(instanceId: string, botId: string, action: GameAction): Promise<ActionResult> {
    return this.gameAdapter.performAction(instanceId, botId, action);
  }
}

class MockBotRuntimeAdapter implements BotAdapter {
  private readonly countsByBot = new Map<string, number>();
  private readonly lastActionByBot = new Map<string, string>();

  constructor(
    private readonly sessionId: string,
    private readonly gameProfile: GameProfile,
    private readonly now: () => string
  ) {}

  async getState(instanceId: string, botId: string): Promise<GameStateSnapshot> {
    const count = this.countsByBot.get(botId) ?? 0;
    const scene = pickKnownContent(
      [...(this.gameProfile.knownContent.scenes ?? []), ...(this.gameProfile.knownContent.locations ?? [])],
      areaForTick(count, botId.length),
      count + botId.length
    );
    const lastAction = this.lastActionByBot.get(botId);
    const state: Record<string, unknown> = {
      scene,
      level: pickKnownContent(this.gameProfile.knownContent.levels, `Level ${Math.max(1, count + 1)}`, count),
      adapterType: this.gameProfile.adapter.type,
      structuredStateAvailable: this.gameProfile.adapter.supportsStateRead,
      mockRuntime: true
    };

    if (lastAction === 'follow-main-objective') {
      state.mainQuest = pickKnownContent(this.gameProfile.knownContent.mainQuests, 'Main objective', count);
      state.quest = state.mainQuest;
    }

    if (lastAction === 'accept-side-quest') {
      state.sideQuest = pickKnownContent(this.gameProfile.knownContent.sideQuests, 'Side quest', count);
      state.quest = state.sideQuest;
      state.npc = pickKnownContent(
        [...(this.gameProfile.knownContent.npcs ?? []), ...(this.gameProfile.knownContent.characters ?? [])],
        'Quest giver',
        count
      );
    }

    if (lastAction === 'turn-in-quest') {
      state.completedQuest = pickKnownContent(this.gameProfile.knownContent.quests, 'Completed quest', count);
    }

    if (lastAction === 'open-settings-menu' || lastAction === 'open-menu' || lastAction === 'random-menu-spam') {
      state.openedMenu = pickKnownContent(this.gameProfile.knownContent.menus, 'Settings menu', count);
    }

    if (lastAction === 'buy-shop-item') {
      state.shop = pickKnownContent(this.gameProfile.knownContent.shops, 'General shop', count);
      state.item = pickKnownContent(this.gameProfile.knownContent.items, 'Shop item', count);
    }

    if (lastAction === 'attack-enemy' || lastAction === 'block-dodge') {
      state.boss = pickKnownContent(this.gameProfile.knownContent.bosses, 'Enemy encounter', count);
    }

    if (lastAction === 'start-minigame') {
      state.minigame = pickKnownContent(this.gameProfile.knownContent.minigames, 'Minigame', count);
    }

    if (lastAction === 'inspect-hidden-area' || lastAction === 'enter-locked-area-early') {
      state.hiddenArea = pickKnownContent(this.gameProfile.knownContent.hiddenAreas, 'Hidden area', count);
    }

    if (lastAction === 'equip-inventory-item') {
      state.item = pickKnownContent(this.gameProfile.knownContent.items, 'Inventory item', count);
      state.collectible = pickKnownContent(this.gameProfile.knownContent.collectibles, 'Collectible', count);
    }

    if (lastAction === 'talk-dialogue-branch' || lastAction === 'speedrun-skip-dialogue') {
      state.dialogueBranch = pickKnownContent(this.gameProfile.knownContent.dialogueBranches, 'Dialogue branch', count);
      state.npc = pickKnownContent(
        [...(this.gameProfile.knownContent.npcs ?? []), ...(this.gameProfile.knownContent.characters ?? [])],
        'Dialogue NPC',
        count
      );
    }

    if (lastAction === 'idle-wait') {
      state.optionalStory = pickKnownContent(this.gameProfile.knownContent.optionalStories, 'Ambient optional story', count);
    }

    if (lastAction === 'load-checkpoint' || lastAction === 'reload-save') {
      state.postGameContent = pickKnownContent(this.gameProfile.knownContent.postGameContent, 'Post-game checkpoint', count);
    }

    if (lastAction === 'boundary-jump-corner') {
      state.position = { x: 12, y: -250, z: 4 };
      state.outOfWorld = true;
    }

    if (lastAction === 'enter-locked-area-early') {
      state.enteredLockedAreaEarly = true;
    }

    if (lastAction === 'buy-shop-item') {
      state.currency = -5;
    }

    return {
      snapshotId: `${botId}-state-${count + 1}`,
      sessionId: this.sessionId,
      gameId: this.gameProfile.gameId,
      gameInstanceId: instanceId,
      botId,
      capturedAt: this.now(),
      tick: count,
      scene,
      state,
      metrics: {
        actionCount: count
      }
    };
  }

  async getAvailableActions(): Promise<AvailableGameActionLike[]> {
    return [
      { actionType: 'follow-main-objective', label: 'Follow Main Objective' },
      { actionType: 'accept-side-quest', label: 'Accept Side Quest' },
      { actionType: 'move-forward', label: 'Move Forward' },
      { actionType: 'inspect-hidden-area', label: 'Inspect Hidden Area' },
      { actionType: 'boundary-jump-corner', label: 'Boundary Jump Corner' },
      { actionType: 'speedrun-skip-dialogue', label: 'Speedrun Skip Dialogue' },
      { actionType: 'random-menu-spam', label: 'Random Menu Spam' },
      { actionType: 'open-settings-menu', label: 'Open Settings Menu' },
      { actionType: 'buy-shop-item', label: 'Buy Shop Item' },
      { actionType: 'attack-enemy', label: 'Attack Enemy' },
      { actionType: 'block-dodge', label: 'Block And Dodge' },
      { actionType: 'turn-in-quest', label: 'Turn In Quest' },
      { actionType: 'start-minigame', label: 'Start Minigame' },
      { actionType: 'idle-wait', label: 'Idle Wait' },
      { actionType: 'equip-inventory-item', label: 'Equip Inventory Item' },
      { actionType: 'talk-dialogue-branch', label: 'Talk Dialogue Branch' },
      { actionType: 'enter-locked-area-early', label: 'Enter Locked Area Early' },
      { actionType: 'spawn-load-effects', label: 'Spawn Load Effects' },
      { actionType: 'save-game', label: 'Save Game' },
      { actionType: 'load-checkpoint', label: 'Load Checkpoint' },
      { actionType: 'wait', label: 'Wait' },
      { actionType: 'close-menu', label: 'Close Menu' },
      { actionType: 'open-menu', label: 'Open Menu' },
      { actionType: 'cancel-back', label: 'Cancel / Back' },
      { actionType: 'move-backward', label: 'Move Backward' },
      { actionType: 'move-random-direction', label: 'Move Random Direction' },
      { actionType: 'jump', label: 'Jump' },
      { actionType: 'interact', label: 'Interact' },
      { actionType: 'reload-checkpoint', label: 'Reload Checkpoint' },
      { actionType: 'restart-level', label: 'Restart Level' },
      { actionType: 'reload-save', label: 'Reload Save' }
    ];
  }

  async performAction(_instanceId: string, botId: string, action: GameAction): Promise<ActionResult> {
    const nextCount = (this.countsByBot.get(botId) ?? 0) + 1;
    this.countsByBot.set(botId, nextCount);
    this.lastActionByBot.set(botId, action.type);

    return {
      actionId: action.actionId,
      botId,
      status: 'succeeded',
      startedAt: action.requestedAt,
      completedAt: this.now(),
      durationMs: 1,
      message: `Mock adapter performed ${action.type}.`,
      issueIds: []
    };
  }
}

class PersistedSessionBotAdapter implements BotAdapter {
  async getState(): Promise<GameStateSnapshot | null> {
    return null;
  }

  async getAvailableActions(): Promise<AvailableGameActionLike[]> {
    return [];
  }

  async performAction(_instanceId: string, botId: string, action: GameAction): Promise<ActionResult> {
    return {
      actionId: action.actionId,
      botId,
      status: 'skipped',
      startedAt: action.requestedAt,
      completedAt: new Date().toISOString(),
      durationMs: 0,
      message: 'Persisted sessions are read-only and cannot perform new game actions.',
      issueIds: []
    };
  }
}

function statusLabel(record: SimulationSessionRecord): string {
  const botCount = record.botStatuses.length;

  if (record.status === 'created') {
    return `Session ready (${botCount} bots)`;
  }

  if (record.status === 'starting') {
    return `Starting ${record.request.runConfig.sessionId}`;
  }

  if (record.status === 'running') {
    if (record.startupFlow && ['pending', 'running'].includes(record.startupFlow.status)) {
      return `Running startup flow "${record.startupFlow.flowName}"`;
    }

    return `Running ${record.request.runConfig.sessionId} (${botCount} bots)`;
  }

  if (record.status === 'paused') {
    return `Paused ${record.request.runConfig.sessionId}`;
  }

  if (record.status === 'stopping') {
    return `Stopping ${record.request.runConfig.sessionId}`;
  }

  if (record.status === 'stopped') {
    return `Stopped ${record.request.runConfig.sessionId}`;
  }

  return `Failed ${record.request.runConfig.sessionId}`;
}

function createIdleSnapshot(): SimulationSessionStatusSnapshot {
  return {
    status: 'idle',
    label: 'No session running',
    activeSessionId: null,
    botCount: 0,
    instanceCount: 0
  };
}

export class SimulationService {
  private readonly sessions = new Map<string, SimulationSessionRecord>();
  private activeSessionId: string | null = null;
  private readonly now: () => string;
  private readonly reportRoot: string;
  private readonly openPath: (path: string) => Promise<string>;
  private readonly systemSnapshot?: SystemResourceSnapshot;
  private readonly adapterFactory: Pick<AdapterFactory, 'createAdapter'>;
  private readonly useMockRuntime: boolean;
  private readonly sessionRepository: SessionRepository;

  constructor(options: SimulationServiceOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.reportRoot = options.reportRoot ?? resolve(process.cwd(), 'runs');
    this.openPath = options.openPath ?? (async () => '');
    this.systemSnapshot = options.systemSnapshot;
    this.adapterFactory = options.adapterFactory ?? new AdapterFactory();
    this.useMockRuntime = options.useMockRuntime ?? false;
    this.sessionRepository = new SessionRepository(this.reportRoot);
    this.loadPersistedSessions();
  }

  validateSessionConfig(payload: unknown): SimulationValidationResult {
    const result = SimulationSessionRequestSchema.safeParse(payload);

    if (!result.success) {
      return {
        valid: false,
        errors: validationErrors(result.error),
        warnings: []
      };
    }

    const useMockRuntime = result.data.runConfig.useMockRuntime ?? this.useMockRuntime;
    const runtimeObservation = resolveRuntimeObservationConfig(
      result.data.runConfig,
      result.data.runtimeObservation
    );
    const adapterOptions = createAdapterOptionsFromGameProfile(
      result.data.gameProfile,
      result.data.runConfig,
      runtimeObservation
    );
    const startupFlowMissing =
      result.data.runConfig.startupFlowId && !startupFlowFor(result.data.gameProfile, result.data.runConfig)
        ? [
            {
              path: 'startupFlowId',
              message: `Startup flow "${result.data.runConfig.startupFlowId}" does not exist on this game profile.`
            }
          ]
        : [];
    const startupFlowEmpty =
      startupFlowFor(result.data.gameProfile, result.data.runConfig)?.steps.length === 0
        ? [
            {
              path: 'startupFlowId',
              message: 'Startup flow must include at least one step before it can be used.'
            }
          ]
        : [];
    const adapterErrors = useMockRuntime ? [] : adapterOptions.errors;
    const errors = [...adapterErrors, ...startupFlowMissing, ...startupFlowEmpty];

    return {
      valid: errors.length === 0,
      errors,
      warnings: useMockRuntime ? [] : adapterOptions.warnings
    };
  }

  estimateViability(payload: unknown): RuntimeViabilityReport {
    const request = SimulationSessionRequestSchema.parse(payload);
    const report = resourceManager.estimateViabilitySync({
      runConfig: request.runConfig,
      gameProfile: request.gameProfile,
      runtimeObservation: request.runtimeObservation,
      systemSnapshot: this.systemSnapshot
    });

    return RuntimeViabilityReportSchema.parse(report);
  }

  listSessions(): PersistedSessionMetadata[] {
    this.loadPersistedSessions();
    const liveMetadata = [...this.sessions.values()].map((record) => this.metadataForRecord(record));
    const byId = new Map(liveMetadata.map((metadata) => [metadata.sessionId, metadata]));

    for (const metadata of this.sessionRepository.listSessions()) {
      if (!byId.has(metadata.sessionId)) {
        byId.set(metadata.sessionId, metadata);
      }
    }

    return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  reloadPersistedSessions(): PersistedSessionMetadata[] {
    this.loadPersistedSessions(true);
    return this.listSessions();
  }

  async getDesktopAdapterDependencies(): Promise<DesktopAdapterDependencyReport> {
    return new DesktopAdapterDependencyChecker().checkDependencies();
  }

  async testGameProfile(payload: unknown): Promise<GameProfileTestResult> {
    const request = GameProfileTestRequestSchema.parse(payload);
    const runConfig = createTemporaryGameProfileTestRunConfig(request.gameProfile);
    const profileTestObservation = RuntimeObservationConfigSchema.parse({
      showBotGameplay: request.showTestWindow,
      observationMode: request.showTestWindow ? 'follow-first-bot' : 'background',
      visibleActionDelayMs: request.showTestWindow ? 250 : 0,
      maxVisibleGameWindows: 1
    });
    const adapterOptions = createAdapterOptionsFromGameProfile(
      request.gameProfile,
      runConfig,
      profileTestObservation
    );
    const usesDesktopRuntime =
      adapterOptions.runtimeMode === 'desktop-window' ||
      adapterOptions.runtimeMode === 'engine-desktop-fallback';
    const desktopDependencies = usesDesktopRuntime
      ? await this.getDesktopAdapterDependencies().catch(() => undefined)
      : undefined;

    if (adapterOptions.errors.length > 0) {
      return failedProfileTestResult({
        gameProfile: request.gameProfile,
        adapterOptions,
        message: formatSimulationValidationErrors(adapterOptions.errors),
        desktopDependencies
      });
    }

    const adapter = createGameAdapterForProfile(this.adapterFactory, adapterOptions);
    const instanceId = 'profile-test-instance';
    const botId = 'profile-test-bot';
    let launched = false;
    let stopped = false;
    let health: AdapterHealth | undefined;
    let running: boolean | undefined;
    let state: GameStateSnapshot | null = null;
    let screenshotPath: string | undefined;
    let instanceMetadata: Record<string, unknown> | undefined;
    let availableActions: string[] = [];
    let logs: Array<Pick<LogEntry, 'level' | 'message' | 'source'>> = [];
    const warnings = [...adapterOptions.warnings];

    try {
      const instance = await adapter.launchInstance({
        instanceId,
        gameProfileId: request.gameProfile.gameId,
        launch: request.gameProfile.launch,
        maxBots: 1,
        environment: {
          GAMEPLAY_SIMULATOR_PROFILE_TEST: '1'
        }
      });
      launched = true;
      instanceMetadata = instance.metadata;

      if (request.showTestWindow && adapter.adapterType === 'browser') {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_500));
      }

      health = await adapter.getHealth(instanceId).catch((error: unknown) => {
        warnings.push({
          path: 'adapter.health',
          message: error instanceof Error ? error.message : 'Adapter health check failed.'
        });
        return undefined;
      });
      running = await adapter.isRunning(instanceId).catch(() => undefined);
      state = await adapter.getState(instanceId, botId).catch((error: unknown) => {
        warnings.push({
          path: 'adapter.state',
          message: error instanceof Error ? error.message : 'State read failed.'
        });
        return null;
      });
      availableActions = (await adapter.getAvailableActions(instanceId, botId).catch((error: unknown) => {
        warnings.push({
          path: 'adapter.actions',
          message: error instanceof Error ? error.message : 'Available action read failed.'
        });
        return [];
      })).map((action) => action.label || action.actionType);

      if (adapter.captureLogs) {
        logs = (await adapter.captureLogs(instanceId).catch((error: unknown) => {
          warnings.push({
            path: 'adapter.logs',
            message: error instanceof Error ? error.message : 'Log capture failed.'
          });
          return [];
        })).slice(-12).map((entry) => ({
          level: entry.level,
          message: entry.message,
          source: entry.source
        }));
      }

      if (adapter.capabilities.supportsScreenshots && adapter.captureScreenshot) {
        const screenshot = await adapter.captureScreenshot(instanceId, botId).catch((error: unknown) => {
          warnings.push({
            path: 'adapter.screenshot',
            message: error instanceof Error ? error.message : 'Screenshot capture failed.'
          });
          return undefined;
        });
        screenshotPath = screenshot?.path;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Profile test failed.';
      const wasLaunched = launched;

      if (launched) {
        await adapter.stopAll().catch(() => undefined);
        stopped = true;
        launched = false;
      }

      return {
        ...failedProfileTestResult({
          gameProfile: request.gameProfile,
          adapterOptions,
          message,
          errors: [{ path: 'adapter.launch', message }],
          warnings,
          desktopDependencies
        }),
        launched: wasLaunched,
        stopped,
        capabilities: adapterCapabilitiesForTest(adapter),
        observationCapability: adapter.capabilities.observationCapability,
        observationMessage: profileTestObservationMessage(adapterOptions, health, instanceMetadata)
      };
    } finally {
      if (launched) {
        await adapter.stopAll().catch(() => undefined);
        stopped = true;
      }
    }

    const instrumentationError =
      typeof instanceMetadata?.instrumentationConnectionError === 'string'
        ? instanceMetadata.instrumentationConnectionError
        : undefined;
    const instrumentationHealth =
      typeof instanceMetadata?.instrumentationHealth === 'object' && instanceMetadata.instrumentationHealth !== null
        ? instanceMetadata.instrumentationHealth as { ok?: boolean; message?: string }
        : undefined;
    const healthOk =
      !instrumentationError &&
      (instrumentationHealth
        ? instrumentationHealth.ok === true
        : !health || ['ready', 'running', 'stopped'].includes(health.status));
    const ok = launched && healthOk;
    const failureMessage =
      instrumentationError ??
      instrumentationHealth?.message ??
      health?.message ??
      'Adapter health is not ready.';

    return {
      ok,
      status: ok ? 'succeeded' : 'failed',
      adapterType: adapter.adapterType,
      runtimeMode: adapterOptions.runtimeMode,
      message: ok
        ? 'Profile test finished. The selected adapter can launch or connect with this setup.'
        : failureMessage,
      errors: ok ? [] : [{ path: 'adapter.health', message: failureMessage }],
      warnings,
      launched,
      stopped,
      running,
      capabilities: adapterCapabilitiesForTest(adapter),
      observationCapability: adapter.capabilities.observationCapability,
      observationMessage: profileTestObservationMessage(adapterOptions, health, instanceMetadata),
      health,
      detectedGame: detectedGameFromProfileTest(request.gameProfile, health, instanceMetadata),
      availableActions,
      logs,
      screenshotPath,
      stateSummary: summarizeProfileTestState(state),
      desktopDependencies
    };
  }

  async testDesktopControl(payload: unknown): Promise<DesktopControlTestResult> {
    const request = DesktopControlTestRequestSchema.parse(payload);
    const dependencyReport = await this.getDesktopAdapterDependencies();
    const runConfig = createTemporaryDesktopControlRunConfig(request.gameProfile);
    const adapterOptions = createAdapterOptionsFromGameProfile(request.gameProfile, runConfig);
    const binding = selectControlBinding(request.gameProfile, request.controlId);
    const startedAt = this.now();
    const instanceId = 'desktop-control-test-instance';
    const botId = 'desktop-control-test-bot';

    if (!binding) {
      return {
        dependencyReport,
        actionResult: {
          actionId: 'desktop-control-test',
          botId,
          status: 'skipped',
          startedAt,
          completedAt: this.now(),
          message: 'No control mapping is available to test.',
          issueIds: []
        },
        launched: false,
        stopped: false
      };
    }

    if (adapterOptions.runtimeMode !== 'desktop-window' && adapterOptions.runtimeMode !== 'engine-desktop-fallback') {
      return {
        dependencyReport,
        actionResult: {
          actionId: `desktop-control-test-${binding.controlId}`,
          botId,
          status: 'skipped',
          startedAt,
          completedAt: this.now(),
          message: 'Control testing is only available for desktop-window adapter or engine desktop fallback profiles.',
          issueIds: []
        },
        controlId: binding.controlId,
        binding: binding.binding,
        launched: false,
        stopped: false
      };
    }

    if (adapterOptions.errors.length > 0) {
      return {
        dependencyReport,
        actionResult: {
          actionId: `desktop-control-test-${binding.controlId}`,
          botId,
          status: 'failed',
          startedAt,
          completedAt: this.now(),
          message: formatSimulationValidationErrors(adapterOptions.errors),
          issueIds: []
        },
        controlId: binding.controlId,
        binding: binding.binding,
        launched: false,
        stopped: false
      };
    }

    const needsKeyboard = binding.inputType === 'keyboard';
    const needsMouse = binding.inputType === 'mouse';

    if ((needsKeyboard && !dependencyReport.canSendKeyboardInput) || (needsMouse && !dependencyReport.canSendMouseInput)) {
      return {
        dependencyReport,
        actionResult: {
          actionId: `desktop-control-test-${binding.controlId}`,
          botId,
          status: 'skipped',
          startedAt,
          completedAt: this.now(),
          message: dependencyReport.warnings.join(' ') || 'Desktop input is not available on this platform.',
          issueIds: []
        },
        controlId: binding.controlId,
        binding: binding.binding,
        launched: false,
        stopped: false
      };
    }

    const adapter = createGameAdapterForProfile(this.adapterFactory, adapterOptions);
    let launched = false;
    let stopped = false;
    let actionResult: ActionResult;

    try {
      await adapter.launchInstance({
        instanceId,
        gameProfileId: request.gameProfile.gameId,
        launch: request.gameProfile.launch,
        maxBots: 1,
        environment: {
          GAMEPLAY_SIMULATOR_CONTROL_TEST: '1'
        }
      });
      launched = true;

      const action: GameAction = {
        actionId: `desktop-control-test-${binding.controlId}`,
        sessionId: runConfig.sessionId,
        gameInstanceId: instanceId,
        botId,
        type: binding.action ?? binding.controlId,
        target: binding.controlId,
        payload: {
          controlId: binding.controlId,
          binding: binding.binding
        },
        requestedAt: this.now()
      };
      actionResult = await adapter.performAction(instanceId, botId, action);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Desktop control test failed.';
      actionResult = {
        actionId: `desktop-control-test-${binding.controlId}`,
        botId,
        status: 'failed',
        startedAt,
        completedAt: this.now(),
        message,
        issueIds: []
      };
    } finally {
      if (launched) {
        await adapter.stopAll().catch(() => undefined);
        stopped = true;
      }
    }

    return {
      dependencyReport,
      actionResult,
      controlId: binding.controlId,
      binding: binding.binding,
      launched,
      stopped
    };
  }

  createSession(payload: unknown): SimulationSessionCreateResult {
    const parsedRequest = SimulationSessionRequestSchema.parse(payload);
    const runtimeObservation = resolveRuntimeObservationConfig(
      parsedRequest.runConfig,
      parsedRequest.runtimeObservation
    );
    const request = {
      ...parsedRequest,
      runConfig: applyRuntimeObservationToRunConfig(parsedRequest.runConfig, runtimeObservation),
      runtimeObservation
    };
    const useMockRuntime = request.runConfig.useMockRuntime ?? this.useMockRuntime;
    const adapterOptions = createAdapterOptionsFromGameProfile(
      request.gameProfile,
      request.runConfig,
      request.runtimeObservation
    );

    if (!useMockRuntime && adapterOptions.errors.length > 0) {
      throw new Error(formatSimulationValidationErrors(adapterOptions.errors));
    }

    const startupFlow = startupFlowFor(request.gameProfile, request.runConfig);

    if (request.runConfig.startupFlowId && !startupFlow) {
      throw new Error(`Startup flow "${request.runConfig.startupFlowId}" does not exist on this game profile.`);
    }

    const botProfiles = startupFlow
      ? ensureStartupFlowProfile(fallbackBotProfiles(request.runConfig, request.botProfiles))
      : fallbackBotProfiles(request.runConfig, request.botProfiles);
    const viabilityReport = this.estimateViability({
      ...request,
      botProfiles
    });
    const resolvedLaunchPlans = resolveBotPools({
      runConfig: request.runConfig,
      botProfiles,
      viabilityReport
    });
    const sessionId = request.runConfig.sessionId;
    const plannedLaunchPlans = prependStartupLaunchPlan(resolvedLaunchPlans, startupFlow, sessionId);
    const createdAt = this.now();
    const profilesById = new Map(botProfiles.map((profile) => [profile.profileId, profile]));
    const gameAdapter = useMockRuntime
      ? undefined
      : createGameAdapterForProfile(this.adapterFactory, adapterOptions);
    const botAdapter: BotAdapter = useMockRuntime
      ? new MockBotRuntimeAdapter(sessionId, request.gameProfile, this.now)
      : new RuntimeAdapterBridge(gameAdapter!, sessionId, request.gameProfile, this.now);
    const gameInstanceManager = gameAdapter
      ? new GameInstanceManager({
          adapter: gameAdapter,
          runConfig: request.runConfig,
          gameProfile: request.gameProfile,
          launchPlans: plannedLaunchPlans,
          fileSystem: { cp, mkdir, rm },
          now: this.now
        })
      : undefined;
    const instancePlan = gameInstanceManager?.getPlan() ?? planGameInstances({
      runConfig: request.runConfig,
      gameProfile: request.gameProfile,
      launchPlans: plannedLaunchPlans,
      adapterCapabilities: {
        supportsMultipleInstances: request.gameProfile.adapter.supportsMultipleInstances,
        supportsMultipleBotsPerInstance:
          request.gameProfile.adapter.type === 'instrumented' ||
          request.gameProfile.adapter.type === 'browser' ||
          request.gameProfile.adapter.supportsDirectActions,
        supportsSaveIsolation: request.gameProfile.adapter.supportsSaveIsolation
      },
      now: this.now()
    });
    const launchPlans = gameInstanceManager?.getAssignedLaunchPlans() ?? launchPlansForInstancePlan(instancePlan);
    const coverageTracker = new CoverageTracker(request.gameProfile);
    const structuredLogger = new StructuredRunLogger({
      rootDir: this.reportRoot,
      sessionId,
      createdAt,
      now: this.now
    });
    const evidenceCaptureService = new EvidenceCaptureService({
      adapter: gameAdapter,
      now: this.now
    });
    let record!: SimulationSessionRecord;
    const botManager = new BotManager({
      sessionId,
      runConfig: request.runConfig,
      launchPlans,
      botProfiles,
      adapter: botAdapter,
      maxConcurrentBots: maxConcurrentBotsForHybrid(request.runConfig, viabilityReport, launchPlans.length),
      getCoverageData: () => this.coverageForRecord(record),
      getRecentIssues: () => this.getIssues(sessionId),
      uiFlows: startupFlow ? [startupFlow] : request.gameProfile.uiFlows,
      getInstanceHeartbeat: (instanceId) =>
        record.instanceStatuses.find((instance) => instance.instanceId === instanceId)?.lastHeartbeat,
      getProcessResponsive: (instanceId) => {
        const status = record.instanceStatuses.find((instance) => instance.instanceId === instanceId)?.status;
        return status ? !['unresponsive', 'crashed', 'failed'].includes(status) : undefined;
      },
      now: this.now,
      onStatusChange: ({ status, memory }) => {
        return this.updateBotStatus(record, status, memory);
      },
      onLog: ({ entry }) => {
        record.logs.push(entry);
      },
      onIdle: () => {
        this.completeSessionIfNoActiveBots(record);
      },
      startupBotIds: startupFlow ? [STARTUP_FLOW_BOT_ID] : undefined,
      continueAfterStartupFailure: request.runConfig.continueOnStartupFlowFailure ?? false
    });

    record = {
      request: {
        runConfig: request.runConfig,
        gameProfile: request.gameProfile,
        botProfiles,
        runtimeObservation: request.runtimeObservation
      },
      viabilityReport,
      status: 'created',
      label: 'Session ready',
      createdAt,
      botStatuses: launchPlans.map((plan) => {
        const profile = profilesById.get(plan.profileId);

        return {
          botId: plan.botId,
          profileId: plan.profileId,
          displayName: plan.displayName,
          playstyle: plan.playstyle || playstyleFor(profile),
          status: 'queued',
          gameInstanceId: plan.assignedGameInstanceId,
          currentGoalId: profile?.goals[0]?.goalId,
          currentGoal: profile?.goals[0]?.name,
          lastActionId: undefined,
          currentArea: 'Queued',
          progressState: 'Queued',
          issueCount: 0,
          message: useMockRuntime ? 'Queued for mock session start.' : 'Queued for adapter-backed session start.'
        };
      }),
      instanceStatuses: instancePlan.instances.map((instance, index) => ({
        ...cloneStatus(instance.status),
        resourceUsage: {
          cpuPercent: 0,
          ramMb: 0,
          gpuPercent: request.runConfig.saveVideo ? 2 + index : undefined
        }
      })),
      issues: [],
      logs: [
        this.createLog(
          sessionId,
          'info',
          `Created ${useMockRuntime ? 'mock' : 'adapter-backed'} session with ${launchPlans.length} bot${launchPlans.length === 1 ? '' : 's'}.`
        )
      ],
      tick: 0,
      botManager,
      issueDetectionRunner: new IssueDetectionRunner(),
      coverageTracker,
      structuredLogger,
      loggedStateSnapshotIds: new Set(),
      loggedActionIds: new Set(),
      loggedIssueIds: new Set(),
      loggedStartedBotIds: new Set(),
      loggedStoppedBotIds: new Set(),
      loggedStartedInstanceIds: new Set(),
      loggedStoppedInstanceIds: new Set(),
      loggedRecoveryAttemptIds: new Set(),
      loggedRecoverySuccessIds: new Set(),
      loggedRecoveryFailedIds: new Set(),
      loggedEvidenceKeys: new Set(),
      loggedFlowStartIds: new Set(),
      loggedFlowStepActionIds: new Set(),
      loggedFlowCompletionIds: new Set(),
      loggedFlowAbandonedIds: new Set(),
      loggedAdapterLogIds: new Set(),
      startupFlow: startupFlow
        ? {
            flowId: startupFlow.flowId,
            flowName: startupFlow.name,
            botId: STARTUP_FLOW_BOT_ID,
            status: 'pending',
            continueOnFailure: request.runConfig.continueOnStartupFlowFailure ?? false,
            timeoutMs: request.runConfig.startupFlowTimeoutMs ?? DEFAULT_STARTUP_FLOW_TIMEOUT_MS,
            timeline: []
          }
        : undefined,
      lastPeriodicScreenshotActionCountByBot: new Map(),
      videoPathsByBot: new Map(),
      evidenceCaptureService,
      sessionStartLogged: false,
      sessionStopLogged: false,
      botAdapter,
      gameAdapter,
      gameInstanceManager,
      observationManager: new RuntimeObservationManager(request.runtimeObservation),
      useMockRuntime,
      persisted: false
    };

    record.structuredLogger.writeConfig({
      runConfig: request.runConfig,
      gameProfile: request.gameProfile
    });
    record.structuredLogger.writeViabilityReport(viabilityReport);
    for (const bot of record.botStatuses) {
      record.structuredLogger.ensureBot(bot.botId);
      const profile = profilesById.get(bot.profileId);
      record.coverageTracker.registerBot(bot.botId, profile ?? bot.profileId);
    }
    for (const instance of record.instanceStatuses) {
      record.structuredLogger.ensureInstance(instance.instanceId);
    }
    for (const warning of viabilityReport.warnings) {
      record.structuredLogger.logSession('resource_warning', { warning });
    }
    for (const warning of instancePlan.warnings) {
      record.logs.push(this.createLog(sessionId, 'warn', warning));
      record.structuredLogger.logSession('resource_warning', { warning, source: 'game-instance-plan' });
    }
    this.writeStructuredReports(record);

    record.label = statusLabel(record);
    this.clearSessionTimer(sessionId);
    this.sessions.set(sessionId, record);
    this.activeSessionId = sessionId;

    return {
      sessionId,
      status: this.snapshotFor(record),
      viabilityReport,
      botStatuses: this.getBotStatuses(sessionId),
      instanceStatuses: record.instanceStatuses.map(cloneStatus),
      logs: this.getLogs(sessionId)
    };
  }

  async startSession(sessionId: string): Promise<SimulationSessionStatusSnapshot> {
    const record = this.requireSession(sessionId);

    if (record.viabilityReport.blockers.length > 0) {
      record.status = 'failed';
      record.logs.push(this.createLog(sessionId, 'error', 'Session cannot start because viability blockers remain.'));
      record.label = statusLabel(record);
      return this.snapshotFor(record);
    }

    if (record.useMockRuntime) {
      return this.startMockSession(record);
    }

    this.activeSessionId = sessionId;
    record.status = 'starting';
    record.startedAt = record.startedAt ?? this.now();
    record.stoppedAt = undefined;
    record.botStatuses = record.botStatuses.map((bot) => ({
      ...bot,
      status: bot.status === 'stopped' ? 'stopped' : 'starting',
      currentArea: bot.status === 'stopped' ? bot.currentArea : 'Boot',
      progressState: bot.status === 'stopped' ? bot.progressState : 'Starting',
      message: bot.status === 'stopped' ? bot.message : 'Waiting for game adapter launch.'
    }));
    record.instanceStatuses = record.instanceStatuses.map((instance) => ({
      ...instance,
      status: 'starting',
      lastHeartbeat: this.now()
    }));
    record.logs.push(this.createLog(sessionId, 'info', `Starting adapter-backed simulation session with ${record.request.runConfig.adapterType}.`));
    record.label = statusLabel(record);
    this.logSessionStart(record);
    this.writeStructuredReports(record);

    this.clearSessionTimer(sessionId);

    try {
      if (!record.gameInstanceManager) {
        throw new Error('Adapter-backed session is missing a game instance manager.');
      }

      record.instanceStatuses = await record.gameInstanceManager.startAllInstances();
      this.logInstanceManagerEvents(record);

      record.status = 'running';
      record.botStatuses = record.botStatuses.map((bot) => ({
        ...bot,
        status:
          bot.status === 'stopped'
            ? 'stopped'
            : record.startupFlow && bot.botId !== record.startupFlow.botId
              ? 'queued'
              : 'running',
        currentArea: bot.status === 'stopped' ? bot.currentArea : 'Adapter Runtime',
        progressState:
          bot.status === 'stopped'
            ? bot.progressState
            : record.startupFlow && bot.botId !== record.startupFlow.botId
              ? 'Waiting for startup flow'
              : 'Running',
        message:
          bot.status === 'stopped'
            ? bot.message
            : record.startupFlow && bot.botId !== record.startupFlow.botId
              ? `Waiting for startup flow "${record.startupFlow.flowName}".`
              : 'Bot runtime is using the selected game adapter.'
      }));
      record.logs.push(
        this.createLog(
          sessionId,
          'info',
          record.startupFlow
            ? `Game adapter instances are running; starting startup flow "${record.startupFlow.flowName}".`
            : 'Game adapter instances are running; starting bot runtime loops.'
        )
      );
      record.label = statusLabel(record);
      for (const instance of record.instanceStatuses) {
        this.logInstanceStart(record, instance);
      }
      this.startInstanceHealthMonitor(record);
      this.startVideoEvidence(record);
      this.writeStructuredReports(record);
      this.startStartupFlowTimeout(record);
      record.botManager.startAll();
    } catch (error) {
      await this.failAdapterStartup(record, error);
    }

    return this.snapshotFor(record);
  }

  async stopSession(sessionId: string): Promise<SimulationSessionStatusSnapshot> {
    const record = this.requireSession(sessionId);
    const wasStopped = record.status === 'stopped';
    const runtimeKind = record.useMockRuntime ? 'mock' : 'adapter-backed';

    record.status = 'stopping';
    record.label = statusLabel(record);
    record.logs.push(this.createLog(sessionId, 'info', `Stopping ${runtimeKind} simulation session.`));
    this.clearSessionTimer(sessionId);
    record.botManager.stopAll();

    if (!wasStopped) {
      record.structuredLogger.logSession('manual_stop', {
        scope: 'session',
        reason: 'Stop Session requested from UI or backend API.'
      });
    }

    await this.stopGameInstances(record, 'manual_stop');

    record.status = 'stopped';
    record.stoppedAt = this.now();
    record.botStatuses = record.botStatuses.map((bot) => ({
      ...bot,
      status: 'stopped',
      progressState: 'Stopped',
      message: `${record.useMockRuntime ? 'Mock' : 'Adapter-backed'} session stopped.`
    }));
    record.logs.push(this.createLog(sessionId, 'info', `${record.useMockRuntime ? 'Mock' : 'Adapter-backed'} simulation stopped.`));
    record.label = statusLabel(record);
    this.logSessionStop(record, 'manual_stop');
    this.stopVideoEvidence(record);
    this.writeStructuredReports(record);

    return this.snapshotFor(record);
  }

  pauseSession(sessionId: string): SimulationSessionStatusSnapshot {
    const record = this.requireSession(sessionId);

    if (record.status !== 'running') {
      return this.snapshotFor(record);
    }

    this.clearSessionTimer(sessionId);
    record.botManager.pauseAll();
    record.status = 'paused';
    const runtimeKind = record.useMockRuntime ? 'Mock' : 'Adapter-backed';
    record.botStatuses = record.botStatuses.map((bot) => ({
      ...bot,
      status: bot.status === 'stopped' ? 'stopped' : 'waiting',
      progressState: bot.status === 'stopped' ? bot.progressState : 'Paused',
      message: bot.status === 'stopped' ? bot.message : `${runtimeKind} session paused.`
    }));
    record.logs.push(this.createLog(sessionId, 'info', `${runtimeKind} simulation paused.`));
    record.label = statusLabel(record);

    return this.snapshotFor(record);
  }

  resumeSession(sessionId: string): SimulationSessionStatusSnapshot {
    const record = this.requireSession(sessionId);

    if (record.status !== 'paused') {
      return this.snapshotFor(record);
    }

    record.status = 'running';
    const runtimeKind = record.useMockRuntime ? 'Mock' : 'Adapter-backed';
    record.botStatuses = record.botStatuses.map((bot) => ({
      ...bot,
      status: ['stopped', 'completed', 'failed'].includes(bot.status) ? bot.status : 'running',
      progressState: ['stopped', 'completed', 'failed'].includes(bot.status) ? bot.progressState : 'Running',
      message: ['stopped', 'completed', 'failed'].includes(bot.status) ? bot.message : `${runtimeKind} session resumed.`
    }));
    record.instanceStatuses = record.instanceStatuses.map((instance) => ({
      ...instance,
      status: 'running',
      lastHeartbeat: this.now()
    }));
    record.logs.push(this.createLog(sessionId, 'info', `${runtimeKind} simulation resumed.`));
    record.label = statusLabel(record);
    record.botManager.resumeAll();

    return this.snapshotFor(record);
  }

  getStatus(): SimulationSessionStatusSnapshot {
    if (!this.activeSessionId) {
      return createIdleSnapshot();
    }

    const record = this.sessions.get(this.activeSessionId);
    return record ? this.snapshotFor(record) : createIdleSnapshot();
  }

  getSessionStatus(sessionId?: string): SimulationSessionStatusSnapshot {
    if (!sessionId) {
      return this.getStatus();
    }

    try {
      return this.snapshotFor(this.requireSession(sessionId));
    } catch {
      return createIdleSnapshot();
    }
  }

  getBotStatuses(sessionId: string): SimulationBotStatus[] {
    return this.requireSession(sessionId).botStatuses.map((bot) => ({ ...bot }));
  }

  async getLiveObservationState(sessionId: string): Promise<LiveObservationState> {
    const record = this.requireSession(sessionId);
    const change = record.observationManager.reconcile(record.botStatuses);

    if (change) {
      await this.applyObservationSelectionChange(record, change);
    }

    return this.liveObservationStateFor(record);
  }

  async followBot(sessionId: string, botId: string): Promise<LiveObservationState> {
    const record = this.requireSession(sessionId);
    const change = record.observationManager.follow(botId, record.botStatuses);
    await this.applyObservationSelectionChange(record, change);
    return this.liveObservationStateFor(record);
  }

  async stopFollowingBot(sessionId: string): Promise<LiveObservationState> {
    const record = this.requireSession(sessionId);
    const change = record.observationManager.stopFollowing();
    await this.applyObservationSelectionChange(record, change);
    return this.liveObservationStateFor(record);
  }

  async showAdjacentBot(
    sessionId: string,
    direction: 'next' | 'previous'
  ): Promise<LiveObservationState> {
    const record = this.requireSession(sessionId);
    const change = record.observationManager.move(direction, record.botStatuses);

    if (change) {
      await this.applyObservationSelectionChange(record, change);
    }

    return this.liveObservationStateFor(record);
  }

  async focusObservedGameWindow(sessionId: string): Promise<LiveObservationState> {
    const record = this.requireSession(sessionId);
    const change = record.observationManager.reconcile(record.botStatuses);

    if (change) {
      await this.applyObservationSelectionChange(record, change);
    }

    const bot = record.botStatuses.find(
      (candidate) => candidate.botId === record.observationManager.selectedBotId
    );
    const instanceId = bot?.gameInstanceId;
    const adapter = record.gameAdapter;

    if (!instanceId) {
      record.observationWindowStatus = 'Waiting for a watched bot with an assigned game instance.';
      return this.liveObservationStateFor(record);
    }

    if (!adapter?.openOrFocusGameWindow) {
      record.observationWindowStatus = adapter?.capabilities.supportsLiveObservation
        ? 'Window focus is not supported by this adapter.'
        : 'The test is running, but only logs and screenshots can be viewed.';
      return this.liveObservationStateFor(record);
    }

    const focusResult = await adapter.openOrFocusGameWindow(instanceId).catch((error: unknown) => ({
      message: error instanceof Error ? error.message : 'The game window could not be focused.'
    }));
    record.observationWindowStatus = focusResult.message;
    record.logs.push(this.createLog(sessionId, focusResult.message.includes('could not') ? 'warn' : 'info', focusResult.message));
    return this.liveObservationStateFor(record);
  }

  stopBot(sessionId: string, botId: string): SimulationBotStatus[] {
    const record = this.requireSession(sessionId);
    const stopped = record.botManager.stopBot(botId);

    record.botStatuses = record.botStatuses.map((bot) => {
      if (bot.botId !== botId || bot.status === 'stopped') {
        return bot;
      }

      return {
        ...bot,
        status: 'stopped',
        progressState: 'Stopped manually',
        message: 'Stopped from Live Session controls.'
      };
    });

    if (stopped) {
      record.logs.push(this.createLog(sessionId, 'warn', `Stopped bot ${botId}.`));
      record.structuredLogger.logSession('manual_stop', {
        scope: 'bot',
        botId
      }, {
        botId
      });
      this.logBotStop(record, botId, 'manual_stop');
      this.completeSessionIfNoActiveBots(record);
      this.writeStructuredReports(record);
    }

    return this.getBotStatuses(sessionId);
  }

  stopBotPool(sessionId: string, profileId: string): SimulationBotStatus[] {
    const record = this.requireSession(sessionId);
    const stoppedCount = record.botManager.stopBotPool(profileId);

    record.botStatuses = record.botStatuses.map((bot) => {
      if (bot.profileId !== profileId || bot.status === 'stopped') {
        return bot;
      }

      return {
        ...bot,
        status: 'stopped',
        progressState: 'Pool stopped manually',
        message: 'Stopped with its bot pool from Live Session controls.'
      };
    });

    if (stoppedCount > 0) {
      record.logs.push(this.createLog(sessionId, 'warn', `Stopped ${stoppedCount} bot(s) in pool ${profileId}.`));
      record.structuredLogger.logSession('manual_stop', {
        scope: 'bot_pool',
        profileId,
        stoppedCount
      });
      for (const bot of record.botStatuses.filter((item) => item.profileId === profileId)) {
        this.logBotStop(record, bot.botId, 'manual_stop');
      }
      this.completeSessionIfNoActiveBots(record);
      this.writeStructuredReports(record);
    }

    return this.getBotStatuses(sessionId);
  }

  async getInstanceStatuses(sessionId: string): Promise<GameInstanceStatus[]> {
    const record = this.requireSession(sessionId);
    await this.refreshInstanceHealth(record);
    return record.instanceStatuses.map(cloneStatus);
  }

  getIssues(sessionId: string): DetectedIssue[] {
    return this.requireSession(sessionId).issues.map((issue) => ({
      ...issue,
      lastActions: [...issue.lastActions],
      evidencePaths: [...issue.evidencePaths],
      actionTimelineIds: [...issue.actionTimelineIds]
    }));
  }

  getLogs(sessionId: string): LogEntry[] {
    return this.requireSession(sessionId).logs.map((log) => ({ ...log }));
  }

  getCoverage(sessionId: string): ContentCoverageSummary {
    return this.coverageSummaryForRecord(this.requireSession(sessionId));
  }

  async shutdownAllSessions(reason = 'app_shutdown'): Promise<SimulationSessionStatusSnapshot[]> {
    const snapshots: SimulationSessionStatusSnapshot[] = [];

    for (const record of this.sessions.values()) {
      snapshots.push(await this.shutdownSessionRecord(record, reason));
    }

    return snapshots;
  }

  async openReport(sessionId: string): Promise<OpenReportResult> {
    const record = this.requireSession(sessionId);
    this.writeStructuredReports(record);
    const reportPath = record.structuredLogger.summaryPath;

    const openError = await this.openPath(reportPath);

    return {
      sessionId,
      reportPath,
      opened: openError.length === 0,
      message: openError.length === 0 ? 'Report opened.' : openError
    };
  }

  async openLogs(sessionId: string): Promise<OpenLogsResult> {
    const record = this.requireSession(sessionId);
    this.writeStructuredReports(record);
    const logsPath = existsSync(record.structuredLogger.sessionLogger.fullStructuredLogsPath)
      ? record.structuredLogger.sessionLogger.fullStructuredLogsPath
      : record.structuredLogger.sessionLogPath;

    const openError = await this.openPath(logsPath);

    return {
      sessionId,
      logsPath,
      opened: openError.length === 0,
      message: openError.length === 0 ? 'Logs opened.' : openError
    };
  }

  async openSessionFolder(sessionId: string): Promise<OpenSessionPathResult> {
    const record = this.requireSession(sessionId);
    this.writeStructuredReports(record);
    return this.openSessionPath(record, record.structuredLogger.sessionDir, 'Session folder opened.');
  }

  async openIssueFolder(sessionId: string): Promise<OpenSessionPathResult> {
    const record = this.requireSession(sessionId);
    this.writeStructuredReports(record);
    return this.openSessionPath(record, join(record.structuredLogger.sessionDir, 'issues'), 'Issue folder opened.');
  }

  async openScreenshotsFolder(sessionId: string): Promise<OpenSessionPathResult> {
    const record = this.requireSession(sessionId);
    this.writeStructuredReports(record);
    return this.openSessionPath(record, record.structuredLogger.sessionLogger.screenshotsDir, 'Screenshots folder opened.');
  }

  async cleanupSessionBundle(payload: unknown): Promise<SessionCleanupResult> {
    const options = SessionCleanupOptionsSchema.parse(payload);
    const record = this.requireSession(options.sessionId);
    this.writeStructuredReports(record);

    const deletedPaths: string[] = [];
    let archivePath: string | undefined;

    if (options.archiveSessionBundle) {
      archivePath = this.writeSessionBundleArchive(record);
    }

    if (options.deleteRawStateLogs) {
      for (const bot of record.botStatuses) {
        const stateLogPath = record.structuredLogger.ensureBot(bot.botId).statesPath;

        if (existsSync(stateLogPath)) {
          rmSync(stateLogPath, { force: true });
          deletedPaths.push(stateLogPath);
        }
      }
    }

    if (!options.keepScreenshots && existsSync(record.structuredLogger.sessionLogger.screenshotsDir)) {
      rmSync(record.structuredLogger.sessionLogger.screenshotsDir, { recursive: true, force: true });
      mkdirSync(record.structuredLogger.sessionLogger.screenshotsDir, { recursive: true });
      deletedPaths.push(record.structuredLogger.sessionLogger.screenshotsDir);
    }

    if (!options.keepSummaries) {
      for (const path of [
        record.structuredLogger.sessionLogger.summaryJsonPath,
        record.structuredLogger.sessionLogger.summaryPath,
        record.structuredLogger.sessionLogger.htmlReportPath,
        join(record.structuredLogger.sessionLogger.reportsDir, 'session-summary.json'),
        join(record.structuredLogger.sessionLogger.reportsDir, 'session-summary.md'),
        join(record.structuredLogger.sessionLogger.reportsDir, 'session-report.html')
      ]) {
        if (existsSync(path)) {
          rmSync(path, { force: true });
          deletedPaths.push(path);
        }
      }
    }

    if (options.keepSummaries) {
      this.writeStructuredReports(record);
    } else {
      this.metadataForRecord(record);
    }

    return {
      sessionId: options.sessionId,
      deletedPaths,
      archivePath,
      message: [
        archivePath ? `Archive manifest saved to ${archivePath}.` : undefined,
        deletedPaths.length > 0
          ? `Deleted ${deletedPaths.length} raw artifact${deletedPaths.length === 1 ? '' : 's'}.`
          : 'No artifacts were deleted.'
      ].filter(Boolean).join(' ')
    };
  }

  private async openSessionPath(
    record: SimulationSessionRecord,
    path: string,
    successMessage: string
  ): Promise<OpenSessionPathResult> {
    const resolvedPath = resolve(path);
    const sessionDirectory = resolve(record.structuredLogger.sessionDir);

    if (!resolvedPath.startsWith(sessionDirectory)) {
      return {
        sessionId: record.request.runConfig.sessionId,
        path,
        opened: false,
        message: 'Path is not part of this session bundle.'
      };
    }

    mkdirSync(resolvedPath, { recursive: true });
    const openError = await this.openPath(resolvedPath);

    return {
      sessionId: record.request.runConfig.sessionId,
      path: resolvedPath,
      opened: openError.length === 0,
      message: openError.length === 0 ? successMessage : openError
    };
  }

  private writeSessionBundleArchive(record: SimulationSessionRecord): string {
    const sessionDir = resolve(record.structuredLogger.sessionDir);
    const exportsDir = record.structuredLogger.sessionLogger.exportsDir;
    const archivePath = join(exportsDir, `${safeFileStem(record.request.runConfig.sessionId)}-bundle-archive.json`);
    const files = this.listBundleFiles(sessionDir)
      .filter((path) => resolve(path) !== resolve(archivePath))
      .map((path) => {
        const stats = statSync(path);

        return {
          path: relative(sessionDir, path),
          sizeBytes: stats.size,
          modifiedAt: stats.mtime.toISOString()
        };
      });

    mkdirSync(exportsDir, { recursive: true });
    writeFileSync(
      archivePath,
      `${JSON.stringify(
        {
          type: 'GameplaySimulator session bundle archive manifest',
          sessionId: record.request.runConfig.sessionId,
          createdAt: this.now(),
          sessionDirectory: sessionDir,
          fileCount: files.length,
          files
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    return archivePath;
  }

  private listBundleFiles(path: string): string[] {
    if (!existsSync(path)) {
      return [];
    }

    return readdirSync(path).flatMap((name) => {
      const child = join(path, name);
      const stats = statSync(child);
      return stats.isDirectory() ? this.listBundleFiles(child) : [child];
    });
  }

  async getStructuredLogs(sessionId: string): Promise<StructuredLogReadResult> {
    const record = this.requireSession(sessionId);
    this.writeStructuredReports(record);

    const logs: StructuredLogItem[] = [];
    const bundleLogsPath = record.structuredLogger.sessionLogger.fullStructuredLogsPath;

    if (existsSync(bundleLogsPath)) {
      logs.push(
        ...(await this.readStructuredLogFile(bundleLogsPath, {
          source: 'session'
        }))
      );
      logs.sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''));

      return {
        sessionId,
        logs
      };
    }

    logs.push(
      ...(await this.readStructuredLogFile(record.structuredLogger.sessionLogPath, {
        source: 'session'
      }))
    );

    for (const bot of record.botStatuses) {
      const botLogger = record.structuredLogger.ensureBot(bot.botId);
      logs.push(
        ...(await this.readStructuredLogFile(botLogger.actionsPath, {
          source: 'bot-actions',
          botId: bot.botId
        })),
        ...(await this.readStructuredLogFile(botLogger.statesPath, {
          source: 'bot-states',
          botId: bot.botId
        })),
        ...(await this.readStructuredLogFile(botLogger.issuesPath, {
          source: 'bot-issues',
          botId: bot.botId
        }))
      );
    }

    for (const instance of record.instanceStatuses) {
      const instanceLogger = record.structuredLogger.ensureInstance(instance.instanceId);
      logs.push(
        ...(await this.readStructuredLogFile(instanceLogger.logPath, {
          source: 'instance',
          instanceId: instance.instanceId
        }))
      );
    }

    logs.sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''));

    return {
      sessionId,
      logs
    };
  }

  async openEvidence(sessionId: string, evidencePath: string): Promise<OpenEvidenceResult> {
    const record = this.requireSession(sessionId);
    const normalizedPath = resolve(evidencePath);
    const sessionDirectory = resolve(record.structuredLogger.sessionDir);
    const issueEvidencePaths = new Set(
      record.issues.flatMap((issue) => [
        issue.screenshotPath,
        issue.videoPath,
        ...issue.evidencePaths
      ]).filter((path): path is string => typeof path === 'string' && path.length > 0)
        .map((path) => resolve(path))
    );
    const isAllowed = normalizedPath.startsWith(sessionDirectory) || issueEvidencePaths.has(normalizedPath);

    if (!isAllowed) {
      return {
        sessionId,
        evidencePath,
        opened: false,
        message: 'Evidence path is not part of this session.'
      };
    }

    const openError = await this.openPath(normalizedPath);

    return {
      sessionId,
      evidencePath: normalizedPath,
      opened: openError.length === 0,
      message: openError.length === 0 ? 'Evidence opened.' : openError
    };
  }

  previewGitHubIssueExport(payload: unknown): GitHubIssueExportPreviewResult {
    const request = GitHubIssueExportRequestSchema.parse(payload);
    const record = this.requireSession(request.sessionId);
    const issues = this.githubExportIssuesForRequest(record, request);
    const items = issues.map((issue) => this.githubPreviewItemForIssue(record, issue));

    return {
      sessionId: request.sessionId,
      issueCount: items.length,
      issues: items,
      combinedMarkdown: this.renderCombinedGitHubIssueMarkdown(record, items)
    };
  }

  async exportGitHubIssueMarkdown(payload: unknown): Promise<GitHubIssueMarkdownExportResult> {
    const request = GitHubIssueExportRequestSchema.parse(payload);
    const record = this.requireSession(request.sessionId);
    const preview = this.previewGitHubIssueExport(request);
    const exportDirectory = join(record.structuredLogger.sessionLogger.exportsDir, 'github-issues');

    mkdirSync(exportDirectory, { recursive: true });

    const markdownPaths = preview.issues.map((item) => {
      const issue = record.issues.find((candidate) => (candidate.id ?? candidate.issueId) === item.issueId);
      const path = join(
        exportDirectory,
        `${safeFileStem(issue?.severity ?? item.severity)}-${safeFileStem(issue?.category ?? item.category)}-${safeFileStem(item.title)}-${safeFileStem(item.issueId)}.md`
      );

      writeFileSync(path, item.body, 'utf8');
      return path;
    });
    const indexPath = join(exportDirectory, 'github-issues-index.md');
    writeFileSync(indexPath, preview.combinedMarkdown, 'utf8');

    const openError = await this.openPath(indexPath);
    this.metadataForRecord(record);

    return {
      sessionId: request.sessionId,
      issueCount: preview.issueCount,
      exportDirectory,
      indexPath,
      markdownPaths,
      opened: openError.length === 0,
      message:
        openError.length === 0
          ? `Exported ${preview.issueCount} GitHub issue markdown file${preview.issueCount === 1 ? '' : 's'}.`
          : openError
    };
  }

  async postGitHubIssues(payload: unknown): Promise<GitHubIssuePostResult> {
    const request = GitHubIssuePostRequestSchema.parse(payload);
    const preview = this.previewGitHubIssueExport(request);

    if (!request.confirmed) {
      return {
        sessionId: request.sessionId,
        posted: false,
        created: [],
        failed: [],
        message: 'GitHub posting was not confirmed. No issues were posted.'
      };
    }

    const token = request.token?.trim() ||
      (request.useConfiguredToken ? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '' : '');

    if (!token) {
      return {
        sessionId: request.sessionId,
        posted: false,
        created: [],
        failed: [],
        message: 'No GitHub token was provided or configured. No issues were posted.'
      };
    }

    const created: GitHubPostedIssue[] = [];
    const failed: Array<{ issueId: string; title: string; message: string }> = [];

    for (const item of preview.issues) {
      try {
        const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(request.owner)}/${encodeURIComponent(request.repo)}/issues`, {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28'
          },
          body: JSON.stringify({
            title: item.title,
            body: item.body,
            labels: request.labels
          })
        });
        const responseText = await response.text();

        if (!response.ok) {
          failed.push({
            issueId: item.issueId,
            title: item.title,
            message: responseText.slice(0, 500) || `GitHub returned HTTP ${response.status}.`
          });
          continue;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(responseText);
        } catch {
          parsed = {};
        }

        const parsedRecord = typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {};
        created.push({
          issueId: item.issueId,
          title: item.title,
          number: typeof parsedRecord.number === 'number' ? parsedRecord.number : undefined,
          url: typeof parsedRecord.html_url === 'string' ? parsedRecord.html_url : undefined
        });
      } catch (error) {
        failed.push({
          issueId: item.issueId,
          title: item.title,
          message: error instanceof Error ? error.message : 'GitHub issue post failed.'
        });
      }
    }

    return {
      sessionId: request.sessionId,
      posted: created.length > 0,
      created,
      failed,
      message: `Posted ${created.length} GitHub issue${created.length === 1 ? '' : 's'}${failed.length > 0 ? `; ${failed.length} failed.` : '.'}`
    };
  }

  private githubExportIssuesForRequest(
    record: SimulationSessionRecord,
    request: GitHubIssueExportRequest
  ): DetectedIssue[] {
    const selectedIssueIds = new Set(request.issueIds);
    const minimumSeverityRank = severityRanks[request.minimumSeverity];

    return record.issues.filter((issue) => {
      const id = issue.id ?? issue.issueId;
      const selected = selectedIssueIds.size === 0 || selectedIssueIds.has(id) || selectedIssueIds.has(issue.issueId);
      const severityAllowed = severityRanks[issue.severity] >= minimumSeverityRank;
      const confidenceAllowed = (issue.confidence ?? 0) >= request.minimumConfidence;

      return selected && severityAllowed && confidenceAllowed;
    });
  }

  private githubPreviewItemForIssue(record: SimulationSessionRecord, issue: DetectedIssue): GitHubIssuePreviewItem {
    const title = this.githubIssueTitle(issue);

    return {
      issueId: issue.id ?? issue.issueId,
      title,
      severity: issue.severity,
      category: issue.category,
      confidence: issue.confidence,
      body: this.renderGitHubIssueBody(record, issue, title)
    };
  }

  private githubIssueTitle(issue: DetectedIssue): string {
    return `[${issue.severity}] [${issue.category}] ${issue.title}`;
  }

  private renderCombinedGitHubIssueMarkdown(
    record: SimulationSessionRecord,
    items: GitHubIssuePreviewItem[]
  ): string {
    return [
      `# GitHub Issue Export: ${record.request.runConfig.sessionId}`,
      '',
      `Generated: ${this.now()}`,
      `Game: ${record.request.gameProfile.gameName}`,
      `Build: ${this.gameBuildLabel(record)}`,
      '',
      markdownTable(
        ['Issue', 'Severity', 'Category', 'Confidence'],
        items.map((item) => [
          item.title,
          item.severity,
          item.category,
          item.confidence !== undefined ? `${Math.round(item.confidence * 100)}%` : 'unknown'
        ]),
        '_No issues matched the selected filters._'
      ),
      ...items.flatMap((item, index) => [
        index === 0 ? '' : '\n---\n',
        item.body
      ]),
      ''
    ].join('\n');
  }

  private renderGitHubIssueBody(
    record: SimulationSessionRecord,
    issue: DetectedIssue,
    title = this.githubIssueTitle(issue)
  ): string {
    const bot = issue.botId ? record.botStatuses.find((status) => status.botId === issue.botId) : undefined;
    const profile = bot
      ? record.request.botProfiles.find((candidate) => candidate.profileId === bot.profileId)
      : undefined;
    const botProfile = [
      profile?.displayName ?? bot?.displayName,
      profile?.profileId ?? bot?.profileId,
      bot?.playstyle
    ].filter((value): value is string => Boolean(value && value.trim().length > 0)).join(' / ') || 'Unknown';
    const evidencePaths = uniqueStrings([issue.screenshotPath, issue.videoPath, ...(issue.evidencePaths ?? [])]);
    const steps = issue.lastActions.length > 0
      ? issue.lastActions.map((action, index) => `${index + 1}. ${action}`)
      : ['1. Start the captured session/run.', '2. Reproduce the issue with the listed bot and scene context.'];

    return [
      `# ${title}`,
      '',
      '## Summary',
      markdownTable(
        ['Field', 'Value'],
        [
          ['Severity', issue.severity],
          ['Category', issue.category],
          ['Confidence', issue.confidence !== undefined ? `${Math.round(issue.confidence * 100)}%` : 'Unknown'],
          ['Session', record.request.runConfig.sessionId],
          ['Game', record.request.gameProfile.gameName],
          ['Game build', this.gameBuildLabel(record)],
          ['Adapter', record.request.runConfig.adapterType],
          ['Bot profile', botProfile],
          ['Bot ID', issue.botId ?? 'Unknown'],
          ['Game instance', issue.gameInstanceId ?? issue.instanceId ?? 'Unknown'],
          ['Scene/area', issueLocation(issue)]
        ]
      ),
      '## Steps To Reproduce',
      steps.join('\n'),
      '',
      '## Expected Behavior',
      issue.expectedBehavior ?? 'Not specified',
      '',
      '## Actual Behavior',
      issue.actualBehavior ?? issue.description ?? 'Not specified',
      '',
      '## Evidence',
      evidencePaths.length > 0
        ? evidencePaths.map((path) => `- ${path}`).join('\n')
        : '- No screenshots or video paths captured',
      '',
      '## State Summary',
      fencedMarkdown(issue.stateSummary),
      '',
      '## Last Actions',
      issue.lastActions.length > 0
        ? issue.lastActions.map((action, index) => `${index + 1}. ${action}`).join('\n')
        : 'No actions captured',
      '',
      '## Raw Evidence',
      fencedMarkdown(JSON.stringify(issue.rawEvidence ?? issue, null, 2), 'json'),
      ''
    ].join('\n');
  }

  private gameBuildLabel(record: SimulationSessionRecord): string {
    return [
      `version ${record.request.gameProfile.version}`,
      record.request.gameProfile.buildId ? `build ${record.request.gameProfile.buildId}` : undefined
    ].filter((value): value is string => Boolean(value)).join(', ');
  }

  async compareSessions(oldSessionId: string, newSessionId: string): Promise<ComparisonReportResult> {
    if (oldSessionId === newSessionId) {
      throw new Error('Choose two different sessions to compare.');
    }

    const oldRecord = this.requireSession(oldSessionId);
    const newRecord = this.requireSession(newSessionId);
    this.writeStructuredReports(oldRecord);
    this.writeStructuredReports(newRecord);

    const comparison = this.createSessionComparisonData(oldRecord, newRecord);
    const reportPath = join(
      newRecord.structuredLogger.sessionDir,
      `comparison-${safePathSegment(oldSessionId)}-to-${safePathSegment(newSessionId)}.md`
    );

    writeFileSync(reportPath, this.renderComparisonReport(comparison), 'utf8');
    const openError = await this.openPath(reportPath);

    return {
      oldSessionId,
      newSessionId,
      reportPath,
      opened: openError.length === 0,
      message: openError.length === 0 ? 'Comparison report opened.' : openError,
      summary: comparison.summary
    };
  }

  private createSessionComparisonData(
    oldRecord: SimulationSessionRecord,
    newRecord: SimulationSessionRecord
  ): SessionComparisonData {
    const oldGroups = this.groupIssuesForComparison(oldRecord.issues);
    const newGroups = this.groupIssuesForComparison(newRecord.issues);
    const newIssueGroups = [...newGroups.entries()]
      .filter(([fingerprint]) => !oldGroups.has(fingerprint))
      .map(([, group]) => group);
    const fixedIssueGroups = [...oldGroups.entries()]
      .filter(([fingerprint]) => !newGroups.has(fingerprint))
      .map(([, group]) => group);
    const repeatedIssuePairs = [...newGroups.entries()]
      .filter(([fingerprint]) => oldGroups.has(fingerprint))
      .map(([fingerprint, newGroup]) => ({
        oldGroup: oldGroups.get(fingerprint)!,
        newGroup
      }));
    const worsenedIssuePairs = repeatedIssuePairs.filter(
      ({ oldGroup, newGroup }) => newGroup.maxSeverityRank > oldGroup.maxSeverityRank
    );
    const improvedSeverityPairs = repeatedIssuePairs.filter(
      ({ oldGroup, newGroup }) => newGroup.maxSeverityRank < oldGroup.maxSeverityRank
    );
    const oldCoverage = this.coverageSummaryForRecord(oldRecord);
    const newCoverage = this.coverageSummaryForRecord(newRecord);
    const oldCovered = new Map(
      oldCoverage.testedContent.map((item) => [`${item.category}:${item.contentId}`, `${item.category}: ${item.label}`])
    );
    const newCovered = new Map(
      newCoverage.testedContent.map((item) => [`${item.category}:${item.contentId}`, `${item.category}: ${item.label}`])
    );
    const oldProgress = this.botProgressForRecord(oldRecord);
    const newProgress = this.botProgressForRecord(newRecord);
    const further: Array<{ oldBot: BotProgressComparison; newBot: BotProgressComparison }> = [];
    const stuckEarlier: Array<{ oldBot: BotProgressComparison; newBot: BotProgressComparison }> = [];

    for (const [botId, newBot] of newProgress.entries()) {
      const oldBot = oldProgress.get(botId);

      if (!oldBot) {
        continue;
      }

      if (
        newBot.actionCount > oldBot.actionCount ||
        (newBot.status === 'completed' && oldBot.status !== 'completed')
      ) {
        further.push({ oldBot, newBot });
      }

      if (this.isStuckProgress(newBot) && newBot.actionCount < oldBot.actionCount) {
        stuckEarlier.push({ oldBot, newBot });
      }
    }

    const oldCrashCount = this.countCrashIssues(oldRecord.issues);
    const newCrashCount = this.countCrashIssues(newRecord.issues);
    const summary: ComparisonReportSummary = {
      oldTotalIssues: oldRecord.issues.length,
      newTotalIssues: newRecord.issues.length,
      newIssues: newIssueGroups.length,
      fixedIssues: fixedIssueGroups.length,
      repeatedIssues: repeatedIssuePairs.length,
      worsenedIssues: worsenedIssuePairs.length,
      coverageDeltaPercent: newCoverage.percentage - oldCoverage.percentage,
      crashFrequencyDelta: newCrashCount - oldCrashCount
    };

    return {
      oldRecord,
      newRecord,
      newIssueGroups,
      fixedIssueGroups,
      repeatedIssuePairs,
      worsenedIssuePairs,
      improvedSeverityPairs,
      coverage: {
        oldSummary: oldCoverage,
        newSummary: newCoverage,
        newlyCovered: [...newCovered.entries()]
          .filter(([key]) => !oldCovered.has(key))
          .map(([, label]) => label)
          .sort(),
        noLongerCovered: [...oldCovered.entries()]
          .filter(([key]) => !newCovered.has(key))
          .map(([, label]) => label)
          .sort()
      },
      botProgress: {
        further,
        stuckEarlier
      },
      performance: {
        oldSnapshot: this.resourceSnapshotForRecord(oldRecord),
        newSnapshot: this.resourceSnapshotForRecord(newRecord)
      },
      crashFrequency: {
        oldCount: oldCrashCount,
        newCount: newCrashCount
      },
      summary
    };
  }

  private groupIssuesForComparison(issues: DetectedIssue[]): Map<string, IssueComparisonGroup> {
    const groups = new Map<string, IssueComparisonGroup>();

    for (const issue of issues) {
      const fingerprint = issueComparableFingerprint(issue);
      const exactFingerprint = issueExactFingerprint(issue);
      const severityRank = severityRanks[issue.severity];
      const existing = groups.get(fingerprint);

      if (!existing) {
        groups.set(fingerprint, {
          fingerprint,
          exactFingerprints: [exactFingerprint],
          issues: [issue],
          exemplar: issue,
          maxSeverity: issue.severity,
          maxSeverityRank: severityRank
        });
        continue;
      }

      existing.issues.push(issue);
      if (!existing.exactFingerprints.includes(exactFingerprint)) {
        existing.exactFingerprints.push(exactFingerprint);
      }

      if (severityRank > existing.maxSeverityRank) {
        existing.exemplar = issue;
        existing.maxSeverity = issue.severity;
        existing.maxSeverityRank = severityRank;
      }
    }

    return groups;
  }

  private botProgressForRecord(record: SimulationSessionRecord): Map<string, BotProgressComparison> {
    return new Map(
      record.botStatuses.map((bot) => {
        const memory = record.botManager.getMemory(bot.botId);

        return [
          bot.botId,
          {
            botId: bot.botId,
            profileId: bot.profileId,
            displayName: bot.displayName,
            status: bot.status,
            actionCount: memory?.actionCount ?? bot.actionCount ?? 0,
            currentArea: memory?.currentArea ?? bot.currentArea,
            progressState: memory?.progressState ?? bot.progressState,
            issueCount: record.issues.filter((issue) => issue.botId === bot.botId).length
          }
        ];
      })
    );
  }

  private isStuckProgress(bot: BotProgressComparison): boolean {
    const progressText = `${bot.status} ${bot.progressState}`.toLowerCase();

    return (
      bot.status === 'blocked' ||
      bot.status === 'failed' ||
      progressText.includes('stuck') ||
      progressText.includes('blocked') ||
      progressText.includes('recovery failed')
    );
  }

  private countCrashIssues(issues: DetectedIssue[]): number {
    return issues.filter((issue) =>
      issue.category === 'crash' ||
      issue.title.toLowerCase().includes('crash') ||
      issue.description?.toLowerCase().includes('crash')
    ).length;
  }

  private resourceSnapshotForRecord(record: SimulationSessionRecord): ResourceComparisonSnapshot {
    const cpuValues = record.instanceStatuses
      .map((instance) => instance.resourceUsage?.cpuPercent)
      .filter((value): value is number => typeof value === 'number');
    const ramValues = record.instanceStatuses
      .map((instance) => instance.resourceUsage?.ramMb)
      .filter((value): value is number => typeof value === 'number');
    const gpuValues = record.instanceStatuses
      .map((instance) => instance.resourceUsage?.gpuPercent)
      .filter((value): value is number => typeof value === 'number');

    return {
      estimatedCpuPercent: record.viabilityReport.estimatedCpuPercent,
      estimatedRamMb: record.viabilityReport.estimatedRamMb,
      estimatedGpuPercent: record.viabilityReport.estimatedGpuPercent,
      currentCpuPercent: cpuValues.length > 0 ? Math.min(100, sum(cpuValues)) : record.viabilityReport.estimatedCpuPercent,
      currentRamMb: ramValues.length > 0 ? sum(ramValues) : record.viabilityReport.estimatedRamMb,
      currentGpuPercent: gpuValues.length > 0 ? average(gpuValues) : record.viabilityReport.estimatedGpuPercent
    };
  }

  private renderComparisonReport(data: SessionComparisonData): string {
    const oldRecord = data.oldRecord;
    const newRecord = data.newRecord;
    const oldSessionId = oldRecord.request.runConfig.sessionId;
    const newSessionId = newRecord.request.runConfig.sessionId;
    const oldBuild = oldRecord.request.gameProfile.buildId ?? 'n/a';
    const newBuild = newRecord.request.gameProfile.buildId ?? 'n/a';
    const oldPerf = data.performance.oldSnapshot;
    const newPerf = data.performance.newSnapshot;

    return [
      `# Build Comparison: ${oldSessionId} -> ${newSessionId}`,
      '',
      `Generated: ${this.now()}`,
      '',
      '## Sessions',
      markdownTable(
        ['Field', 'Old Session', 'New Session'],
        [
          ['Session ID', oldSessionId, newSessionId],
          ['Game', oldRecord.request.gameProfile.gameName, newRecord.request.gameProfile.gameName],
          ['Version', oldRecord.request.gameProfile.version, newRecord.request.gameProfile.version],
          ['Build', oldBuild, newBuild],
          ['Engine', oldRecord.request.gameProfile.engine.type, newRecord.request.gameProfile.engine.type],
          ['Adapter', oldRecord.request.runConfig.adapterType, newRecord.request.runConfig.adapterType],
          ['Status', oldRecord.status, newRecord.status],
          ['Started', oldRecord.startedAt ?? 'not started', newRecord.startedAt ?? 'not started'],
          ['Stopped', oldRecord.stoppedAt ?? 'not stopped', newRecord.stoppedAt ?? 'not stopped']
        ]
      ),
      '## Summary',
      markdownTable(
        ['Metric', 'Value'],
        [
          ['Old total issues', String(data.summary.oldTotalIssues)],
          ['New total issues', String(data.summary.newTotalIssues)],
          ['New issue fingerprints', String(data.summary.newIssues)],
          ['Fixed issue fingerprints', String(data.summary.fixedIssues)],
          ['Repeated issue fingerprints', String(data.summary.repeatedIssues)],
          ['Worsened repeated issues', String(data.summary.worsenedIssues)],
          ['Issue count change', formatSignedNumber(data.summary.newTotalIssues - data.summary.oldTotalIssues)],
          ['Coverage change', `${formatSignedNumber(data.summary.coverageDeltaPercent)} percentage points`],
          ['Crash frequency change', formatSignedNumber(data.summary.crashFrequencyDelta)]
        ]
      ),
      '## New Issues',
      markdownTable(
        ['Title', 'Category', 'Severity', 'Scene/Area', 'Bots', 'Count', 'Fingerprint'],
        this.issueGroupRows(data.newIssueGroups),
        '_No new issue fingerprints._'
      ),
      '## Fixed Issues',
      markdownTable(
        ['Title', 'Category', 'Severity', 'Scene/Area', 'Bots', 'Count', 'Fingerprint'],
        this.issueGroupRows(data.fixedIssueGroups),
        '_No fixed issue fingerprints._'
      ),
      '## Repeated Issues',
      markdownTable(
        ['Title', 'Category', 'Severity Change', 'Scene/Area', 'Old Count', 'New Count', 'Fingerprint'],
        this.repeatedIssueRows(data.repeatedIssuePairs),
        '_No repeated issue fingerprints._'
      ),
      '## Worsened Issues',
      markdownTable(
        ['Title', 'Category', 'Severity Change', 'Scene/Area', 'Old Count', 'New Count', 'Fingerprint'],
        this.repeatedIssueRows(data.worsenedIssuePairs),
        '_No repeated issues worsened in severity._'
      ),
      '## Improved Issue Count',
      markdownTable(
        ['Metric', 'Old', 'New', 'Delta'],
        [
          [
            'Total issues',
            String(data.summary.oldTotalIssues),
            String(data.summary.newTotalIssues),
            formatSignedNumber(data.summary.newTotalIssues - data.summary.oldTotalIssues)
          ],
          [
            'Repeated issues with improved severity',
            String(data.improvedSeverityPairs.length),
            String(data.improvedSeverityPairs.length),
            data.improvedSeverityPairs.length > 0 ? 'severity improved' : 'no severity improvement'
          ]
        ]
      ),
      '## Coverage Difference',
      markdownTable(
        ['Metric', 'Old', 'New', 'Delta'],
        [
          [
            'Known content coverage',
            `${this.coverageSummaryForRecord(oldRecord).percentage}%`,
            `${this.coverageSummaryForRecord(newRecord).percentage}%`,
            `${formatSignedNumber(data.summary.coverageDeltaPercent)} points`
          ],
          [
            'Tested known content',
            `${data.coverage.oldSummary.testedKnown}/${data.coverage.oldSummary.totalKnown}`,
            `${data.coverage.newSummary.testedKnown}/${data.coverage.newSummary.totalKnown}`,
            formatSignedNumber(data.coverage.newSummary.testedKnown - data.coverage.oldSummary.testedKnown)
          ],
          [
            'Observed content',
            String(data.coverage.oldSummary.totalObserved),
            String(data.coverage.newSummary.totalObserved),
            formatSignedNumber(data.coverage.newSummary.totalObserved - data.coverage.oldSummary.totalObserved)
          ]
        ]
      ),
      '### Newly Covered Content',
      markdownTable(['Content'], data.coverage.newlyCovered.map((item) => [item]), '_No newly covered content._'),
      '### No Longer Covered Content',
      markdownTable(['Content'], data.coverage.noLongerCovered.map((item) => [item]), '_No previously covered content was lost._'),
      '## Bot Progress',
      '### Bots That Got Further Than Before',
      markdownTable(
        ['Bot', 'Profile', 'Old Actions', 'New Actions', 'Old Area', 'New Area', 'Status Change'],
        data.botProgress.further.map(({ oldBot, newBot }) => [
          newBot.botId,
          newBot.profileId,
          String(oldBot.actionCount),
          String(newBot.actionCount),
          oldBot.currentArea,
          newBot.currentArea,
          `${oldBot.status} -> ${newBot.status}`
        ]),
        '_No bots got further than the old session._'
      ),
      '### Bots That Got Stuck Earlier Than Before',
      markdownTable(
        ['Bot', 'Profile', 'Old Actions', 'New Actions', 'Old Progress', 'New Progress'],
        data.botProgress.stuckEarlier.map(({ oldBot, newBot }) => [
          newBot.botId,
          newBot.profileId,
          String(oldBot.actionCount),
          String(newBot.actionCount),
          oldBot.progressState,
          newBot.progressState
        ]),
        '_No bots got stuck earlier than before._'
      ),
      '## Performance Changes',
      markdownTable(
        ['Metric', 'Old', 'New', 'Delta'],
        [
          [
            'Estimated CPU',
            formatPercent(oldPerf.estimatedCpuPercent),
            formatPercent(newPerf.estimatedCpuPercent),
            `${formatSignedNumber(Math.round(newPerf.estimatedCpuPercent - oldPerf.estimatedCpuPercent))} points`
          ],
          [
            'Estimated RAM',
            formatMegabytes(oldPerf.estimatedRamMb),
            formatMegabytes(newPerf.estimatedRamMb),
            formatMegabytes(newPerf.estimatedRamMb - oldPerf.estimatedRamMb)
          ],
          [
            'Estimated GPU',
            formatPercent(oldPerf.estimatedGpuPercent),
            formatPercent(newPerf.estimatedGpuPercent),
            typeof oldPerf.estimatedGpuPercent === 'number' && typeof newPerf.estimatedGpuPercent === 'number'
              ? `${formatSignedNumber(Math.round(newPerf.estimatedGpuPercent - oldPerf.estimatedGpuPercent))} points`
              : 'n/a'
          ],
          [
            'Current CPU estimate',
            formatPercent(oldPerf.currentCpuPercent),
            formatPercent(newPerf.currentCpuPercent),
            `${formatSignedNumber(Math.round(newPerf.currentCpuPercent - oldPerf.currentCpuPercent))} points`
          ],
          [
            'Current RAM estimate',
            formatMegabytes(oldPerf.currentRamMb),
            formatMegabytes(newPerf.currentRamMb),
            formatMegabytes(newPerf.currentRamMb - oldPerf.currentRamMb)
          ],
          [
            'Current GPU estimate',
            formatPercent(oldPerf.currentGpuPercent),
            formatPercent(newPerf.currentGpuPercent),
            typeof oldPerf.currentGpuPercent === 'number' && typeof newPerf.currentGpuPercent === 'number'
              ? `${formatSignedNumber(Math.round(newPerf.currentGpuPercent - oldPerf.currentGpuPercent))} points`
              : 'n/a'
          ]
        ]
      ),
      '## Crash Frequency Changes',
      markdownTable(
        ['Metric', 'Old', 'New', 'Delta'],
        [
          [
            'Crash issues',
            String(data.crashFrequency.oldCount),
            String(data.crashFrequency.newCount),
            formatSignedNumber(data.crashFrequency.newCount - data.crashFrequency.oldCount)
          ]
        ]
      ),
      '## Fingerprinting Notes',
      [
        'Issue comparisons use normalized category, scene/area, title, state-summary signature, and last-action pattern.',
        'Exact fingerprints also track severity. Severity changes are evaluated on comparable fingerprints so repeated issues can still be marked as worsened or improved.'
      ].join('\n'),
      ''
    ].join('\n');
  }

  private issueGroupRows(groups: IssueComparisonGroup[]): string[][] {
    return groups.map((group) => {
      const issue = group.exemplar;
      const botIds = uniqueStrings(group.issues.map((item) => item.botId));

      return [
        issue.title,
        issue.category,
        group.maxSeverity,
        issueLocation(issue),
        botIds.length > 0 ? botIds.join(', ') : 'n/a',
        String(group.issues.length),
        fingerprintPreview(group.fingerprint)
      ];
    });
  }

  private loadPersistedSessions(force = false): void {
    for (const metadata of this.sessionRepository.listSessions()) {
      if (!force && this.sessions.has(metadata.sessionId)) {
        continue;
      }

      try {
        const artifacts = this.sessionRepository.loadSession(metadata.sessionId);
        const existing = this.sessions.get(metadata.sessionId);

        if (existing && !existing.persisted && !force) {
          continue;
        }

        this.sessions.set(metadata.sessionId, this.recordFromPersistedArtifacts(artifacts));
      } catch {
        // Ignore unreadable run folders. A partial or hand-edited run should not break app startup.
      }
    }
  }

  private recordFromPersistedArtifacts(artifacts: PersistedSessionArtifacts): SimulationSessionRecord {
    const sessionId = artifacts.runConfig.sessionId;
    const botProfiles = fallbackBotProfiles(artifacts.runConfig, artifacts.botProfiles);
    const profilesById = new Map(botProfiles.map((profile) => [profile.profileId, profile]));
    const launchPlans: BotLaunchPlan[] = artifacts.botStatuses.map((bot, index) => ({
      botId: bot.botId,
      profileId: bot.profileId,
      displayName: bot.displayName,
      playstyle: bot.playstyle,
      assignedGameInstanceId: bot.gameInstanceId,
      seed: index + 1,
      resourceWeight: profilesById.get(bot.profileId)?.defaultResourceWeight ?? 'medium',
      launchIndex: index + 1
    }));
    const botAdapter = new PersistedSessionBotAdapter();
    const botManager = new BotManager({
      sessionId,
      runConfig: artifacts.runConfig,
      launchPlans,
      botProfiles,
      adapter: botAdapter,
      uiFlows: artifacts.gameProfile.uiFlows,
      now: this.now
    });
    const coverageTracker = new CoverageTracker(artifacts.gameProfile);

    for (const bot of artifacts.botStatuses) {
      const profile = profilesById.get(bot.profileId);
      coverageTracker.registerBot(bot.botId, profile ?? bot.profileId);
    }

    for (const state of artifacts.states) {
      coverageTracker.recordSnapshot(state, {
        botId: state.botId,
        profileId: state.botId ? artifacts.botStatuses.find((bot) => bot.botId === state.botId)?.profileId : undefined
      });
    }

    for (const action of artifacts.actions) {
      coverageTracker.recordAction(action, {
        botId: action.botId,
        profileId: artifacts.botStatuses.find((bot) => bot.botId === action.botId)?.profileId
      });
    }

    for (const issue of artifacts.issues) {
      coverageTracker.recordIssue(issue);
    }

    const structuredLogger = new StructuredRunLogger({
      rootDir: this.reportRoot,
      sessionId,
      createdAt: artifacts.metadata.createdAt,
      sessionDir: artifacts.metadata.reportPaths.sessionDirectory,
      now: this.now
    });

    for (const bot of artifacts.botStatuses) {
      structuredLogger.ensureBot(bot.botId);
    }

    for (const instance of artifacts.instanceStatuses) {
      structuredLogger.ensureInstance(instance.instanceId);
    }

    const record: SimulationSessionRecord = {
      request: {
        runConfig: artifacts.runConfig,
        gameProfile: artifacts.gameProfile,
        botProfiles,
        runtimeObservation: resolveRuntimeObservationConfig(artifacts.runConfig)
      },
      viabilityReport: artifacts.viabilityReport,
      status: artifacts.metadata.status,
      label: `Loaded ${sessionId} from disk`,
      createdAt: artifacts.metadata.createdAt,
      startedAt: artifacts.metadata.startedAt,
      stoppedAt: artifacts.metadata.stoppedAt,
      botStatuses: artifacts.botStatuses,
      instanceStatuses: artifacts.instanceStatuses,
      issues: artifacts.issues,
      logs: artifacts.logs,
      tick: artifacts.botStatuses.reduce((total, bot) => total + (bot.actionCount ?? 0), 0),
      botManager,
      issueDetectionRunner: new IssueDetectionRunner(),
      coverageTracker,
      structuredLogger,
      loggedStateSnapshotIds: new Set(),
      loggedActionIds: new Set(),
      loggedIssueIds: new Set(artifacts.issues.map((issue) => issue.id ?? issue.issueId)),
      loggedStartedBotIds: new Set(),
      loggedStoppedBotIds: new Set(),
      loggedStartedInstanceIds: new Set(),
      loggedStoppedInstanceIds: new Set(),
      loggedRecoveryAttemptIds: new Set(),
      loggedRecoverySuccessIds: new Set(),
      loggedRecoveryFailedIds: new Set(),
      loggedEvidenceKeys: new Set(),
      loggedFlowStartIds: new Set(),
      loggedFlowStepActionIds: new Set(),
      loggedFlowCompletionIds: new Set(),
      loggedFlowAbandonedIds: new Set(),
      loggedAdapterLogIds: new Set(),
      lastPeriodicScreenshotActionCountByBot: new Map(),
      videoPathsByBot: new Map(),
      evidenceCaptureService: new EvidenceCaptureService({
        now: this.now
      }),
      sessionStartLogged: true,
      sessionStopLogged: true,
      botAdapter,
      observationManager: new RuntimeObservationManager(resolveRuntimeObservationConfig(artifacts.runConfig)),
      useMockRuntime: false,
      persisted: true,
      persistedCoverageSummary: artifacts.coverageSummary
    };

    record.label = statusLabel(record);
    return record;
  }

  private metadataForRecord(record: SimulationSessionRecord): PersistedSessionMetadata {
    const coverage = this.coverageSummaryForRecord(record);

    return this.sessionRepository.writeSessionMetadata({
      sessionDir: record.structuredLogger.sessionDir,
      sessionId: record.request.runConfig.sessionId,
      gameProfile: record.request.gameProfile,
      runConfig: record.request.runConfig,
      status: record.status,
      createdAt: record.createdAt,
      startedAt: record.startedAt,
      stoppedAt: record.stoppedAt,
      issues: record.issues,
      botStatuses: record.botStatuses,
      coverageSummary: coverage,
      reportPaths: this.reportPathsForRecord(record)
    });
  }

  private reportPathsForRecord(record: SimulationSessionRecord): SessionReportPaths {
    const sessionDir = record.structuredLogger.sessionDir;

    return {
      sessionDirectory: sessionDir,
      metadataJson: record.structuredLogger.sessionLogger.metadataPath,
      summaryJson: record.structuredLogger.sessionLogger.summaryJsonPath,
      summaryMarkdown: record.structuredLogger.summaryPath,
      htmlReport: record.structuredLogger.sessionLogger.htmlReportPath,
      sessionLog: record.structuredLogger.sessionLogPath,
      importantEvents: record.structuredLogger.sessionLogger.importantEventsPath,
      fullStructuredLogs: record.structuredLogger.sessionLogger.fullStructuredLogsPath,
      issuesJson: record.structuredLogger.sessionLogger.issuesJsonPath,
      issueTimeline: record.structuredLogger.sessionLogger.issueTimelinePath,
      screenshotsDirectory: record.structuredLogger.sessionLogger.screenshotsDir,
      reportsDirectory: record.structuredLogger.sessionLogger.reportsDir,
      exportsDirectory: record.structuredLogger.sessionLogger.exportsDir,
      replayDirectory: record.structuredLogger.sessionLogger.replayDir,
      issueDirectory: join(sessionDir, 'issues'),
      config: record.structuredLogger.sessionLogger.configPath,
      viabilityReport: record.structuredLogger.sessionLogger.viabilityReportPath,
      githubExportDirectory: existsSync(join(record.structuredLogger.sessionLogger.exportsDir, 'github-issues'))
        ? join(record.structuredLogger.sessionLogger.exportsDir, 'github-issues')
        : existsSync(join(sessionDir, 'github-issues'))
          ? join(sessionDir, 'github-issues')
        : undefined
    };
  }

  private repeatedIssueRows(pairs: Array<{ oldGroup: IssueComparisonGroup; newGroup: IssueComparisonGroup }>): string[][] {
    return pairs.map(({ oldGroup, newGroup }) => {
      const issue = newGroup.exemplar;

      return [
        issue.title,
        issue.category,
        `${oldGroup.maxSeverity} -> ${newGroup.maxSeverity}`,
        issueLocation(issue),
        String(oldGroup.issues.length),
        String(newGroup.issues.length),
        fingerprintPreview(newGroup.fingerprint)
      ];
    });
  }

  private startMockSession(record: SimulationSessionRecord): SimulationSessionStatusSnapshot {
    const sessionId = record.request.runConfig.sessionId;

    this.activeSessionId = sessionId;
    record.status = 'starting';
    record.startedAt = record.startedAt ?? this.now();
    record.stoppedAt = undefined;
    record.botStatuses = record.botStatuses.map((bot) => ({
      ...bot,
      status: bot.status === 'stopped' ? 'stopped' : 'starting',
      currentArea: bot.status === 'stopped' ? bot.currentArea : 'Boot',
      progressState: bot.status === 'stopped' ? bot.progressState : 'Starting',
      message: bot.status === 'stopped' ? bot.message : 'Mock bot is starting.'
    }));
    record.instanceStatuses = record.instanceStatuses.map((instance) => ({
      ...instance,
      status: 'starting',
      lastHeartbeat: this.now()
    }));
    record.logs.push(this.createLog(sessionId, 'info', 'Starting mock simulation session.'));
    record.label = statusLabel(record);
    this.logSessionStart(record);
    this.startVideoEvidence(record);
    this.writeStructuredReports(record);

    this.clearSessionTimer(sessionId);
    const startupTimer = setTimeout(() => {
      const current = this.sessions.get(sessionId);

      if (!current || current.status !== 'starting') {
        return;
      }

      current.status = 'running';
      current.botStatuses = current.botStatuses.map((bot) => ({
        ...bot,
        status:
          bot.status === 'stopped'
            ? 'stopped'
            : current.startupFlow && bot.botId !== current.startupFlow.botId
              ? 'queued'
              : 'running',
        currentArea: bot.status === 'stopped' ? bot.currentArea : 'Start Area',
        progressState:
          bot.status === 'stopped'
            ? bot.progressState
            : current.startupFlow && bot.botId !== current.startupFlow.botId
              ? 'Waiting for startup flow'
              : 'Running',
        message:
          bot.status === 'stopped'
            ? bot.message
            : current.startupFlow && bot.botId !== current.startupFlow.botId
              ? `Waiting for startup flow "${current.startupFlow.flowName}".`
              : 'Mock bot is running.'
      }));
      current.instanceStatuses = current.instanceStatuses.map((instance) => ({
        ...instance,
        status: 'running',
        lastHeartbeat: this.now()
      }));
      current.logs.push(this.createLog(sessionId, 'info', 'Bot runtime loops are running.'));
      current.label = statusLabel(current);
      for (const instance of current.instanceStatuses) {
        this.logInstanceStart(current, instance);
      }
      this.writeStructuredReports(current);
      this.startStartupFlowTimeout(current);
      current.botManager.startAll();
    }, 300);

    startupTimer.unref?.();
    record.startupTimer = startupTimer;
    return this.snapshotFor(record);
  }

  private async failAdapterStartup(record: SimulationSessionRecord, error: unknown): Promise<void> {
    const sessionId = record.request.runConfig.sessionId;
    const message = error instanceof Error ? error.message : 'Unknown adapter startup failure.';
    const timestamp = this.now();

    this.clearInstanceHealthTimer(sessionId);
    record.status = 'failed';
    if (record.gameInstanceManager) {
      record.instanceStatuses = record.gameInstanceManager.getAllInstanceStatuses();
      this.logInstanceManagerEvents(record);
    }
    record.stoppedAt = timestamp;
    record.botStatuses = record.botStatuses.map((bot) => ({
      ...bot,
      status: 'failed',
      currentArea: bot.currentArea === 'Queued' ? 'Adapter startup failed' : bot.currentArea,
      progressState: 'Adapter startup failed',
      message
    }));
    record.instanceStatuses = record.instanceStatuses.map((instance) => ({
      ...instance,
      status: instance.status === 'running' ? 'running' : instance.status === 'failed' ? 'failed' : 'crashed',
      lastHeartbeat: timestamp
    }));
    record.logs.push(this.createLog(sessionId, 'error', `Adapter startup failed: ${message}`));
    record.structuredLogger.logSession('crash', {
      reason: 'adapter_startup_failed',
      message
    }, {
      timestamp
    });

    const issue: DetectedIssue = {
      id: `${sessionId}-adapter-startup-failed`,
      issueId: `${sessionId}-adapter-startup-failed`,
      timestamp,
      sessionId,
      instanceId: record.instanceStatuses[0]?.instanceId,
      gameInstanceId: record.instanceStatuses[0]?.instanceId,
      severity: 'critical',
      category: 'crash',
      title: 'Game adapter failed to launch',
      description: message,
      scene: 'Adapter startup',
      area: 'Adapter startup',
      lastActions: [],
      stateSummary: `Adapter ${record.request.runConfig.adapterType} failed before bot runtime could start.`,
      expectedBehavior: 'The selected adapter should launch or connect to the configured game instance.',
      actualBehavior: message,
      confidence: 1,
      rawEvidence: {
        adapterType: record.request.runConfig.adapterType,
        launch: record.request.gameProfile.launch,
        error: message
      },
      evidencePaths: [],
      actionTimelineIds: [],
      firstSeenAt: timestamp,
      reproducible: true
    };

    await this.recordDetectedIssue(record, issue);

    try {
      await record.gameAdapter?.stopAll();
    } catch (stopError) {
      const stopMessage = stopError instanceof Error ? stopError.message : 'Adapter cleanup failed.';
      record.logs.push(this.createLog(sessionId, 'warn', `Adapter cleanup after launch failure failed: ${stopMessage}`));
    }

    record.label = statusLabel(record);
    this.logSessionStop(record, 'adapter_startup_failed');
    this.stopVideoEvidence(record);
    this.writeStructuredReports(record);
  }

  private startInstanceHealthMonitor(record: SimulationSessionRecord): void {
    if (record.useMockRuntime || !record.gameInstanceManager || record.instanceHealthTimer) {
      return;
    }

    const sessionId = record.request.runConfig.sessionId;
    const timer = setInterval(() => {
      const current = this.sessions.get(sessionId);

      if (!current || !['starting', 'running', 'paused'].includes(current.status)) {
        this.clearInstanceHealthTimer(sessionId);
        return;
      }

      void this.refreshInstanceHealth(current);
    }, 1000);

    timer.unref?.();
    record.instanceHealthTimer = timer;
  }

  private clearInstanceHealthTimer(sessionId: string): void {
    const record = this.sessions.get(sessionId);

    if (record?.instanceHealthTimer) {
      clearInterval(record.instanceHealthTimer);
      record.instanceHealthTimer = undefined;
    }
  }

  private async refreshInstanceHealth(record: SimulationSessionRecord): Promise<void> {
    if (record.useMockRuntime || !record.gameInstanceManager) {
      return;
    }

    if (!['starting', 'running', 'paused'].includes(record.status)) {
      return;
    }

    try {
      record.instanceStatuses = await record.gameInstanceManager.refreshHealth();
      this.logInstanceManagerEvents(record);
      await this.refreshAdapterLogs(record);
      record.label = statusLabel(record);
      this.writeStructuredReports(record);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Instance health refresh failed.';
      record.logs.push(this.createLog(record.request.runConfig.sessionId, 'warn', `Instance health refresh failed: ${message}`));
    }
  }

  private logInstanceManagerEvents(record: SimulationSessionRecord): void {
    const events = record.gameInstanceManager?.drainEvents() ?? [];

    for (const event of events) {
      const instance = record.instanceStatuses.find((item) => item.instanceId === event.instanceId);

      if (!instance) {
        continue;
      }

      if (event.eventType === 'instance_start') {
        this.logInstanceStart(record, instance);
      } else if (event.eventType === 'instance_stop') {
        this.logInstanceStop(record, instance, event.message ?? 'manager_stop');
      } else if (event.eventType === 'instance_crash') {
        this.logInstanceCrash(record, instance, event);
      } else if (event.eventType === 'instance_health_warning') {
        this.logInstanceHealthWarning(record, instance, event);
      } else if (event.eventType === 'instance_restart') {
        this.logInstanceRestart(record, instance, event);
      } else if (event.eventType === 'instance_save_isolation') {
        this.logInstanceSaveIsolation(record, instance, event);
      }
    }
  }

  private async stopGameInstances(record: SimulationSessionRecord, reason: string): Promise<void> {
    const sessionId = record.request.runConfig.sessionId;

    this.clearInstanceHealthTimer(sessionId);

    try {
      if (record.gameInstanceManager) {
        record.instanceStatuses = await record.gameInstanceManager.stopAllInstances();
        this.logInstanceManagerEvents(record);
      } else if (record.gameAdapter) {
        await record.gameAdapter.stopAll();
        this.markInstancesStopped(record);
      } else {
        this.markInstancesStopped(record);
      }
      await this.refreshAdapterLogs(record);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown adapter shutdown failure.';
      record.logs.push(this.createLog(sessionId, 'warn', `Adapter shutdown failed during ${reason}: ${message}`));

      try {
        await record.gameAdapter?.stopAll();
      } catch (cleanupError) {
        const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : 'Unknown adapter cleanup failure.';
        record.logs.push(this.createLog(sessionId, 'warn', `Adapter stopAll cleanup failed during ${reason}: ${cleanupMessage}`));
      }

      this.markInstancesStopped(record);
    }

    this.markInstancesStopped(record);
  }

  private async refreshAdapterLogs(record: SimulationSessionRecord): Promise<void> {
    const adapter = record.gameAdapter;

    if (!adapter?.captureLogs) {
      return;
    }

    const observationEventTypes = new Set<StructuredLogEventType>([
      'visible_window_started',
      'visible_window_stopped',
      'observation_bot_changed',
      'observation_limit_reached'
    ]);

    for (const instance of record.instanceStatuses) {
      const logs = await adapter.captureLogs(instance.instanceId).catch(() => []);

      for (const entry of logs) {
        if (record.loggedAdapterLogIds.has(entry.id)) {
          continue;
        }

        record.loggedAdapterLogIds.add(entry.id);
        record.logs.push(entry);
        const eventType = entry.message.split(':', 1)[0] as StructuredLogEventType;

        if (observationEventTypes.has(eventType)) {
          const event = record.structuredLogger.logSession(
            eventType,
            {
              level: entry.level,
              message: entry.message,
              source: entry.source
            },
            {
              gameInstanceId: instance.instanceId,
              timestamp: entry.timestamp
            }
          );
          record.structuredLogger.logInstance(event, instance);
        }
      }
    }
  }

  private async applyObservationSelectionChange(
    record: SimulationSessionRecord,
    change: ObservationSelectionChange
  ): Promise<void> {
    const sessionId = record.request.runConfig.sessionId;
    const adapter = record.gameAdapter;

    await adapter?.updateObservationTarget?.({
      botId: change.watchedBotId,
      instanceId: change.watchedGameInstanceId,
      observationMode: change.observationMode
    });
    record.observationWindowStatus = undefined;
    record.logs.push(this.createLog(sessionId, 'info', `observation_bot_changed: ${change.message}`));
    record.structuredLogger.logSession(
      'observation_bot_changed',
      {
        previousBotId: change.previousBotId,
        watchedBotId: change.watchedBotId,
        watchedGameInstanceId: change.watchedGameInstanceId,
        observationMode: change.observationMode,
        reason: change.reason,
        message: change.message
      },
      {
        botId: change.watchedBotId,
        gameInstanceId: change.watchedGameInstanceId,
        timestamp: this.now()
      }
    );
  }

  private liveObservationStateFor(record: SimulationSessionRecord): LiveObservationState {
    const observationConfig =
      record.request.runtimeObservation ?? resolveRuntimeObservationConfig(record.request.runConfig);
    const watchedBotId = record.observationManager.selectedBotId;
    const bot = record.botStatuses.find((candidate) => candidate.botId === watchedBotId);
    const instance = record.instanceStatuses.find(
      (candidate) => candidate.instanceId === bot?.gameInstanceId
    );
    const adapter = record.gameAdapter;
    const supportsObservation = adapter?.capabilities.supportsLiveObservation ?? false;
    const isBackground =
      !observationConfig.showBotGameplay || record.observationManager.mode === 'background';
    let badge: LiveObservationBadge;

    if (!bot || !instance || ['starting', 'stopping'].includes(instance.status)) {
      badge = 'Waiting for game';
    } else if (!supportsObservation) {
      badge = 'Window unavailable';
    } else if (isBackground) {
      badge = 'Running in background';
    } else {
      badge = 'Watching';
    }

    const windowStatus = record.observationWindowStatus ?? (() => {
      if (!adapter) {
        return record.persisted
          ? 'This saved session has no live game window.'
          : 'Waiting for the game adapter.';
      }

      if (!supportsObservation) {
        return adapter.capabilities.observationCapability === 'unavailable'
          ? 'The test is running, but only logs and screenshots can be viewed.'
          : 'Window focus is not supported by this adapter.';
      }

      if (!instance) {
        return 'Waiting for the watched bot to receive a game instance.';
      }

      if (isBackground) {
        return 'The game is running without window following or focus changes.';
      }

      return instance.status === 'running'
        ? 'The watched game window is available.'
        : `The watched game instance is ${instance.status}.`;
    })();

    return {
      sessionId: record.request.runConfig.sessionId,
      badge,
      observationMode: record.observationManager.mode,
      watchedBotId: bot?.botId,
      watchedGameInstanceId: bot?.gameInstanceId,
      currentAction: bot?.currentAction,
      actionReason: bot?.actionReason,
      actionStartedAt: bot?.actionStartedAt,
      lastResult: bot?.lastResult,
      currentScene: bot?.currentScreen ?? bot?.currentArea,
      windowStatus,
      message: record.observationManager.message,
      canFocusWindow: Boolean(
        instance?.status === 'running' &&
        adapter?.capabilities.supportsWindowFocus &&
        adapter.openOrFocusGameWindow
      )
    };
  }

  private markInstancesStopped(record: SimulationSessionRecord): void {
    record.instanceStatuses = record.instanceStatuses.map((instance) => ({
      ...instance,
      status: 'stopped',
      lastHeartbeat: this.now()
    }));
  }

  private snapshotFor(record: SimulationSessionRecord): SimulationSessionStatusSnapshot {
    return {
      status: record.status,
      label: record.label,
      activeSessionId: record.request.runConfig.sessionId,
      sessionId: record.request.runConfig.sessionId,
      createdAt: record.createdAt,
      startedAt: record.startedAt,
      stoppedAt: record.stoppedAt,
      botCount: record.botStatuses.length,
      instanceCount: record.instanceStatuses.length
    };
  }

  private clearSessionTimer(sessionId: string): void {
    const record = this.sessions.get(sessionId);

    if (record?.startupTimer) {
      clearTimeout(record.startupTimer);
      record.startupTimer = undefined;
    }

    if (record?.startupFlowTimeoutTimer) {
      clearTimeout(record.startupFlowTimeoutTimer);
      record.startupFlowTimeoutTimer = undefined;
    }
  }

  private startStartupFlowTimeout(record: SimulationSessionRecord): void {
    const startupFlow = record.startupFlow;

    if (!startupFlow || startupFlowTimeoutIsTerminal(startupFlow.status) || record.startupFlowTimeoutTimer) {
      return;
    }

    const timestamp = this.now();
    startupFlow.status = 'running';
    startupFlow.startedAt = startupFlow.startedAt ?? timestamp;
    startupFlow.message = `Startup flow "${startupFlow.flowName}" is preparing the game before normal bots run.`;
    startupFlow.timeline.push({
      eventType: 'startup_flow_started',
      timestamp,
      flowId: startupFlow.flowId,
      flowName: startupFlow.flowName,
      timeoutMs: startupFlow.timeoutMs
    });

    const timer = setTimeout(() => {
      void this.handleStartupFlowTimeout(record.request.runConfig.sessionId);
    }, startupFlow.timeoutMs);
    timer.unref?.();
    record.startupFlowTimeoutTimer = timer;
  }

  private async handleStartupFlowTimeout(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId);
    const startupFlow = record?.startupFlow;

    if (!record || !startupFlow || startupFlowTimeoutIsTerminal(startupFlow.status)) {
      return;
    }

    await this.handleStartupFlowFailure(
      record,
      'timed_out',
      `Startup flow "${startupFlow.flowName}" did not finish within ${Math.round(startupFlow.timeoutMs / 1000)} seconds.`
    );
  }

  private async handleStartupFlowStatus(
    record: SimulationSessionRecord,
    status: RuntimeBotSnapshot,
    memory: BotMemory
  ): Promise<boolean> {
    const startupFlow = record.startupFlow;

    if (!startupFlow || status.botId !== startupFlow.botId) {
      return false;
    }

    if (['starting', 'running', 'waiting'].includes(status.status)) {
      startupFlow.status = 'running';
      startupFlow.startedAt = startupFlow.startedAt ?? this.now();
      startupFlow.message = status.message ?? `Startup flow "${startupFlow.flowName}" is running.`;
      return false;
    }

    if (status.status === 'completed') {
      startupFlow.status = 'succeeded';
      startupFlow.completedAt = startupFlow.completedAt ?? this.now();
      startupFlow.message = `Startup flow "${startupFlow.flowName}" completed. Normal bots may start.`;
      startupFlow.timeline.push({
        eventType: 'startup_flow_succeeded',
        timestamp: startupFlow.completedAt,
        flowId: startupFlow.flowId,
        flowName: startupFlow.flowName,
        lastActionId: status.lastActionId
      });

      if (record.startupFlowTimeoutTimer) {
        clearTimeout(record.startupFlowTimeoutTimer);
        record.startupFlowTimeoutTimer = undefined;
      }

      return false;
    }

    if (['blocked', 'failed', 'stopped'].includes(status.status)) {
      await this.handleStartupFlowFailure(
        record,
        'failed',
        status.message ?? memory.progressState ?? `Startup flow "${startupFlow.flowName}" failed before gameplay started.`,
        status,
        memory
      );
      return true;
    }

    return false;
  }

  private async handleStartupFlowFailure(
    record: SimulationSessionRecord,
    failureStatus: Extract<StartupFlowRuntimeStatus, 'failed' | 'timed_out'>,
    message: string,
    status?: RuntimeBotSnapshot,
    memory?: BotMemory
  ): Promise<void> {
    const startupFlow = record.startupFlow;

    if (!startupFlow || startupFlow.failureHandled) {
      return;
    }

    const timestamp = this.now();
    startupFlow.failureHandled = true;
    startupFlow.status = failureStatus;
    startupFlow.completedAt = timestamp;
    startupFlow.message = message;
    startupFlow.timeline.push({
      eventType: failureStatus === 'timed_out' ? 'startup_flow_timed_out' : 'startup_flow_failed',
      timestamp,
      flowId: startupFlow.flowId,
      flowName: startupFlow.flowName,
      message,
      lastActionId: status?.lastActionId,
      progressState: memory?.progressState
    });

    if (record.startupFlowTimeoutTimer) {
      clearTimeout(record.startupFlowTimeoutTimer);
      record.startupFlowTimeoutTimer = undefined;
    }

    const issue = await this.createStartupFlowIssue(record, failureStatus, message, status, memory);
    startupFlow.issueId = issue.issueId;
    startupFlow.screenshotPath = issue.screenshotPath;

    if (startupFlow.continueOnFailure) {
      startupFlow.status = 'continued';
      startupFlow.message = `${message} Continuing because Continue if startup flow fails is enabled.`;
      startupFlow.timeline.push({
        eventType: 'startup_flow_continued',
        timestamp: this.now(),
        flowId: startupFlow.flowId,
        flowName: startupFlow.flowName,
        issueId: issue.issueId
      });
      record.logs.push(this.createLog(record.request.runConfig.sessionId, 'warn', startupFlow.message));
      record.botManager.stopBot(startupFlow.botId);
      record.label = statusLabel(record);
      return;
    }

    record.logs.push(this.createLog(record.request.runConfig.sessionId, 'error', `Startup flow failed: ${message}`));
    this.clearSessionTimer(record.request.runConfig.sessionId);
    record.botManager.stopAll();
    record.status = 'failed';
    record.stoppedAt = timestamp;
    record.botStatuses = record.botStatuses.map((bot) => ({
      ...bot,
      status: bot.botId === startupFlow.botId ? 'failed' : 'stopped',
      progressState: bot.botId === startupFlow.botId ? 'Startup flow failed' : 'Stopped because startup flow failed',
      message: bot.botId === startupFlow.botId ? message : `Startup flow "${startupFlow.flowName}" failed before normal bots started.`
    }));
    await this.stopGameInstances(record, 'startup_flow_failed');
    record.label = statusLabel(record);
    this.logSessionStop(record, 'startup_flow_failed');
    this.stopVideoEvidence(record);
    this.writeStructuredReports(record);
  }

  private async createStartupFlowIssue(
    record: SimulationSessionRecord,
    failureStatus: Extract<StartupFlowRuntimeStatus, 'failed' | 'timed_out'>,
    message: string,
    status?: RuntimeBotSnapshot,
    memory?: BotMemory
  ): Promise<DetectedIssue> {
    const startupFlow = record.startupFlow!;
    const timestamp = this.now();
    const issueId = `${record.request.runConfig.sessionId}-${startupFlow.flowId}-${failureStatus}`;
    const issue: DetectedIssue = {
      id: issueId,
      issueId,
      timestamp,
      sessionId: record.request.runConfig.sessionId,
      instanceId: status?.gameInstanceId,
      gameInstanceId: status?.gameInstanceId,
      botId: startupFlow.botId,
      severity: startupFlow.continueOnFailure ? 'error' : 'critical',
      category: 'ui',
      title: failureStatus === 'timed_out' ? 'Startup flow timed out' : 'Startup flow failed',
      description: message,
      scene: memory?.lastState?.scene ?? 'Startup flow',
      area: memory?.currentArea ?? 'Startup flow',
      lastActions: memory?.recentActionTypes.slice(-10) ?? [],
      stateSummary: memory?.lastState
        ? JSON.stringify({
            scene: memory.lastState.scene,
            state: memory.lastState.state,
            screenshotPath: memory.lastState.screenshotPath
          }).slice(0, 2000)
        : `Startup flow "${startupFlow.flowName}" could not reach gameplay.`,
      expectedBehavior: 'The configured startup flow should move through menus and leave the game ready for normal bots.',
      actualBehavior: message,
      confidence: failureStatus === 'timed_out' ? 0.85 : 0.9,
      screenshotPath: memory?.lastState?.screenshotPath,
      rawEvidence: {
        detectorName: 'StartupFlowRunner',
        detectorRule: 'The pre-run startup flow did not complete before normal bots were allowed to start.',
        startupFlow: {
          flowId: startupFlow.flowId,
          flowName: startupFlow.flowName,
          status: failureStatus,
          timeoutMs: startupFlow.timeoutMs,
          continueOnFailure: startupFlow.continueOnFailure,
          timeline: startupFlow.timeline
        },
        botStatus: status,
        progressSummary: memory?.progressSummary
      },
      evidencePaths: [],
      actionTimelineIds: memory?.lastAction ? [memory.lastAction.actionId] : [],
      firstSeenAt: timestamp,
      reproducible: true
    };

    await this.recordDetectedIssue(record, issue);
    return record.issues.find((item) => item.issueId === issue.issueId) ?? issue;
  }

  private async shutdownSessionRecord(
    record: SimulationSessionRecord,
    reason: string
  ): Promise<SimulationSessionStatusSnapshot> {
    const sessionId = record.request.runConfig.sessionId;
    const terminalBotStatuses = new Set(['blocked', 'completed', 'failed', 'stopped']);
    const wasStopped = record.status === 'stopped';

    this.clearSessionTimer(sessionId);
    record.botManager.stopAll();

    if (!wasStopped) {
      record.status = 'stopped';
      record.stoppedAt = record.stoppedAt ?? this.now();
      record.logs.push(this.createLog(sessionId, 'warn', `Graceful shutdown preserved partial session: ${reason}.`));
      record.structuredLogger.logSession('manual_stop', {
        scope: 'session',
        reason
      });
    } else {
      record.stoppedAt = record.stoppedAt ?? this.now();
    }

    record.botStatuses = record.botStatuses.map((bot) => {
      if (terminalBotStatuses.has(bot.status)) {
        return bot;
      }

      return {
        ...bot,
        status: 'stopped',
        progressState: `Stopped during graceful shutdown: ${reason}`,
        message: `Stopped during graceful shutdown: ${reason}`
      };
    });
    await this.stopGameInstances(record, reason);
    record.label = statusLabel(record);
    this.logSessionStop(record, reason);
    this.stopVideoEvidence(record);
    this.writeStructuredReports(record);

    return this.snapshotFor(record);
  }

  private async captureScreenshotEvidence(
    record: SimulationSessionRecord,
    input: {
      botId?: string;
      instanceId?: string;
      reason: string;
      memory?: BotMemory;
      issueId?: string;
      evidenceKey?: string;
    }
  ): Promise<EvidenceCaptureResult | undefined> {
    if (!record.request.runConfig.saveScreenshots || !input.botId) {
      return undefined;
    }

    const evidenceKey = input.evidenceKey ?? `${input.botId}:${input.reason}:${input.issueId ?? 'manual'}`;

    if (record.loggedEvidenceKeys.has(evidenceKey)) {
      return undefined;
    }

    record.loggedEvidenceKeys.add(evidenceKey);

    try {
      const botLogger = record.structuredLogger.ensureBot(input.botId);
      const result = await record.evidenceCaptureService.captureScreenshot({
        sessionId: record.request.runConfig.sessionId,
        botId: input.botId,
        instanceId: input.instanceId,
        reason: input.reason,
        issueId: input.issueId,
        screenshotsDir: botLogger.screenshotsDir,
        area: input.memory?.currentArea,
        lastAction: input.memory?.lastAction,
        progressState: input.memory?.progressState,
        lastState: input.memory?.lastState
      });

      if (result.path && input.memory?.lastState) {
        input.memory.lastState.screenshotPath = result.path;
      }

      if (result.path) {
        record.structuredLogger.logSession(
          'state_snapshot',
          {
            evidence: result.fallback ? 'fallback_screenshot' : 'screenshot',
            reason: input.reason,
            screenshotPath: result.path,
            sourcePath: result.sourcePath,
            issueId: input.issueId,
            fallback: result.fallback,
            message: result.message
          },
          {
            botId: input.botId,
            gameInstanceId: input.instanceId,
            timestamp: result.capturedAt
          }
        );
      }

      if (result.fallback) {
        record.logs.push(
          this.createLog(
            record.request.runConfig.sessionId,
            'warn',
            `Screenshot capture used fallback evidence for ${input.botId}: ${result.message ?? 'real screenshot unavailable'}.`
          )
        );
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Screenshot capture failed.';
      record.logs.push(this.createLog(record.request.runConfig.sessionId, 'warn', `Screenshot capture failed: ${message}`));
      return undefined;
    }
  }

  private startVideoEvidence(record: SimulationSessionRecord): void {
    if (!record.request.runConfig.saveVideo) {
      return;
    }

    for (const bot of record.botStatuses) {
      if (!bot.gameInstanceId) {
        continue;
      }

      try {
        const botLogger = record.structuredLogger.ensureBot(bot.botId);
        mkdirSync(botLogger.videoDir, { recursive: true });
        const videoPath = join(botLogger.videoDir, `${safePathSegment(bot.botId)}-video-capture.json`);
        const startedAt = this.now();

        writeFileSync(
          videoPath,
          `${JSON.stringify(
            {
              type: 'mock-video-capture',
              status: 'recording',
              sessionId: record.request.runConfig.sessionId,
              botId: bot.botId,
              instanceId: bot.gameInstanceId,
              startedAt
            },
            null,
            2
          )}\n`,
          'utf8'
        );
        record.videoPathsByBot.set(bot.botId, videoPath);
        record.structuredLogger.logSession(
          'state_snapshot',
          {
            evidence: 'video_start',
            videoPath
          },
          {
            botId: bot.botId,
            gameInstanceId: bot.gameInstanceId,
            timestamp: startedAt
          }
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Video capture failed to start.';
        record.logs.push(this.createLog(record.request.runConfig.sessionId, 'warn', `Video capture failed to start: ${message}`));
      }
    }
  }

  private stopVideoEvidenceForBot(record: SimulationSessionRecord, botId: string): void {
    const videoPath = record.videoPathsByBot.get(botId);

    if (!videoPath) {
      return;
    }

    const bot = record.botStatuses.find((item) => item.botId === botId);
    const stoppedAt = this.now();

    try {
      writeFileSync(
        videoPath,
        `${JSON.stringify(
          {
            type: 'mock-video-capture',
            status: 'stopped',
            sessionId: record.request.runConfig.sessionId,
            botId,
            instanceId: bot?.gameInstanceId,
            startedAt: record.startedAt,
            stoppedAt
          },
          null,
          2
        )}\n`,
        'utf8'
      );
      record.structuredLogger.logSession(
        'state_snapshot',
        {
          evidence: 'video_stop',
          videoPath
        },
        {
          botId,
          gameInstanceId: bot?.gameInstanceId,
          timestamp: stoppedAt
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Video capture failed to stop.';
      record.logs.push(this.createLog(record.request.runConfig.sessionId, 'warn', `Video capture failed to stop: ${message}`));
    }
  }

  private stopVideoEvidence(record: SimulationSessionRecord): void {
    for (const botId of record.videoPathsByBot.keys()) {
      this.stopVideoEvidenceForBot(record, botId);
    }
  }

  private addEvidencePath(issue: DetectedIssue, evidencePath: string | undefined): void {
    if (!evidencePath) {
      return;
    }

    issue.evidencePaths = [...new Set([...(issue.evidencePaths ?? []), evidencePath])];
  }

  private attachScreenshotEvidenceMetadata(issue: DetectedIssue, result: EvidenceCaptureResult | undefined): void {
    if (!result?.path) {
      return;
    }

    const rawEvidence =
      typeof issue.rawEvidence === 'object' && issue.rawEvidence !== null && !Array.isArray(issue.rawEvidence)
        ? issue.rawEvidence as Record<string, unknown>
        : issue.rawEvidence === undefined
          ? {}
          : { originalRawEvidence: issue.rawEvidence };

    issue.rawEvidence = {
      ...rawEvidence,
      screenshotEvidence: {
        path: result.path,
        kind: result.kind,
        fallback: result.fallback,
        capturedAt: result.capturedAt,
        mimeType: result.mimeType,
        sourcePath: result.sourcePath,
        message: result.message
      }
    };
  }

  private async readStructuredLogFile(
    path: string,
    source: Pick<StructuredLogItem, 'source' | 'botId' | 'instanceId'>
  ): Promise<StructuredLogItem[]> {
    let contents = '';

    try {
      contents = await readFile(path, 'utf8');
    } catch {
      return [];
    }

    return contents
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return {
            eventType: 'invalid_json',
            timestamp: this.now(),
            line
          };
        }
      })
      .map((raw) => this.structuredLogItemFromRaw(raw, source));
  }

  private structuredLogItemFromRaw(
    raw: Record<string, unknown>,
    source: Pick<StructuredLogItem, 'source' | 'botId' | 'instanceId'>
  ): StructuredLogItem {
    const bundledSource = typeof raw.bundleSource === 'string' ? raw.bundleSource : undefined;
    const effectiveSource: StructuredLogItem['source'] =
      bundledSource === 'session' ||
      bundledSource === 'bot-actions' ||
      bundledSource === 'bot-states' ||
      bundledSource === 'bot-issues' ||
      bundledSource === 'instance'
        ? bundledSource
        : source.source;
    const eventType = typeof raw.eventType === 'string' ? raw.eventType : undefined;
    const timestamp = typeof raw.timestamp === 'string' ? raw.timestamp : undefined;
    const botId =
      source.botId ??
      (typeof raw.botId === 'string' ? raw.botId : undefined) ??
      this.valueAtPath(raw, ['action', 'botId']) ??
      this.valueAtPath(raw, ['snapshot', 'botId']) ??
      this.valueAtPath(raw, ['issue', 'botId']);
    const instanceId =
      source.instanceId ??
      (typeof raw.gameInstanceId === 'string' ? raw.gameInstanceId : undefined) ??
      this.valueAtPath(raw, ['action', 'gameInstanceId']) ??
      this.valueAtPath(raw, ['snapshot', 'gameInstanceId']) ??
      this.valueAtPath(raw, ['issue', 'gameInstanceId']);
    const actionType = this.valueAtPath(raw, ['action', 'type']);
    const actionExplanation =
      this.valueAtPath(raw, ['payload', 'explanation']) ??
      this.valueAtPath(raw, ['action', 'payload', 'explanation']);
    const issuePayloadSummary = this.valueAtPath(raw, ['payload', 'summary']);
    const issueTitle = this.valueAtPath(raw, ['issue', 'title']);
    const scene = this.valueAtPath(raw, ['snapshot', 'scene']);
    const payloadSummary =
      typeof raw.payload === 'object' && raw.payload !== null
        ? JSON.stringify(raw.payload)
        : undefined;

    return {
      ...source,
      source: effectiveSource,
      botId,
      instanceId,
      eventType,
      timestamp,
      summary:
        issuePayloadSummary ??
        issueTitle ??
        actionExplanation ??
        actionType ??
        scene ??
        payloadSummary ??
        eventType ??
        source.source,
      raw
    };
  }

  private valueAtPath(raw: Record<string, unknown>, path: string[]): string | undefined {
    let current: unknown = raw;

    for (const part of path) {
      if (typeof current !== 'object' || current === null || Array.isArray(current)) {
        return undefined;
      }

      current = (current as Record<string, unknown>)[part];
    }

    return typeof current === 'string' ? current : undefined;
  }

  private logSessionStart(record: SimulationSessionRecord): void {
    if (record.sessionStartLogged) {
      return;
    }

    record.sessionStartLogged = true;
    record.structuredLogger.logSession(
      'session_start',
      {
        status: record.status,
        gameName: record.request.gameProfile.gameName,
        runMode: record.request.runConfig.runMode,
        botCount: record.botStatuses.length,
        instanceCount: record.instanceStatuses.length
      },
      { timestamp: record.startedAt }
    );
  }

  private logSessionStop(record: SimulationSessionRecord, reason: string): void {
    if (record.sessionStopLogged) {
      return;
    }

    record.sessionStopLogged = true;
    for (const instance of record.instanceStatuses) {
      this.logInstanceStop(record, instance, reason);
    }
    for (const bot of record.botStatuses) {
      if (['blocked', 'completed', 'failed', 'stopped'].includes(bot.status)) {
        this.logBotStop(record, bot.botId, reason);
      }
    }
    record.structuredLogger.logSession(
      'session_stop',
      {
        status: record.status,
        reason,
        botCount: record.botStatuses.length,
        issueCount: record.issues.length
      },
      { timestamp: record.stoppedAt }
    );
  }

  private logInstanceStart(record: SimulationSessionRecord, instance: GameInstanceStatus): void {
    if (record.loggedStartedInstanceIds.has(instance.instanceId)) {
      return;
    }

    record.loggedStartedInstanceIds.add(instance.instanceId);
    const event = record.structuredLogger.logSession(
      'instance_start',
        {
          status: instance.status,
          adapterType: instance.adapterType,
          assignedBots: instance.assignedBots,
          saveProfileId: instance.saveProfileId,
          isolatedSaveDirectory: instance.isolatedSaveDirectory,
          saveIsolationMode: instance.saveIsolationMode
        },
      {
        gameInstanceId: instance.instanceId,
        timestamp: instance.startTime
      }
    );
    record.structuredLogger.logInstance(event, instance);
  }

  private logInstanceStop(record: SimulationSessionRecord, instance: GameInstanceStatus, reason: string): void {
    if (record.loggedStoppedInstanceIds.has(instance.instanceId)) {
      return;
    }

    record.loggedStoppedInstanceIds.add(instance.instanceId);
    const event = record.structuredLogger.logSession(
      'instance_stop',
        {
          status: instance.status,
          reason,
          assignedBots: instance.assignedBots,
          saveProfileId: instance.saveProfileId,
          isolatedSaveDirectory: instance.isolatedSaveDirectory,
          saveIsolationMode: instance.saveIsolationMode,
          saveIsolationCleanedUp: instance.saveIsolationCleanedUp
        },
      {
        gameInstanceId: instance.instanceId,
        timestamp: instance.lastHeartbeat
      }
    );
    record.structuredLogger.logInstance(event, instance);
  }

  private logInstanceCrash(
    record: SimulationSessionRecord,
    instance: GameInstanceStatus,
    event: GameInstanceManagerEvent
  ): void {
    record.logs.push(
      this.createLog(
        record.request.runConfig.sessionId,
        'error',
        `Game instance ${instance.instanceId} ${instance.status}: ${event.message ?? 'Adapter reported a runtime failure.'}`
      )
    );
    const structuredEvent = record.structuredLogger.logSession(
      'instance_crash',
      {
        status: instance.status,
        previousStatus: event.previousStatus,
        message: event.message,
        assignedBots: instance.assignedBots,
        details: event.details ?? {}
      },
      {
        gameInstanceId: instance.instanceId,
        timestamp: event.timestamp
      }
    );
    record.structuredLogger.logInstance(structuredEvent, instance);
  }

  private logInstanceHealthWarning(
    record: SimulationSessionRecord,
    instance: GameInstanceStatus,
    event: GameInstanceManagerEvent
  ): void {
    record.logs.push(
      this.createLog(
        record.request.runConfig.sessionId,
        'warn',
        `Game instance ${instance.instanceId} health warning: ${event.message ?? instance.status}.`
      )
    );
    const structuredEvent = record.structuredLogger.logSession(
      'instance_health_warning',
      {
        status: instance.status,
        previousStatus: event.previousStatus,
        message: event.message,
        assignedBots: instance.assignedBots,
        details: event.details ?? {}
      },
      {
        gameInstanceId: instance.instanceId,
        timestamp: event.timestamp
      }
    );
    record.structuredLogger.logInstance(structuredEvent, instance);
  }

  private logInstanceRestart(
    record: SimulationSessionRecord,
    instance: GameInstanceStatus,
    event: GameInstanceManagerEvent
  ): void {
    record.logs.push(
      this.createLog(
        record.request.runConfig.sessionId,
        'warn',
        `Restarting game instance ${instance.instanceId}: ${event.message ?? 'restart requested'}.`
      )
    );
    const structuredEvent = record.structuredLogger.logSession(
      'instance_restart',
      {
        status: instance.status,
        previousStatus: event.previousStatus,
        message: event.message,
        assignedBots: instance.assignedBots,
        details: event.details ?? {}
      },
      {
        gameInstanceId: instance.instanceId,
        timestamp: event.timestamp
      }
    );
    record.structuredLogger.logInstance(structuredEvent, instance);
  }

  private logInstanceSaveIsolation(
    record: SimulationSessionRecord,
    instance: GameInstanceStatus,
    event: GameInstanceManagerEvent
  ): void {
    record.logs.push(
      this.createLog(
        record.request.runConfig.sessionId,
        'info',
        `Game instance ${instance.instanceId} save/profile isolation: ${event.message ?? instance.saveIsolationMode ?? 'prepared'}.`
      )
    );
    const structuredEvent = record.structuredLogger.logSession(
      'instance_save_isolation',
      {
        status: instance.status,
        previousStatus: event.previousStatus,
        message: event.message,
        assignedBots: instance.assignedBots,
        saveProfileId: instance.saveProfileId,
        isolatedSaveDirectory: instance.isolatedSaveDirectory,
        saveIsolationMode: instance.saveIsolationMode,
        saveIsolationCleanedUp: instance.saveIsolationCleanedUp,
        details: event.details ?? {}
      },
      {
        gameInstanceId: instance.instanceId,
        timestamp: event.timestamp
      }
    );
    record.structuredLogger.logInstance(structuredEvent, instance);
  }

  private logBotStart(record: SimulationSessionRecord, botId: string): void {
    if (record.loggedStartedBotIds.has(botId)) {
      return;
    }

    const bot = record.botStatuses.find((item) => item.botId === botId);
    if (!bot) {
      return;
    }

    record.loggedStartedBotIds.add(botId);
    record.structuredLogger.logSession(
      'bot_start',
      {
        profileId: bot.profileId,
        displayName: bot.displayName,
        playstyle: bot.playstyle,
        status: bot.status
      },
      {
        botId,
        gameInstanceId: bot.gameInstanceId
      }
    );
  }

  private logBotStop(record: SimulationSessionRecord, botId: string, reason: string): void {
    if (record.loggedStoppedBotIds.has(botId)) {
      return;
    }

    const bot = record.botStatuses.find((item) => item.botId === botId);
    if (!bot) {
      return;
    }

    record.loggedStoppedBotIds.add(botId);
    this.stopVideoEvidenceForBot(record, botId);
    record.structuredLogger.logSession(
      'bot_stop',
      {
        profileId: bot.profileId,
        displayName: bot.displayName,
        status: bot.status,
        reason,
        lastActionId: bot.lastActionId,
        progressState: bot.progressState
      },
      {
        botId,
        gameInstanceId: bot.gameInstanceId
      }
    );
  }

  private async logRuntimeArtifacts(
    record: SimulationSessionRecord,
    status: RuntimeBotSnapshot,
    memory: BotMemory
  ): Promise<void> {
    if (['starting', 'running', 'waiting'].includes(status.status)) {
      this.logBotStart(record, status.botId);
    }

    if (memory.lastState && !record.loggedStateSnapshotIds.has(memory.lastState.snapshotId)) {
      record.loggedStateSnapshotIds.add(memory.lastState.snapshotId);
      const event = record.structuredLogger.logSession(
        'state_snapshot',
        {
          snapshotId: memory.lastState.snapshotId,
          scene: memory.lastState.scene,
          screenshotPath: memory.lastState.screenshotPath
        },
        {
          botId: status.botId,
          gameInstanceId: status.gameInstanceId,
          timestamp: memory.lastState.capturedAt
        }
      );
      record.structuredLogger.logState(event, memory.lastState);
      record.coverageTracker.recordSnapshot(memory.lastState, {
        botId: status.botId,
        profileId: status.profileId
      });
    }

    if (memory.lastAction && !record.loggedActionIds.has(memory.lastAction.actionId)) {
      record.loggedActionIds.add(memory.lastAction.actionId);
      const actionInsight = actionInsightFromAction(memory.lastAction);
      const event = record.structuredLogger.logSession(
        'action_performed',
        {
          actionId: memory.lastAction.actionId,
          actionType: memory.lastAction.type,
          status: memory.lastResult?.status,
          resultMessage: memory.lastResult?.message,
          durationMs: memory.lastResult?.durationMs,
          recovery: memory.lastAction.payload.recovery === true,
          actionQuality: actionInsight?.quality,
          explanation: actionInsight?.explanation,
          nextLikelyAction: actionInsight?.nextLikelyAction,
          plannerMetadata: plannerMetadataForLog(memory.lastAction)
        },
        {
          botId: status.botId,
          gameInstanceId: status.gameInstanceId,
          timestamp: memory.lastResult?.completedAt ?? memory.lastAction.requestedAt
        }
      );
      record.structuredLogger.logAction(event, memory.lastAction, memory.lastResult ?? undefined);
      record.coverageTracker.recordAction(memory.lastAction, {
        botId: status.botId,
        profileId: status.profileId
      });

      const everyNActions = record.request.runConfig.screenshotEveryNActions;
      if (
        everyNActions &&
        memory.actionCount > 0 &&
        memory.actionCount % everyNActions === 0 &&
        record.lastPeriodicScreenshotActionCountByBot.get(status.botId) !== memory.actionCount
      ) {
        record.lastPeriodicScreenshotActionCountByBot.set(status.botId, memory.actionCount);
        await this.captureScreenshotEvidence(record, {
          botId: status.botId,
          instanceId: status.gameInstanceId,
          reason: `action-${memory.actionCount}`,
          memory,
          evidenceKey: `${status.botId}:periodic:${memory.actionCount}`
        });
      }
    }

    this.logUIFlowArtifacts(record, status, memory);

    if (memory.stuckReason && ['waiting', 'blocked'].includes(status.status)) {
      await this.captureScreenshotEvidence(record, {
        botId: status.botId,
        instanceId: status.gameInstanceId,
        reason: 'stuck',
        memory,
        evidenceKey: `${status.botId}:stuck:${memory.stuckReason}`
      });
    }

    if (memory.progressState?.startsWith('Recovery failed')) {
      await this.captureScreenshotEvidence(record, {
        botId: status.botId,
        instanceId: status.gameInstanceId,
        reason: 'recovery-failed',
        memory,
        evidenceKey: `${status.botId}:recovery-failed:${memory.actionCount}`
      });
    }

    for (const attempt of memory.recoveryAttempts) {
      if (!record.loggedRecoveryAttemptIds.has(attempt.attemptId)) {
        record.loggedRecoveryAttemptIds.add(attempt.attemptId);
        record.structuredLogger.logSession(
          'recovery_attempt',
          {
            attemptId: attempt.attemptId,
            recoveryType: attempt.recoveryType,
            resultStatuses: attempt.resultStatuses
          },
          {
            botId: status.botId,
            gameInstanceId: status.gameInstanceId,
            timestamp: attempt.startedAt
          }
        );
      }

      if (attempt.recovered === true && !record.loggedRecoverySuccessIds.has(attempt.attemptId)) {
        record.loggedRecoverySuccessIds.add(attempt.attemptId);
        record.structuredLogger.logSession(
          'recovery_success',
          {
            attemptId: attempt.attemptId,
            recoveryType: attempt.recoveryType,
            resultStatuses: attempt.resultStatuses
          },
          {
            botId: status.botId,
            gameInstanceId: status.gameInstanceId,
            timestamp: attempt.completedAt
          }
        );
      }

      if (attempt.recovered === false && !record.loggedRecoveryFailedIds.has(attempt.attemptId)) {
        record.loggedRecoveryFailedIds.add(attempt.attemptId);
        record.structuredLogger.logSession(
          'recovery_failed',
          {
            attemptId: attempt.attemptId,
            recoveryType: attempt.recoveryType,
            resultStatuses: attempt.resultStatuses
          },
          {
            botId: status.botId,
            gameInstanceId: status.gameInstanceId,
            timestamp: attempt.completedAt
          }
        );
      }
    }

    if (['blocked', 'completed', 'failed', 'stopped'].includes(status.status)) {
      this.logBotStop(record, status.botId, status.status);
    }
  }

  private logUIFlowArtifacts(
    record: SimulationSessionRecord,
    status: RuntimeBotSnapshot,
    memory: BotMemory
  ): void {
    const action = memory.lastAction;
    const payload = recordPayload(action?.payload);

    if (!action || payload?.planner !== 'ui-journey') {
      return;
    }

    const flowId = stringPayloadValue(payload, 'flowId') ?? 'unknown-flow';
    const flowName = stringPayloadValue(payload, 'flowName') ?? flowId;
    const flowKey = `${status.botId}:${flowId}`;
    const flowStepCount = numberPayloadValue(payload, 'flowStepCount');
    const stepIndex = numberPayloadValue(payload, 'stepIndex');
    const stepId = stringPayloadValue(payload, 'stepId') ?? `step-${(stepIndex ?? 0) + 1}`;
    const stepKey = `${flowKey}:${action.actionId}`;
    const result = memory.lastResult;
    const resultTimestamp = result?.completedAt ?? action.requestedAt;
    const commonPayload = {
      flowId,
      flowName,
      botId: status.botId,
      profileId: status.profileId,
      actionId: action.actionId,
      actionType: action.type,
      stepId,
      stepIndex,
      flowStepCount,
      expectedScreen: stringPayloadValue(payload, 'expectedScreen'),
      currentScreen: stringPayloadValue(payload, 'currentScreen'),
      targetLabel: stringPayloadValue(payload, 'targetLabel'),
      keyBinding: stringPayloadValue(payload, 'keyBinding'),
      successCondition: stringPayloadValue(payload, 'successCondition'),
      fallbackAction: stringPayloadValue(payload, 'fallbackAction'),
      reason: stringPayloadValue(payload, 'reason')
    };
    const appendStartupTimeline = (eventType: string, eventPayload: Record<string, unknown>, timestamp: string | undefined) => {
      if (record.startupFlow?.botId !== status.botId || record.startupFlow.flowId !== flowId) {
        return;
      }

      record.startupFlow.timeline.push({
        eventType,
        timestamp,
        ...eventPayload
      });
    };

    if (!record.loggedFlowStartIds.has(flowKey)) {
      record.loggedFlowStartIds.add(flowKey);
      appendStartupTimeline(
        'flow_started',
        {
          flowId,
          flowName,
          startState: stringPayloadValue(payload, 'flowStartState'),
          endState: stringPayloadValue(payload, 'flowEndState'),
          flowStepCount
        },
        action.requestedAt
      );
      record.structuredLogger.logSession(
        'flow_started',
        {
          flowId,
          flowName,
          botId: status.botId,
          profileId: status.profileId,
          startState: stringPayloadValue(payload, 'flowStartState'),
          endState: stringPayloadValue(payload, 'flowEndState'),
          flowStepCount
        },
        {
          botId: status.botId,
          gameInstanceId: status.gameInstanceId,
          timestamp: action.requestedAt
        }
      );
    }

    if (!record.loggedFlowStepActionIds.has(stepKey)) {
      record.loggedFlowStepActionIds.add(stepKey);
      appendStartupTimeline('flow_step_started', commonPayload, action.requestedAt);
      record.structuredLogger.logSession('flow_step_started', commonPayload, {
        botId: status.botId,
        gameInstanceId: status.gameInstanceId,
        timestamp: action.requestedAt
      });

      if (result) {
        appendStartupTimeline(
          result.status === 'succeeded' ? 'flow_step_succeeded' : 'flow_step_failed',
          {
            ...commonPayload,
            resultStatus: result.status,
            resultMessage: result.message,
            durationMs: result.durationMs
          },
          resultTimestamp
        );
        record.structuredLogger.logSession(
          result.status === 'succeeded' ? 'flow_step_succeeded' : 'flow_step_failed',
          {
            ...commonPayload,
            resultStatus: result.status,
            resultMessage: result.message,
            durationMs: result.durationMs
          },
          {
            botId: status.botId,
            gameInstanceId: status.gameInstanceId,
            timestamp: resultTimestamp
          }
        );
      }
    }

    if (
      result?.status === 'succeeded' &&
      stepIndex !== undefined &&
      flowStepCount !== undefined &&
      stepIndex + 1 >= flowStepCount &&
      !record.loggedFlowCompletionIds.has(flowKey)
    ) {
      record.loggedFlowCompletionIds.add(flowKey);
      appendStartupTimeline(
        'flow_completed',
        {
          flowId,
          flowName,
          completedStepId: stepId,
          completedActionId: action.actionId,
          flowStepCount
        },
        resultTimestamp
      );
      record.structuredLogger.logSession(
        'flow_completed',
        {
          flowId,
          flowName,
          botId: status.botId,
          profileId: status.profileId,
          completedStepId: stepId,
          completedActionId: action.actionId,
          flowStepCount
        },
        {
          botId: status.botId,
          gameInstanceId: status.gameInstanceId,
          timestamp: resultTimestamp
        }
      );
    }

    if (
      ['blocked', 'failed', 'stopped'].includes(status.status) &&
      !record.loggedFlowCompletionIds.has(flowKey) &&
      !record.loggedFlowAbandonedIds.has(flowKey)
    ) {
      record.loggedFlowAbandonedIds.add(flowKey);
      appendStartupTimeline(
        'flow_abandoned',
        {
          flowId,
          flowName,
          lastStepId: stepId,
          lastActionId: action.actionId,
          botStatus: status.status,
          reason: status.message ?? memory.progressState
        },
        resultTimestamp
      );
      record.structuredLogger.logSession(
        'flow_abandoned',
        {
          flowId,
          flowName,
          botId: status.botId,
          profileId: status.profileId,
          lastStepId: stepId,
          lastActionId: action.actionId,
          botStatus: status.status,
          reason: status.message ?? memory.progressState
        },
        {
          botId: status.botId,
          gameInstanceId: status.gameInstanceId,
          timestamp: resultTimestamp
        }
      );
    }
  }

  private issueRepeatKey(issue: DetectedIssue): string {
    return [
      issue.category,
      issue.severity,
      issue.title,
      issue.scene ?? issue.area ?? 'unknown-area',
      issue.botId ?? 'session'
    ].join('|').toLowerCase();
  }

  private issueEventContextForRecord(
    record: SimulationSessionRecord,
    issue: DetectedIssue,
    isRepeated: boolean
  ): IssueEventLoggerContext {
    const botStatus = issue.botId
      ? record.botStatuses.find((bot) => bot.botId === issue.botId)
      : undefined;
    const memory = issue.botId ? record.botManager.getMemory(issue.botId) : undefined;
    const botProfile = botStatus
      ? record.request.botProfiles.find((profile) => profile.profileId === botStatus.profileId)
      : undefined;

    return {
      gameName: record.request.gameProfile.gameName,
      gameEngine: record.request.gameProfile.engine.version
        ? `${record.request.gameProfile.engine.type} ${record.request.gameProfile.engine.version}`
        : record.request.gameProfile.engine.type,
      gameVersion: record.request.gameProfile.version,
      gameBuild: record.request.gameProfile.buildId,
      adapterType: record.request.runConfig.adapterType,
      botProfile,
      lastAction: memory?.lastAction ?? null,
      previousState: memory?.previousState ?? null,
      currentState: memory?.lastState ?? null,
      recoveryAttempts: memory?.recoveryAttempts ?? [],
      isRepeated
    };
  }

  private logDetectedIssue(record: SimulationSessionRecord, issue: DetectedIssue, isRepeated: boolean): void {
    if (record.loggedIssueIds.has(issue.issueId)) {
      return;
    }

    record.loggedIssueIds.add(issue.issueId);
    const issueContext = this.issueEventContextForRecord(record, issue, isRepeated);
    const event = record.structuredLogger.logSession(
      'issue_detected',
      record.structuredLogger.issueEventLogger.buildPayload(issue, issueContext),
      {
        botId: issue.botId,
        gameInstanceId: issue.gameInstanceId,
        timestamp: issue.firstSeenAt
      }
    );
    record.structuredLogger.logIssue(event, issue, record.loggedIssueIds.size, issueContext);

    if (issue.category === 'crash') {
      record.structuredLogger.logSession('crash', { issueId: issue.issueId, title: issue.title }, {
        botId: issue.botId,
        gameInstanceId: issue.gameInstanceId,
        timestamp: issue.firstSeenAt
      });
    }

    if (issue.category === 'hang') {
      record.structuredLogger.logSession('freeze', { issueId: issue.issueId, title: issue.title }, {
        botId: issue.botId,
        gameInstanceId: issue.gameInstanceId,
        timestamp: issue.firstSeenAt
      });
    }
  }

  private writeStructuredReports(record: SimulationSessionRecord): void {
    if (record.persisted) {
      this.metadataForRecord(record);
      return;
    }

    const bots = this.botReportInputsForRecord(record);
    const coverage = this.contentCoverageForRecord(record);

    record.structuredLogger.writeSummary({
      status: record.status,
      runConfig: record.request.runConfig,
      gameProfile: record.request.gameProfile,
      viabilityReport: record.viabilityReport,
      bots,
      instances: record.instanceStatuses,
      issues: record.issues,
      contentCoveragePercent: coverage.percentage,
      testedContent: coverage.testedContent,
      untestedContent: coverage.untestedContent,
      contentWithIssues: coverage.contentWithIssues,
	      contentByBotType: coverage.contentByBotType,
	      createdAt: record.createdAt,
	      startedAt: record.startedAt,
	      stoppedAt: record.stoppedAt,
	      startupFlow: record.startupFlow
	        ? {
	            flowId: record.startupFlow.flowId,
	            flowName: record.startupFlow.flowName,
	            status: record.startupFlow.status,
	            message: record.startupFlow.message,
	            startedAt: record.startupFlow.startedAt,
	            completedAt: record.startupFlow.completedAt,
	            timeoutMs: record.startupFlow.timeoutMs,
	            issueId: record.startupFlow.issueId,
	            screenshotPath: record.startupFlow.screenshotPath,
	            timeline: record.startupFlow.timeline
	          }
	        : undefined
	    });
    record.structuredLogger.writeBotReports(bots);
    this.metadataForRecord(record);
  }

  private botReportInputsForRecord(record: SimulationSessionRecord): BotReportInput[] {
    return record.botStatuses.map((bot) => {
      const memory = record.botManager.getMemory(bot.botId);
      const issues = record.issues.filter((issue) => issue.botId === bot.botId);
      const areasVisited = uniqueStrings([
        bot.currentArea,
        memory?.currentArea,
        memory?.progressSummary?.latestScene,
        memory?.lastState?.scene,
        ...issues.flatMap((issue) => [issue.scene, issue.area])
      ]);
      const finalState = memory?.lastState?.state ?? {
        status: bot.status,
        currentArea: bot.currentArea,
        progressState: bot.progressState,
        message: bot.message
      };

      return {
        botId: bot.botId,
        displayName: bot.displayName,
        profileId: bot.profileId,
        playstyle: bot.playstyle,
        status: bot.status,
        actionCount: memory?.actionCount ?? 0,
        issueCount: issues.length,
        lastActionId: bot.lastActionId,
        progressState: bot.progressState,
        currentArea: bot.currentArea,
        stopReason: bot.message ?? bot.progressState,
        areasVisited,
        issues,
        lastActions: memory?.recentActionTypes ?? [],
        recoveryAttempts: memory?.recoveryAttempts ?? [],
        finalState
      };
    });
  }

  private contentCoverageForRecord(record: SimulationSessionRecord): {
    percentage: number;
    testedContent: string[];
    untestedContent: string[];
    contentWithIssues: string[];
    contentByBotType: string[];
  } {
    const summary = this.coverageSummaryForRecord(record);

    return {
      percentage: summary.percentage,
      testedContent:
        summary.testedContent.length > 0
          ? summary.testedContent.map((item) => `${item.category}: ${item.label}`)
          : ['No content coverage observed'],
      untestedContent:
        summary.untestedContent.length > 0
          ? summary.untestedContent.map((item) => `${item.category}: ${item.label}`)
          : ['No untested known content'],
      contentWithIssues:
        summary.contentWithIssues.length > 0
          ? summary.contentWithIssues.map((item) => `${item.category}: ${item.label} (${item.issueIds.length} issue${item.issueIds.length === 1 ? '' : 's'})`)
          : ['No issue-linked content'],
      contentByBotType:
        summary.byBotType.length > 0
          ? summary.byBotType.map((item) => `${item.botType}: ${item.testedCount} content item${item.testedCount === 1 ? '' : 's'}`)
          : ['No bot-type coverage yet']
    };
  }

  private coverageForRecord(record: SimulationSessionRecord): CoverageData {
    const visitedScenes = new Set<string>();
    const visitedActions = new Set<string>();
    const actionCounts: Record<string, number> = {};
    const sceneCounts: Record<string, number> = {};

    for (const bot of record.botStatuses) {
      if (bot.currentArea) {
        visitedScenes.add(bot.currentArea);
        sceneCounts[bot.currentArea] = (sceneCounts[bot.currentArea] ?? 0) + 1;
      }

      const memory = record.botManager.getMemory(bot.botId);

      for (const actionType of memory?.recentActionTypes ?? []) {
        visitedActions.add(actionType);
        actionCounts[actionType] = (actionCounts[actionType] ?? 0) + 1;
      }
    }

    return {
      visitedScenes: [...visitedScenes],
      visitedActions: [...visitedActions],
      actionCounts,
      sceneCounts,
      discoveredContentIds: record.issues.map((issue) => issue.issueId)
    };
  }

  private coverageSummaryForRecord(record: SimulationSessionRecord): ContentCoverageSummary {
    return record.persistedCoverageSummary ?? record.coverageTracker.getSummary();
  }

  private async updateBotStatus(
    record: SimulationSessionRecord,
    status: RuntimeBotSnapshot,
    memory: BotMemory
  ): Promise<void> {
    const botIndex = record.botStatuses.findIndex((bot) => bot.botId === status.botId);

    if (botIndex === -1) {
      return;
    }

    const current = record.botStatuses[botIndex];
    const issueCount = record.issues.filter((issue) => issue.botId === status.botId).length;

    record.botStatuses[botIndex] = {
      ...current,
      status: status.status,
      gameInstanceId: status.gameInstanceId,
      currentGoalId: status.currentGoalId,
      currentGoal: status.currentGoal,
      lastActionId: status.lastActionId,
      currentAction: status.currentAction,
      actionReason: status.actionReason,
      actionQuality: status.actionQuality,
      actionStartedAt: memory.lastAction?.requestedAt,
      lastResult: status.lastResult,
      nextLikelyAction: status.nextLikelyAction,
      currentArea: memory.currentArea ?? current.currentArea,
      currentScreen: memory.lastState?.uiState?.currentScreen ?? memory.lastState?.scene,
      progressState: memory.progressState ?? status.message ?? current.progressState,
      issueCount,
      message: status.message
    };
    const observationChange = record.observationManager.reconcile(record.botStatuses);

    if (observationChange) {
      await this.applyObservationSelectionChange(record, observationChange);
    }
    record.tick = record.botStatuses.reduce((total, bot) => {
      const memory = record.botManager.getMemory(bot.botId);
      return total + (memory?.actionCount ?? 0);
    }, 0);
    if (record.useMockRuntime) {
      record.instanceStatuses = record.instanceStatuses.map((instance, index) => ({
        ...instance,
        status: record.status === 'running' ? 'running' : instance.status,
        lastHeartbeat: this.now(),
        resourceUsage: {
          cpuPercent: Math.min(95, 10 + record.tick * 1.5 + index * 3),
          ramMb: 512 + record.botStatuses.length * 96 + index * 160,
          gpuPercent: record.request.runConfig.saveVideo ? Math.min(80, 6 + record.tick + index) : undefined
        }
      }));
    } else {
      void this.refreshInstanceHealth(record);
    }
    record.label = statusLabel(record);

    const startupFlowHandled = await this.handleStartupFlowStatus(record, status, memory);

    if (!startupFlowHandled && ['blocked', 'failed'].includes(status.status)) {
      await this.createSyntheticIssue(record, status, memory);
    }

    if (!startupFlowHandled) {
      await this.detectAutomaticIssues(record, status, memory);
    }
    await this.logRuntimeArtifacts(record, status, memory);
    this.writeStructuredReports(record);
    if (record.status !== 'failed') {
      this.completeSessionIfNoActiveBots(record);
    }
  }

  private async detectAutomaticIssues(
    record: SimulationSessionRecord,
    status: RuntimeBotSnapshot,
    memory: BotMemory
  ): Promise<void> {
    const instanceStatus = status.gameInstanceId
      ? record.instanceStatuses.find((instance) => instance.instanceId === status.gameInstanceId)
      : undefined;
    const issues = record.issueDetectionRunner.detect({
      sessionId: record.request.runConfig.sessionId,
      botId: status.botId,
      instanceId: status.gameInstanceId,
      timestamp: this.now(),
      memory,
      instanceStatus,
      recentIssues: record.issues
    });

    for (const issue of issues) {
      await this.recordDetectedIssue(record, issue);
    }

    if (issues.some((issue) => issue.severity === 'critical') && record.request.runConfig.stopOnCriticalIssue) {
      this.stopForCriticalIssue(record, issues.find((issue) => issue.severity === 'critical'));
    }
  }

  private async recordDetectedIssue(record: SimulationSessionRecord, issue: DetectedIssue): Promise<boolean> {
    if (record.issues.some((existing) => existing.issueId === issue.issueId || existing.id === issue.id)) {
      return false;
    }

    const memory = issue.botId ? record.botManager.getMemory(issue.botId) : undefined;
    const isRepeated = record.issues.some((existing) => this.issueRepeatKey(existing) === this.issueRepeatKey(issue));

    if (memory) {
      if (issue.lastActions.length === 0 && memory.recentActionTypes.length > 0) {
        issue.lastActions = memory.recentActionTypes.slice(-10);
      }

      if (memory.lastAction && !issue.actionTimelineIds.includes(memory.lastAction.actionId)) {
        issue.actionTimelineIds = [...issue.actionTimelineIds, memory.lastAction.actionId];
      }

      if (!issue.stateSummary && memory.lastState) {
        issue.stateSummary = JSON.stringify({
          snapshotId: memory.lastState.snapshotId,
          scene: memory.lastState.scene,
          state: memory.lastState.state
        }).slice(0, 2000);
      }
    }

    const screenshotEvidence = await this.captureScreenshotEvidence(record, {
      botId: issue.botId,
      instanceId: issue.gameInstanceId,
      reason: 'issue-detected',
      memory,
      issueId: issue.issueId,
      evidenceKey: `${issue.botId ?? 'session'}:issue:${issue.issueId}`
    });
    const videoPath = issue.botId ? record.videoPathsByBot.get(issue.botId) : undefined;

    if (screenshotEvidence?.path && !screenshotEvidence.fallback) {
      issue.screenshotPath = screenshotEvidence.path;
    } else {
      issue.screenshotPath = issue.screenshotPath ?? screenshotEvidence?.path;
    }
    issue.videoPath = issue.videoPath ?? videoPath;
    this.attachScreenshotEvidenceMetadata(issue, screenshotEvidence);
    this.addEvidencePath(issue, issue.screenshotPath);
    this.addEvidencePath(issue, issue.videoPath);

    record.issues.push(issue);
    record.coverageTracker.recordIssue(issue);
    this.logDetectedIssue(record, issue, isRepeated);
    return true;
  }

  private stopForCriticalIssue(record: SimulationSessionRecord, issue: DetectedIssue | undefined): void {
    if (record.status === 'stopped' || record.status === 'stopping') {
      return;
    }

    const sessionId = record.request.runConfig.sessionId;
    record.logs.push(this.createLog(sessionId, 'error', `Critical issue stopped session: ${issue?.title ?? 'Unknown issue'}.`));
    record.structuredLogger.logSession('manual_stop', {
      scope: 'session',
      reason: 'critical_issue',
      issueId: issue?.issueId,
      title: issue?.title
    });
    this.clearSessionTimer(sessionId);
    record.botManager.stopAll();
    record.status = 'stopped';
    record.stoppedAt = this.now();
    record.botStatuses = record.botStatuses.map((bot) => ({
      ...bot,
      status: ['blocked', 'completed', 'failed'].includes(bot.status) ? bot.status : 'stopped',
      progressState: ['blocked', 'completed', 'failed'].includes(bot.status)
        ? bot.progressState
        : `Stopped after critical issue: ${issue?.title ?? 'Unknown issue'}`,
      message: ['blocked', 'completed', 'failed'].includes(bot.status)
        ? bot.message
        : `Stopped after critical issue: ${issue?.title ?? 'Unknown issue'}`
    }));
    this.markInstancesStopped(record);
    record.label = statusLabel(record);
    this.logSessionStop(record, 'critical_issue');
    this.stopVideoEvidence(record);
    void this.stopGameInstances(record, 'critical_issue').then(() => {
      this.writeStructuredReports(record);
    });
  }

  private async createSyntheticIssue(
    record: SimulationSessionRecord,
    status: RuntimeBotSnapshot,
    memory: BotMemory
  ): Promise<void> {
    const issueId = `${record.request.runConfig.sessionId}-${status.botId}-${status.status}`;
    const recoveryFailed = memory.progressState?.startsWith('Recovery failed') ?? false;

    if (record.issues.some((issue) => issue.issueId === issueId)) {
      return;
    }

    const lastActions = memory.recentActionTypes.slice(0, 10);
    const issue: DetectedIssue = {
      id: issueId,
      issueId,
      timestamp: this.now(),
      sessionId: record.request.runConfig.sessionId,
      instanceId: status.gameInstanceId,
      gameInstanceId: status.gameInstanceId,
      botId: status.botId,
      severity: status.status === 'failed' || recoveryFailed ? 'error' : 'warning',
      category: status.status === 'failed' ? 'unknown' : recoveryFailed ? 'progression' : 'navigation',
      title: status.status === 'failed' ? 'Bot runtime failure' : recoveryFailed ? 'Bot recovery failed' : 'Bot runtime blocked',
      description: memory.progressState,
      scene: memory.lastState?.scene,
      area: memory.currentArea,
      lastActions,
      stateSummary: memory.lastState ? JSON.stringify(memory.lastState.state).slice(0, 2000) : undefined,
      expectedBehavior: 'The bot should continue progressing or recover cleanly.',
      actualBehavior: memory.progressState,
      confidence: recoveryFailed ? 0.9 : 0.7,
      screenshotPath: memory.lastState?.screenshotPath,
      rawEvidence: {
        status,
        progressSummary: memory.progressSummary,
        recoveryAttempts: memory.recoveryAttempts
      },
      evidencePaths: [],
      actionTimelineIds: memory.lastAction ? [memory.lastAction.actionId] : [],
      firstSeenAt: this.now(),
      reproducible: false
    };

    await this.recordDetectedIssue(record, issue);
  }

  private createLog(sessionId: string, level: LogEntry['level'], message: string): LogEntry {
    return {
      id: `${sessionId}-log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      level,
      message,
      timestamp: this.now(),
      source: 'simulation-service'
    };
  }

  private completeSessionIfNoActiveBots(record: SimulationSessionRecord): void {
    if (record.status === 'stopping' || record.status === 'stopped' || record.status === 'failed' || record.finalizing) {
      return;
    }

    const hasActiveBots = record.botStatuses.some(
      (bot) => !['blocked', 'stopped', 'completed', 'failed'].includes(bot.status)
    );

    if (hasActiveBots) {
      record.label = statusLabel(record);
      return;
    }

    this.clearSessionTimer(record.request.runConfig.sessionId);

    if (!record.useMockRuntime) {
      record.finalizing = true;
      record.status = 'stopping';
      record.logs.push(this.createLog(record.request.runConfig.sessionId, 'info', 'All bots are stopped; stopping game adapter instances.'));
      record.label = statusLabel(record);
      void this.finalizeIdleSession(record);
      return;
    }

    record.status = 'stopped';
    record.stoppedAt = this.now();
    this.markInstancesStopped(record);
    record.logs.push(this.createLog(record.request.runConfig.sessionId, 'info', 'All mock bots are stopped.'));
    record.label = statusLabel(record);
    this.logSessionStop(record, 'all_bots_idle');
    this.stopVideoEvidence(record);
    this.writeStructuredReports(record);
  }

  private async finalizeIdleSession(record: SimulationSessionRecord): Promise<void> {
    try {
      await this.stopGameInstances(record, 'all_bots_idle');
      record.status = 'stopped';
      record.stoppedAt = this.now();
      record.logs.push(this.createLog(record.request.runConfig.sessionId, 'info', 'All adapter-backed bots are stopped.'));
      record.label = statusLabel(record);
      this.logSessionStop(record, 'all_bots_idle');
      this.stopVideoEvidence(record);
      this.writeStructuredReports(record);
    } finally {
      record.finalizing = false;
    }
  }

  private requireSession(sessionId: string): SimulationSessionRecord {
    let record = this.sessions.get(sessionId);

    if (!record) {
      try {
        const artifacts = this.sessionRepository.loadSession(sessionId);
        record = this.recordFromPersistedArtifacts(artifacts);
        this.sessions.set(sessionId, record);
      } catch {
        // Fall through to the normal missing-session error below.
      }
    }

    if (!record) {
      throw new Error(`Session "${sessionId}" does not exist.`);
    }

    return record;
  }
}

export const simulationService = new SimulationService();
